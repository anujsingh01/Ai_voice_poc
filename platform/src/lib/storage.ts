import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// File storage behind one small interface, with the same keys (per-tenant prefix) in both drivers:
//   STORAGE_DRIVER=local (default)  a folder on disk (STORAGE_DIR), for development
//   STORAGE_DRIVER=s3               S3_BUCKET in AWS_REGION; the bucket enforces KMS encryption,
//                                   blocks public access and versioning (see infra/terraform)

// turbopackIgnore: these paths are only known at run time; without it the bundler copies the whole
// project (recordings included) into the server build.
const ROOT = resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? 'storage');
const S3 = process.env.STORAGE_DRIVER === 's3';
const g = globalThis as unknown as { s3?: S3Client };
const s3 = () => (g.s3 ??= new S3Client({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  // Only for S3-compatible local testing (MinIO); in AWS the default endpoint and IAM role are used.
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
}));

function checkKey(key: string) {
  if (!/^tenants\/[0-9a-f-]{36}\/[\w\-./]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  return key;
}

function pathFor(key: string) {
  const p = resolve(/* turbopackIgnore: true */ join(ROOT, checkKey(key)));
  if (!p.startsWith(ROOT + '/')) throw new Error('Invalid storage key');
  return p;
}

export const tenantKey = (tenantId: string, ...parts: string[]) => ['tenants', tenantId, ...parts].join('/');

export async function putObject(key: string, data: Buffer) {
  if (S3) {
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: checkKey(key), Body: data }));
    return;
  }
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function getObject(key: string): Promise<Buffer> {
  if (S3) {
    const r = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: checkKey(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(/* turbopackIgnore: true */ pathFor(key));
}

export async function deleteObject(key: string) {
  if (S3) {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: checkKey(key) }));
    return;
  }
  await rm(pathFor(key), { force: true });
}

// Audio types browsers record or users commonly upload, identified by their first bytes, not the
// file name or the type the browser claims.
export function sniffAudio(b: Buffer): { mime: string; ext: string } | null {
  const ascii = (start: number, end: number) => b.subarray(start, end).toString('latin1');
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'audio/webm', ext: 'webm' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}
