import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  (await import('./lib/startup')).checkConfigOrExit();
}

// Every unhandled error in a page, server action or route handler, as one structured log line.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log, redactPath } = await import('./lib/log');
  log.error('request failed', err, { method: request.method, path: redactPath(request.path), route: context.routePath, kind: context.routeType });
};
