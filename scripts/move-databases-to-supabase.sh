#!/usr/bin/env bash
#
# One-off, DONE on 2026-09-30: copied both databases off Neon onto Supabase, verified, reported.
# Kept for the record. Doppler warcon/prd DATABASE_URL now points at Supabase, so running this
# again would copy Supabase onto itself -- harmless, and pointless.
#
#   Neon warcon  (Doppler warcon/prd DATABASE_URL)                 -> Supabase manticorps-warcon
#   Neon neondb  (Doppler manticorps-website/dev DATABASE_URL_UNPOOLED) -> Supabase manticorps-site
#
# Why: on 2026-09-30 the shared Neon project ran out of free compute (the panel's always-on
# polling) and took the panel, the website and the bot's tickets down together.
#
#   scripts/move-databases-to-supabase.sh check    # connectivity + row counts, changes nothing
#   scripts/move-databases-to-supabase.sh copy     # dump, wipe target, restore, verify
#   scripts/move-databases-to-supabase.sh copy site   # just one of them (warcon|site)
#
# `copy` REPLACES the public and drizzle schemas on the Supabase side -- they hold only the
# empty schema the migrations created while Neon was unreachable. It never writes to Neon.
# It does not switch any app over; that is done by hand afterwards (DEPLOYMENT.md).
#
# Needs pg_dump/pg_restore/psql >= 17: `brew install libpq`.
set -euo pipefail

export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
MODE="${1:-check}"
ONLY="${2:-both}"
WORK="${TMPDIR:-/tmp}/db-move-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK"
chmod 700 "$WORK"

secret() { doppler secrets get "$3" --project "$1" --config "$2" --plain; }

# Overridable so the whole procedure can be rehearsed Supabase -> Supabase while Neon is down.
NEON_WARCON=${NEON_WARCON:-$(secret warcon prd DATABASE_URL)}
SUPA_WARCON=${SUPA_WARCON:-$(secret warcon prd SUPABASE_DATABASE_URL)}
NEON_SITE=${NEON_SITE:-$(secret manticorps-website dev DATABASE_URL_UNPOOLED)}
SUPA_SITE=${SUPA_SITE:-$(secret manticorps-website dev SITE_DATABASE_URL_SESSION)}

# Supabase grants anon/authenticated everything in public by default; with RLS off that lets
# anyone holding the public anon key read every table over REST. Re-applied after every restore,
# because recreating the schema brings the defaults back.
LOCKDOWN="
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;"

# Exact row count of every table in public and drizzle, one "table count" per line.
counts() {
  psql "$1" -qAt -F ' ' -v ON_ERROR_STOP=1 <<'SQL' | sort
SELECT format('SELECT %L, count(*) FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name)
  FROM information_schema.tables
 WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE'
\gexec
SQL
}

reachable() {
  if psql "$2" -qAt -c 'select 1' >/dev/null 2>"$WORK/err"; then
    echo "  ok       $1"
  else
    echo "  FAILED   $1: $(head -c 200 "$WORK/err")"
    return 1
  fi
}

move() {
  local name="$1" from="$2" to="$3"
  echo
  echo "== $name"
  pg_dump "$from" --format=custom --no-owner --no-privileges \
    --schema=public --schema=drizzle --file="$WORK/$name.dump"
  echo "  dumped   $(du -h "$WORK/$name.dump" | cut -f1)"

  psql "$to" -q -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
SQL
  # Whether the dump carries CREATE SCHEMA public depends on the pg_dump version; the empty
  # schema above already exists, so that entry (if any) is left out of the restore list.
  pg_restore --list "$WORK/$name.dump" | grep -v ' SCHEMA - public ' >"$WORK/$name.list"
  pg_restore --dbname="$to" --no-owner --no-privileges --single-transaction \
    --exit-on-error --use-list="$WORK/$name.list" "$WORK/$name.dump"
  psql "$to" -q -v ON_ERROR_STOP=1 -c "$LOCKDOWN"
  echo "  restored"

  counts "$from" >"$WORK/$name.from"
  counts "$to" >"$WORK/$name.to"
  if diff -q "$WORK/$name.from" "$WORK/$name.to" >/dev/null; then
    echo "  verified $(wc -l <"$WORK/$name.from" | tr -d ' ') tables, every row count identical"
  else
    echo "  ROW COUNTS DIFFER (source left, target right):"
    diff --side-by-side "$WORK/$name.from" "$WORK/$name.to" | grep '|' || true
    return 1
  fi
  local anon
  anon=$(psql "$to" -qAt -c "select count(*) from information_schema.role_table_grants
    where grantee in ('anon','authenticated') and table_schema='public'")
  echo "  anon/authenticated grants on public: $anon"
}

echo "connectivity"
ok=0
reachable "Neon warcon" "$NEON_WARCON" || ok=1
reachable "Neon site" "$NEON_SITE" || ok=1
reachable "Supabase warcon" "$SUPA_WARCON" || ok=1
reachable "Supabase site" "$SUPA_SITE" || ok=1
[ "$ok" -eq 0 ] || { echo "Not everything is reachable; nothing was changed."; exit 1; }

case "$MODE" in
  check)
    for pair in "warcon:$NEON_WARCON" "site:$NEON_SITE"; do
      echo
      echo "== ${pair%%:*} on Neon"
      counts "${pair#*:}" | sed 's/^/  /'
    done
    ;;
  copy)
    [ "$ONLY" = site ] || move warcon "$NEON_WARCON" "$SUPA_WARCON"
    [ "$ONLY" = warcon ] || move site "$NEON_SITE" "$SUPA_SITE"
    echo
    echo "Both copied and verified. Dumps kept in $WORK -- delete them once the apps are switched."
    ;;
  *)
    echo "usage: $0 check|copy" >&2
    exit 2
    ;;
esac
