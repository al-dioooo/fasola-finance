#!/usr/bin/env bash
#
# Deploy fasola-finance on the VM: fetch, build, restart, verify, roll back on failure.
#
# Database migrations are not a separate step. server/src/server.ts calls
# runMigrations() before it listens, so restarting the service applies every
# pending migration in server/src/db/migrations/index.ts. Shipping code ships
# schema. Two consequences drive this script: the database is dumped BEFORE the
# restart (migrations are forward-only — there is no down-migration), and after
# the restart every migration the new code declares is checked against
# fin_schema_migrations.
#
# This repo owns only the fin_* tables. Bot-owned tables are migrated by
# fasola-order-bot, so when a release touches both apps, deploy the BOT FIRST:
# this dashboard reads columns the bot's migrations create, and starting it
# against an older bot schema surfaces as 500s on the pages that read them.
#
# Run it on the VM, or from your Mac over SSH:
#   ssh -i ~/.ssh/fasola_azure aliceevr@85.211.216.153 \
#     'projects/fasola/fasola-finance/deploy/deploy.sh'
#
set -Eeuo pipefail

APP="fasola-finance"
SERVICE="fasola-finance"
HEALTH_URL="http://127.0.0.1:3100/healthz"
MIGRATIONS_TABLE="fin_schema_migrations"
MIGRATIONS_SRC="server/src/db/migrations/index.ts"
BACKUP_DIR="${FASOLA_BACKUP_DIR:-$HOME/backups/fasola}"
BACKUP_KEEP=10
HEALTH_TIMEOUT=60

REF="origin/main"
FORCE=0
SKIP_BACKUP=0
ROLLBACK=1

usage() {
  cat <<EOF
Usage: deploy/deploy.sh [options]

  --ref <git-ref>   Deploy this ref instead of origin/main (tag, branch, or SHA).
                    Use it to roll forward to a pin, or back to a known-good SHA.
  --force           Discard uncommitted changes to tracked files on the VM.
  --skip-backup     Skip the pre-migration database dump. Only when you are certain
                    the release carries no new migration.
  --no-rollback     Leave the new code in place if the health check fails, so you
                    can debug it live.
  -h, --help        Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    --no-rollback) ROLLBACK=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

# ---------------------------------------------------------------- preflight ---
log "Preflight"

[[ -d .git ]] || die "$REPO_DIR is not a git repository. See 'First-time setup' in README.md."
[[ -f .env ]] || die ".env is missing. The service cannot start without it."
systemctl cat "$SERVICE.service" >/dev/null 2>&1 \
  || die "systemd unit $SERVICE.service not found — is this the VM?"
command -v node >/dev/null || die "node is not installed"
command -v pg_dump >/dev/null || die "pg_dump is not installed"

# Dump and verify against the same database the service uses, rather than a
# hardcoded name, so this can never target the wrong one.
DATABASE_URL="$(grep -E '^\s*DATABASE_URL=' .env | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"
[[ -n "$DATABASE_URL" ]] || die "DATABASE_URL is not set in .env"
psql "$DATABASE_URL" -tAc 'SELECT 1' >/dev/null 2>&1 || die "cannot connect to the database at DATABASE_URL"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  if [[ $FORCE -eq 1 ]]; then
    warn "discarding uncommitted changes to tracked files (--force):"
    git status --short --untracked-files=no >&2
  else
    git status --short --untracked-files=no >&2
    die "uncommitted changes to tracked files on the VM. Commit or push them from your Mac, or re-run with --force to discard them."
  fi
fi

info "repo:     $REPO_DIR"
info "database: ${DATABASE_URL##*/}"
info "service:  $SERVICE"

# -------------------------------------------------------------------- fetch ---
log "Fetching $REF"
git fetch --prune origin --tags
PREV_SHA="$(git rev-parse HEAD)"
TARGET_SHA="$(git rev-parse --verify --quiet "${REF}^{commit}" 2>/dev/null || true)"
[[ -n "$TARGET_SHA" ]] || die "cannot resolve ref: $REF"

if [[ "$PREV_SHA" == "$TARGET_SHA" ]]; then
  info "already at $(git log -1 --format='%h %s' "$TARGET_SHA") — redeploying anyway (rebuild + restart)."
else
  info "current: $(git log -1 --format='%h %s' "$PREV_SHA")"
  info "target:  $(git log -1 --format='%h %s' "$TARGET_SHA")"
  echo
  info "incoming commits:"
  git --no-pager log --oneline "$PREV_SHA..$TARGET_SHA" 2>/dev/null | sed 's/^/      /' || true

  # Surface schema changes explicitly — they are the part that cannot be undone
  # by redeploying the old code.
  if ! git diff --quiet "$PREV_SHA" "$TARGET_SHA" -- "$MIGRATIONS_SRC" 2>/dev/null; then
    echo
    warn "this release changes $MIGRATIONS_SRC — new migrations will apply on restart."
  fi
fi

# ------------------------------------------------------------------- backup ---
BACKUP_FILE=""
if [[ $SKIP_BACKUP -eq 1 ]]; then
  warn "skipping the database backup (--skip-backup)."
