import postgres from 'postgres';

// One pool per server process (kept on globalThis so dev hot-reload doesn't open new pools).
const g = globalThis as unknown as { sql?: postgres.Sql };
// DATABASE_SSL=verify-full in AWS (RDS CA bundle via NODE_EXTRA_CA_CERTS); plain TCP for the local container.
const ssl = process.env.DATABASE_SSL as 'require' | 'verify-full' | undefined;
export const sql = (g.sql ??= postgres(process.env.DATABASE_URL!, {
  max: Number(process.env.DATABASE_POOL ?? 10), onnotice: () => {}, ...(ssl ? { ssl } : {}),
}));

export type Tx = postgres.TransactionSql;
export type DbContext = { tenantId?: string | null; superAdmin?: boolean };

/**
 * Runs `fn` in a transaction whose row-level-security context is `ctx`.
 * Every query on tenant data must go through here: without a context, tenant tables return nothing.
 */
export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql.begin(async tx => {
    await tx`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                    set_config('app.is_super_admin', ${ctx.superAdmin ? 'on' : 'off'}, true)`;
    return fn(tx);
  })) as T;
}
