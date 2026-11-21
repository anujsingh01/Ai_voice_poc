// One JSON object per line on stdout/stderr: CloudWatch Logs indexes the fields, and a metric filter on
// level = "error" drives the error-rate alarm (infra/terraform/monitoring.tf). Never log personal data:
// ids and codes only, no names, phones, transcripts or tokens.
type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', msg: string, fields?: Fields) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line); else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, err?: unknown, fields?: Fields) => write('error', msg, {
    ...fields,
    ...(err instanceof Error ? { error: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n'), digest: (err as { digest?: string }).digest } : err ? { error: String(err) } : {}),
  }),
};

/** A request path safe to log: no query string, and candidate link tokens replaced. */
export const redactPath = (path: string) => path.split('?')[0].replace(/^(\/(?:api\/)?i\/)[^/]+/, '$1[token]');
