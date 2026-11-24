#!/usr/bin/env bash
# A site pinned to a tenant barakoCMS does not serve yet, and then the tenant created.
#
# Run after `npm run build`, like scripts/two-hosts.sh. A new site is often up before its tenant, so
# its first visitor gets a 404. That 404 must not be kept: once barakoCMS serves the tenant, the site
# answers as itself without a restart.
set -euo pipefail

CMS_PORT=${CMS_PORT:-5171}
APP_PORT=${APP_PORT:-3017}
APP="http://127.0.0.1:$APP_PORT"
CMS="http://127.0.0.1:$CMS_PORT"

rm -rf .next/cache/fetch-cache
TMP=$(mktemp -d)

node scripts/fake-cms.mjs "$CMS_PORT" &
CMS_PID=$!
CMS_URL=$CMS CMS_TENANT=late npx next start --port "$APP_PORT" > "$TMP/new-tenant-app.log" 2>&1 &
APP_PID=$!
trap 'kill "$CMS_PID" "$APP_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $1"; tail -40 "$TMP/new-tenant-app.log"; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$APP$1"; }

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$APP/api/health" && break
  sleep 1
done
# Without this, a fake CMS that never bound its port looks the same as a tenant it refuses.
{ kill -0 "$CMS_PID" 2>/dev/null && curl -sf -o /dev/null "$CMS/__reads"; } || fail "the fake CMS is not answering on $CMS_PORT"

# More than once, so a 404 kept by the first view would be the one the later views get.
for _ in 1 2 3; do
  [ "$(status /)" = "404" ] || fail "a site whose tenant barakoCMS does not serve is not a 404"
done
echo "ok: before barakoCMS serves the tenant, the site is a 404"

curl -s -o /dev/null -X POST "$CMS/__register?tenant=late"
for _ in $(seq 1 30); do
  [ "$(status /)" = "200" ] && break
  sleep 1
done
[ "$(status /)" = "200" ] || fail "the site is still a 404 30 seconds after barakoCMS began serving its tenant"
home=$(curl -s "$APP/")
grep -q "Late Club" <<< "$home" || fail "the site does not answer as its tenant"
echo "ok: once barakoCMS serves the tenant, the site answers as itself without a restart"
