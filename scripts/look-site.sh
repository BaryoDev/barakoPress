#!/usr/bin/env bash
# One site's look check: the captured design against the same page assembled from blocks.
#
# The reference is the fixture in look/fixtures/<site>, captured from the live site with
# look/capture-fixture.ts. The rebuilt side is the reference app served by `next start` against a
# stand-in CMS holding that site's settings and its page of blocks, so what is compared is the real
# renderer and not a mock of it.
#
#   npm run build            # once, the app has to exist
#   scripts/look-site.sh baryo-dev baryo.dev
#
# APP_PORT and CMS_PORT move the ports, which matters on a box already serving something.
set -euo pipefail

cd "$(dirname "$0")/.."

SITE=${1:-}
HOST=${2:-}
if [ -z "$SITE" ] || [ -z "$HOST" ]; then
  echo "usage: scripts/look-site.sh <fixture directory name> <host>"
  exit 2
fi

DIR="look/fixtures/$SITE"
PAIRS="$DIR/pairs.json"
[ -f "$DIR/site.json" ] || { echo "$DIR/site.json is not there"; exit 2; }
[ -f "$PAIRS" ] || { echo "$PAIRS is not there"; exit 2; }
[ -d .next ] || { echo "there is no build to serve. Run npm run build first"; exit 2; }

CMS_PORT=${CMS_PORT:-5199}
APP_PORT=${APP_PORT:-3210}
TMP=$(mktemp -d)
CMS_PID=
APP_PID=

cleanup() {
  [ -n "$CMS_PID" ] && kill "$CMS_PID" 2>/dev/null || true
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# A data cache from an earlier run would answer with that run's settings before this CMS is asked.
rm -rf .next/cache/fetch-cache

node scripts/look-cms.mjs "$CMS_PORT" "$DIR" "$HOST" > "$TMP/cms.log" 2>&1 &
CMS_PID=$!

# Checked rather than assumed. A stand-in CMS that could not take the port leaves whatever is
# already on it answering, and the check then compares against another run's settings and reports a
# number that means nothing.
for _ in $(seq 1 20); do
  grep -q "look cms for" "$TMP/cms.log" && break
  sleep 0.25
done
if ! grep -q "look cms for" "$TMP/cms.log"; then
  echo "the stand-in CMS did not come up on port $CMS_PORT"
  cat "$TMP/cms.log"
  exit 1
fi

# The browser reaches the app on a loopback address, not on the site's own domain, so the tenant
# cannot be resolved from the host header. CMS_DEFAULT_TENANT is the answer the engine already has
# for a host the CMS does not know, and it is what a staging box uses for the same reason. The host
# still goes to the CMS, so the settings the page renders with are the ones that site will run on.
CMS_URL="http://127.0.0.1:$CMS_PORT" CMS_DEFAULT_TENANT="$SITE" npx next start --port "$APP_PORT" > "$TMP/app.log" 2>&1 &
APP_PID=$!

# Checked the same way and for the same reason as the CMS above. `next start` exits 1 on a port
# that is taken, and something else answering 200 on it looks exactly like success: the run would
# then measure a stale server and report a number that reads as authoritative and is not. So the
# process has to still be alive, and the page has to be the one this CMS is serving.
NAME=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).Name ?? ""))' "$DIR/site.json")
# The name is the whole of the check, so an empty one is refused rather than run with. `grep -qF ""`
# matches any response at all, which would put the hole straight back.
if [ -z "$NAME" ]; then
  echo "$DIR/site.json names no \"Name\", so there is nothing to tell this site's pages apart from whatever else is on port $APP_PORT"
  exit 2
fi
up() { curl -s "http://127.0.0.1:$APP_PORT/"; }
for _ in $(seq 1 60); do
  kill -0 "$APP_PID" 2>/dev/null || break
  up | grep -qF "$NAME" && break
  sleep 1
done
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "the rebuilt site stopped before it answered on port $APP_PORT"
  tail -40 "$TMP/app.log"
  exit 1
fi
if ! up | grep -qF "$NAME"; then
  echo "whatever is answering on port $APP_PORT is not this fixture's site: it does not say \"$NAME\""
  tail -40 "$TMP/app.log"
  tail -10 "$TMP/cms.log"
  exit 1
fi

export REBUILT_BASE="http://127.0.0.1:$APP_PORT"

set +e
LOOK_PAIRS="$PAIRS" npx playwright test --config look/playwright.look.config.ts
CODE=$?
set -e
exit $CODE
