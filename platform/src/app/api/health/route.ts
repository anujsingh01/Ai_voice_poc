import { healthReport, healthTokenValid } from '@/lib/health';

export const dynamic = 'force-dynamic';

// Load balancers poll this without a token and get only up/down. Monitoring sends
// `Authorization: Bearer $HEALTH_TOKEN` for queue depths, worker counts and alarms.
export async function GET(req: Request) {
  const report = await healthReport();
  const code = report.status === 'down' ? 503 : 200;
  const body = healthTokenValid(req.headers.get('authorization')) ? { ...report, at: new Date().toISOString() } : { status: report.status === 'down' ? 'down' : 'ok' };
  return Response.json(body, { status: code, headers: { 'Cache-Control': 'no-store' } });
}
