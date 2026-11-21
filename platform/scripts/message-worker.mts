// Message sender: hands queued SMS and emails to the provider (see src/lib/messaging.ts for settings).
//   npm run message-worker            every few seconds, forever
//   npm run message-worker -- --once  until the queue is empty, then exit
import { sql } from '../src/db';
import { enabledChannels } from '../src/lib/env';
import { sendQueued } from '../src/lib/messaging';

const once = process.argv.includes('--once');
const EVERY_MS = Number(process.env.MESSAGE_POLL_MS ?? 3000);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

const channels = enabledChannels();
console.log(new Date().toISOString(), channels.length ? `sending ${channels.join(', ')}` : 'no sending driver set; messages stay queued');

while (!stopping) {
  let busy = false;
  try {
    const r = await sendQueued();
    busy = r.sent + r.failed + r.retrying > 0;
    if (busy) console.log(new Date().toISOString(), `sent ${r.sent} · retrying ${r.retrying} · failed ${r.failed}`);
  } catch (e) {
    console.error(new Date().toISOString(), 'message worker error:', (e as Error).message);
  }
  if (once && !busy) break;
  if (!busy) await new Promise(r => setTimeout(r, EVERY_MS));
}
await sql.end();
