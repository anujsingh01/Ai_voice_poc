import { createHash, timingSafeEqual } from 'node:crypto';
import { sql, withContext } from '@/db';
import { redis } from '@/lib/rate-limit';

// Alarm thresholds. docs/operations.md explains each rule and what to do when it fires.
export const ALARMS = {
  transcriptionBacklogMinutes: 30,  // oldest queued answer waiting longer than this
  scoringBacklogMinutes: 60,
  batchScoringHours: 26,            // OpenAI Batch promises 24 h
  failedPerHour: 10,
  dbLatencyMs: 500,
  workerOfflineMinutes: 2,
};

export type Alarm = { level: 'critical' | 'warning'; code: string; message: string };

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const t = performance.now();
  try {
    const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    return { ok: true, ms: Math.round(performance.now() - t), value };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t), error: (e as Error).message };
  }
}

export async function healthReport() {
  const [db, cache] = await Promise.all([timed(() => sql`SELECT 1`), timed(() => redis.ping())]);
  const alarms: Alarm[] = [];
  if (!db.ok) alarms.push({ level: 'critical', code: 'db_down', message: `Database unreachable (${db.error})` });
  else if (db.ms > ALARMS.dbLatencyMs) alarms.push({ level: 'warning', code: 'db_slow', message: `Database took ${db.ms} ms` });
  if (!cache.ok) alarms.push({ level: 'critical', code: 'redis_down', message: `Redis unreachable (${cache.error}); logins and rate limits fail` });
  if (!db.ok) return { status: 'down' as const, checks: { db, redis: cache }, alarms };

  const q = await withContext({ superAdmin: true }, async tx => {
    const [t] = await tx`
      SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
             count(*) FILTER (WHERE status = 'leased')::int AS leased,
             count(*) FILTER (WHERE status = 'leased' AND leased_until < now())::int AS expired_leases,
             count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 hour')::int AS failed_last_hour,
             coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('queued', 'leased'))) / 60, 0)::int AS oldest_minutes
      FROM transcription_jobs WHERE status IN ('queued', 'leased') OR finished_at > now() - interval '1 hour'`;
    const [s] = await tx`
      SELECT count(*) FILTER (WHERE status IN ('queued', 'running'))::int AS queued,
             count(*) FILTER (WHERE status = 'submitted')::int AS in_batch,
             count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '1 hour')::int AS failed_last_hour,
             coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('queued', 'running'))) / 60, 0)::int AS oldest_minutes,
             coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'submitted')) / 3600, 0)::int AS oldest_batch_hours
      FROM scoring_jobs WHERE status IN ('queued', 'running', 'submitted') OR finished_at > now() - interval '1 hour'`;
    const [w] = await tx`
      SELECT count(*) FILTER (WHERE last_seen_at > now() - make_interval(mins => ${ALARMS.workerOfflineMinutes}))::int AS online,
             count(*)::int AS total
      FROM workers WHERE NOT disabled`;
    return { transcription: t, scoring: s, workers: w };
  });

  const { transcription: t, scoring: s, workers: w } = q;
  if (w.online === 0 && t.queued + t.leased > 0) alarms.push({ level: 'critical', code: 'no_workers', message: `${t.queued} answers waiting and no transcription worker online` });
  else if (w.online < w.total) alarms.push({ level: 'warning', code: 'worker_offline', message: `${w.total - w.online} of ${w.total} transcription workers offline` });
  if (t.oldest_minutes > ALARMS.transcriptionBacklogMinutes) alarms.push({ level: 'warning', code: 'transcription_backlog', message: `Oldest answer has waited ${t.oldest_minutes} min for transcription` });
  if (t.expired_leases > 0) alarms.push({ level: 'warning', code: 'expired_leases', message: `${t.expired_leases} transcription leases expired (worker crashed mid-job?)` });
  if (s.oldest_minutes > ALARMS.scoringBacklogMinutes) alarms.push({ level: 'warning', code: 'scoring_backlog', message: `Oldest interview has waited ${s.oldest_minutes} min for scoring; is the scoring worker running?` });
  if (s.oldest_batch_hours > ALARMS.batchScoringHours) alarms.push({ level: 'warning', code: 'batch_late', message: `An OpenAI batch has been out for ${s.oldest_batch_hours} h` });
  const failed = t.failed_last_hour + s.failed_last_hour;
  if (failed > ALARMS.failedPerHour) alarms.push({ level: 'critical', code: 'failures', message: `${failed} jobs failed in the last hour` });

  const status = alarms.some(a => a.level === 'critical') ? 'down' as const : alarms.length ? 'degraded' as const : 'ok' as const;
  return { status, checks: { db: { ok: db.ok, ms: db.ms }, redis: { ok: cache.ok, ms: cache.ms } }, queues: q, alarms };
}

/** Constant-time check of the monitoring token, so the detailed report isn't public. */
export function healthTokenValid(header: string | null): boolean {
  const expected = process.env.HEALTH_TOKEN;
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const h = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(header.slice(7)), h(expected));
}
