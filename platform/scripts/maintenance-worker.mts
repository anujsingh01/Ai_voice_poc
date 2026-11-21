// Maintenance worker: expires old invite links, sends 48-hour deletion notices and deletes data whose
// retention period has ended (or whose consent was withdrawn).
//   npm run maintenance            every 15 minutes, forever
//   npm run maintenance -- --once  one pass, then exit
import { sql } from '../src/db';
import { runRetention } from '../src/lib/retention';

const once = process.argv.includes('--once');
const EVERY_MS = Number(process.env.MAINTENANCE_EVERY_MS ?? 15 * 60_000);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

while (!stopping) {
  try {
    const r = await runRetention();
    console.log(new Date().toISOString(), `expired ${r.expired} links · notified ${r.notified} · deleted ${r.deleted} candidates, ${r.files} files`);
  } catch (e) {
    console.error(new Date().toISOString(), 'maintenance error:', (e as Error).message);
  }
  if (once) break;
  await new Promise(r => setTimeout(r, EVERY_MS));
}
await sql.end();
