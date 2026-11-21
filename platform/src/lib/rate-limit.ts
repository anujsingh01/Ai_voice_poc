import Redis from 'ioredis';

const g = globalThis as unknown as { redis?: Redis };
export const redis = (g.redis ??= new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 }));

/** Counts an attempt; returns false once `limit` attempts have been made within `windowSeconds`. */
export async function allowAttempt(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const k = 'rl:' + key;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSeconds);
  return n <= limit;
}

export async function clearAttempts(key: string) {
  await redis.del('rl:' + key);
}
