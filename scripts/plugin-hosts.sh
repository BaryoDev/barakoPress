#!/usr/bin/env bash
# One build carrying the sample plugin, two tenants, and only one of them enabled it (barakoPress #25).
#
# Run after the app was built with the plugin installed: either the image the derived recipe makes,
# named by PRESS_IMAGE, or this checkout after `node scripts/plugins.mjs <dir>` and `npm run build`.
# Proves that rckoronadal.org, whose Plugins setting names `sample`, draws the tally and is offered it
# in /api/blocks, and that baryo.dev, which did not, gets the same page without it and is not.
set -euo pipefail

CMS_PORT=${CMS_PORT:-5099}
APP_PORT=${APP_PORT:-3002}
APP="http://127.0.0.1:$APP_PORT"
TMP=$(mktemp -d)

node scripts/fake-cms.mjs "$CMS_PORT" &
CMS_PID=$!
if [ -n "${PRESS_IMAGE:-}" ]; then
  CONTAINER=$(docker run -d --network host -e PORT="$APP_PORT" -e CMS_URL="http://127.0.0.1:$CMS_PORT" \
    -e PRESS_CONSOLE_ORIGINS=https://brew.example "$PRESS_IMAGE")
  trap 'kill "$CMS_PID" 2>/dev/null || true; docker logs "$CONTAINER" > "$TMP/app.log" 2>&1 || true; docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  logs() { docker logs "$CONTAINER" 2>&1 | tail -40; }
else
  rm -rf .next/cache/fetch-cache
  CMS_URL="http://127.0.0.1:$CMS_PORT" PRESS_CONSOLE_ORIGINS=https://brew.example npx next start --port "$APP_PORT" > "$TMP/app.log" 2>&1 &
  APP_PID=$!
  trap 'kill "$CMS_PID" "$APP_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
  logs() { tail -40 "$TMP/app.log"; }
fi

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$APP/api/revalidate" && break
  sleep 1
done

fail() { echo "FAIL: $1"; logs; exit 1; }
page() { curl -s -H "Host: $1" "$APP$2"; }
status() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "$APP$2"; }

[ "$(status rckoronadal.org /tally)" = 200 ] || fail "rckoronadal.org /tally is not 200"
[ "$(status baryo.dev /tally)" = 200 ] || fail "baryo.dev /tally is not 200"

page rckoronadal.org /tally > "$TMP/on.html"
page baryo.dev /tally > "$TMP/off.html"

grep -q 'data-block="sampleTally"' "$TMP/on.html" || fail "the tenant that enabled the plugin does not draw its block"
grep -q '1,234' "$TMP/on.html" || fail "the plugin block renders without its props"
echo "ok: rckoronadal.org enabled the sample plugin and draws its tally"

grep -q 'Before the tally' "$TMP/off.html" || fail "baryo.dev does not draw the rest of the page"
grep -q 'After the tally' "$TMP/off.html" || fail "baryo.dev stops drawing at the plugin block"
if grep -q 'sampleTally' "$TMP/off.html" || grep -q '1,234' "$TMP/off.html"; then
  fail "baryo.dev draws a block from a plugin it did not enable"
fi
echo "ok: baryo.dev did not enable it, and its page renders without the tally"

blocks() { curl -s -H "Host: $1" "$APP/api/blocks"; }
blocks rckoronadal.org > "$TMP/on.json"
blocks baryo.dev > "$TMP/off.json"
node -e '
  const [on, off] = process.argv.slice(1).map((f) => JSON.parse(require("node:fs").readFileSync(f, "utf8")));
  const tally = (s) => s.blocks.find((b) => b.type === "sampleTally");
  const problems = [];
  if (tally(on)?.plugin !== "sample") problems.push("rckoronadal.org is not offered the tally");
  if (off.blocks.length === 0) problems.push("baryo.dev is offered no blocks at all");
  if (tally(off)) problems.push("baryo.dev is offered the tally");
  if (JSON.stringify(on.plugins) !== JSON.stringify([{ name: "sample", enabled: true }])) problems.push("rckoronadal.org plugins: " + JSON.stringify(on.plugins));
  if (JSON.stringify(off.plugins) !== JSON.stringify([{ name: "sample", enabled: false }])) problems.push("baryo.dev plugins: " + JSON.stringify(off.plugins));
  if (problems.length) { console.log(problems.join("\n")); process.exit(1); }
' "$TMP/on.json" "$TMP/off.json" || fail "/api/blocks does not follow each tenant's Plugins setting"
echo "ok: /api/blocks offers the tally to rckoronadal.org only, and names the plugin to both"
