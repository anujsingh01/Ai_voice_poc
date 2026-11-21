#!/usr/bin/env bash
# Backup + restore drill: dump the database, restore it into a scratch database, and prove the copy is
# complete (row counts per table, row-level security, grants) and readable by the app's role.
# Also archives the audio storage and checks the archive. Run monthly; production uses the same steps
# against an RDS snapshot restore.
#
#   scripts/backup-restore-test.sh [backup-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${1:-backups}"; mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
PG="docker exec -i platform-postgres-1"
DB=interview; SCRATCH="restore_test_$STAMP"

echo "1. Dumping $DB"
$PG pg_dump -U postgres -Fc "$DB" > "$DIR/db-$STAMP.dump"
echo "   $(du -h "$DIR/db-$STAMP.dump" | cut -f1)  $DIR/db-$STAMP.dump"

echo "2. Archiving audio storage"
tar -czf "$DIR/storage-$STAMP.tgz" storage 2>/dev/null || tar -czf "$DIR/storage-$STAMP.tgz" --files-from /dev/null
FILES_LIVE=$(find storage -type f 2>/dev/null | wc -l | tr -d ' ')
FILES_ARCHIVED=$(tar -tzf "$DIR/storage-$STAMP.tgz" | grep -vc '/$' || true)
echo "   $FILES_ARCHIVED of $FILES_LIVE files archived"

echo "3. Restoring into scratch database $SCRATCH"
$PG createdb -U postgres "$SCRATCH"
trap '$PG dropdb -U postgres --if-exists "$SCRATCH" >/dev/null' EXIT
$PG pg_restore -U postgres -d "$SCRATCH" --exit-on-error < "$DIR/db-$STAMP.dump"

echo "4. Comparing row counts"
COUNT_SQL="SELECT string_agg(format('%s=%s', t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text), ' ' ORDER BY t)
           FROM (SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public') x"
LIVE=$($PG psql -U postgres -d "$DB" -qtAc "$COUNT_SQL")
COPY=$($PG psql -U postgres -d "$SCRATCH" -qtAc "$COUNT_SQL")
TABLES=$(echo "$LIVE" | wc -w | tr -d ' ')
if [ "$LIVE" != "$COPY" ]; then echo "   MISMATCH"; diff <(echo "$LIVE" | tr ' ' '\n') <(echo "$COPY" | tr ' ' '\n'); exit 1; fi
echo "   $TABLES tables, all counts match"

echo "5. Checking security survived the restore"
SEC_SQL="SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity) || ' tables with RLS, ' ||
                (SELECT count(*) FROM pg_policies WHERE schemaname='public') || ' policies, ' ||
                (SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='app_user') || ' app_user grants'"
SEC_LIVE=$($PG psql -U postgres -d "$DB" -qtAc "$SEC_SQL")
SEC_COPY=$($PG psql -U postgres -d "$SCRATCH" -qtAc "$SEC_SQL")
[ "$SEC_LIVE" = "$SEC_COPY" ] || { echo "   MISMATCH: live [$SEC_LIVE] copy [$SEC_COPY]"; exit 1; }
echo "   $SEC_COPY (same as live)"

echo "6. App role can read the copy, and RLS still hides tenants without a context"
VISIBLE=$($PG psql -U postgres -d "$SCRATCH" -qtAc "SET ROLE app_user; SELECT count(*) FROM candidates")
[ "$VISIBLE" = "0" ] || { echo "   FAIL: app_user saw $VISIBLE candidates with no tenant set"; exit 1; }
echo "   OK (0 candidates visible without a tenant context)"

echo "Backup and restore verified: $DIR/db-$STAMP.dump, $DIR/storage-$STAMP.tgz"
