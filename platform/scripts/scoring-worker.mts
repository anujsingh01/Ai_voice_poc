// Scoring worker: picks up completed, fully transcribed interviews and scores them.
//   npm run scoring-worker            run forever (in production: its own small container)
//   npm run scoring-worker -- --once  process what is ready, then exit
import { closePool, enqueueReady, runBatches, runOneFastJob } from '../src/lib/scoring/service';

const once = process.argv.includes('--once');
const POLL_MS = Number(process.env.SCORING_POLL_MS ?? 5000);
const BATCH_POLL_MS = Number(process.env.SCORING_BATCH_POLL_MS ?? 60000);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
log(`scoring worker started (provider: ${process.env.SCORING_PROVIDER ?? 'openai'}, model: ${process.env.OPENAI_MODEL ?? 'gpt-5-mini'})`);

let lastBatch = 0;
while (!stopping) {
  try {
    const queued = await enqueueReady();
    if (queued) log(`queued ${queued} interview(s) for scoring`);
    let did = 0;
    while (!stopping && (await runOneFastJob())) did++;
    if (did) log(`ran ${did} fast scoring job(s)`);
    if (once || Date.now() - lastBatch > BATCH_POLL_MS) { await runBatches(); lastBatch = Date.now(); }
  } catch (e) {
    log('error:', (e as Error).message);
  }
  if (once) break;
  await new Promise(r => setTimeout(r, POLL_MS));
}
await closePool();
log('scoring worker stopped');
