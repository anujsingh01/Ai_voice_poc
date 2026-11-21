import type postgres from 'postgres';
import type { Tx } from '@/db';

export type AuditEntry = {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;            // dotted verb, e.g. 'tenant.created', 'auth.login_failed'
  target?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
};

export async function audit(tx: Tx, e: AuditEntry) {
  await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, target, details, ip)
           VALUES (${e.tenantId ?? null}, ${e.actorUserId ?? null}, ${e.action}, ${e.target ?? null},
                   ${tx.json((e.details ?? {}) as postgres.JSONValue)}, ${e.ip ?? null})`;
}
