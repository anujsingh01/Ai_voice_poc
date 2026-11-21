// Node-only start-up check, kept out of instrumentation.ts so the Edge build never sees process.exit.
import { configProblems } from './env';
import { log } from './log';

export function checkConfigOrExit() {
  const problems = configProblems();
  if (problems.length) {
    log.error('configuration invalid; refusing to start', undefined, { problems });
    process.exit(1);
  }
  log.info('server started', { env: process.env.APP_ENV ?? 'development', storage: process.env.STORAGE_DRIVER ?? 'local' });
}