else
  log "Backing up the database"
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/fasola-$(date -u +%Y%m%dT%H%M%SZ)-pre-$(git rev-parse --short "$TARGET_SHA").sql.gz"
  # pipefail is set, so a pg_dump failure fails the pipeline rather than
  # leaving a truncated dump behind.
  pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE" || { rm -f "$BACKUP_FILE"; die "pg_dump failed — refusing to deploy without a backup."; }
  info "wrote $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

  # Keep the directory bounded; this VM has one disk shared with Postgres.
  mapfile -t OLD_BACKUPS < <(ls -1t "$BACKUP_DIR"/fasola-*.sql.gz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)))
  if [[ ${#OLD_BACKUPS[@]} -gt 0 ]]; then
    rm -f "${OLD_BACKUPS[@]}"
    info "pruned ${#OLD_BACKUPS[@]} backup(s) older than the newest $BACKUP_KEEP"
  fi
fi

# -------------------------------------------------------------------- build ---
build_ref() {
  local sha="$1" from="$2"
  git reset --hard --quiet "$sha"

  # npm ci wipes and rebuilds node_modules, so only pay for it when the lockfile
  # actually moved (or node_modules is missing/damaged).
  if [[ ! -d node_modules ]] || ! git diff --quiet "$from" "$sha" -- package-lock.json package.json 2>/dev/null; then
    info "dependencies changed — running npm ci"
    # --include=dev because the build needs tsc and vite, which are devDependencies.
    npm ci --include=dev
  else
    info "no dependency changes — skipping npm ci"
  fi

  # Builds both halves: dist/web (Vite SPA) and dist/server (tsc).
  npm run build
}

wait_for_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while ((SECONDS < deadline)); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    # A dead unit will never come back; fail fast instead of burning the timeout.
    if ! systemctl is-active --quiet "$SERVICE"; then
      sleep 2
      systemctl is-active --quiet "$SERVICE" || return 1
    fi
    sleep 2
  done
  return 1
}

rollback() {
  if [[ $ROLLBACK -eq 0 ]]; then
    warn "leaving the failed deploy in place (--no-rollback). Service may be down."
    return
  fi
  log "Rolling back to $(git log -1 --format='%h %s' "$PREV_SHA")"
  # Code rolls back; schema does not. Migrations are additive
  # (CREATE TABLE / ADD COLUMN ... IF NOT EXISTS), so the previous build runs
  # fine against the newer schema — it simply ignores the new columns.
  if build_ref "$PREV_SHA" "$TARGET_SHA"; then
    sudo systemctl restart "$SERVICE"
    if wait_for_health; then
      warn "rolled back to the previous build; it is healthy."
    else
      die "ROLLBACK FAILED — $SERVICE is down. Check: journalctl -u $SERVICE -n 50"
    fi
  else
    die "ROLLBACK BUILD FAILED — $SERVICE is down. Check: journalctl -u $SERVICE -n 50"
  fi
  if [[ -n "$BACKUP_FILE" ]]; then
    warn "database backup (schema NOT rolled back): $BACKUP_FILE"
  fi
  exit 1
}

log "Building $(git rev-parse --short "$TARGET_SHA")"
if ! build_ref "$TARGET_SHA" "$PREV_SHA"; then
  # Nothing has restarted yet, so the running service is untouched. Just restore
  # the working tree and leave it serving the old build.
  warn "build failed — the running service was not touched."
  git reset --hard "$PREV_SHA" --quiet
  die "build failed at $REF. The old build is still live."
fi

# ------------------------------------------------------------------ restart ---
log "Restarting $SERVICE (migrations apply here)"
sudo systemctl restart "$SERVICE"

if ! wait_for_health; then
  warn "$SERVICE did not become healthy within ${HEALTH_TIMEOUT}s."
  echo
  journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
  rollback
fi
info "health check passed: $HEALTH_URL"

# ------------------------------------------------- verify schema migrations ---
log "Verifying migrations"

# The IDs the deployed code declares, e.g. `id: "003_fin_gofood_sync_runs"`.
mapfile -t EXPECTED < <(grep -oE 'id:[[:space:]]*"[0-9]{3}_[a-z0-9_]+"' "$MIGRATIONS_SRC" \
  | grep -oE '[0-9]{3}_[a-z0-9_]+' | sort -u)
[[ ${#EXPECTED[@]} -gt 0 ]] || die "could not read any migration IDs from $MIGRATIONS_SRC"

mapfile -t APPLIED < <(psql "$DATABASE_URL" -tAc "SELECT id FROM $MIGRATIONS_TABLE ORDER BY id" 2>/dev/null | sed '/^$/d')

MISSING=()
for id in "${EXPECTED[@]}"; do
  printf '%s\n' "${APPLIED[@]}" | grep -qxF "$id" || MISSING+=("$id")
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "the service is healthy but these migrations did not apply:"
  printf '      %s\n' "${MISSING[@]}" >&2
  rollback
fi

info "${#APPLIED[@]}/${#EXPECTED[@]} migrations applied — latest: ${APPLIED[-1]:-none}"

# ------------------------------------------------------------------- report ---
log "Deployed $APP @ $(git log -1 --format='%h %s')"
info "service:  $(systemctl is-active "$SERVICE")"
info "health:   $HEALTH_URL"
if [[ -n "$BACKUP_FILE" ]]; then
  info "backup:   $BACKUP_FILE"
fi
if [[ "$PREV_SHA" != "$TARGET_SHA" ]]; then
  info "previous: $(git log -1 --format='%h %s' "$PREV_SHA")"
  info "revert:   deploy/deploy.sh --ref $(git rev-parse --short "$PREV_SHA")"
fi
echo
