#!/usr/bin/env bash
# Proves the look check is a gate, by watching it fail.
#
# Two runs over the same pair list. The first serves pages that match the prototype on disk and has
# to come back green at both widths. The second serves the same pages with the hero heading in a
# different colour and has to fail the home pair, pass the about pair, and leave a diff image behind.
#
# A check nobody has seen fail is a check nobody should trust, and this is the part CI runs.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT=${LOOK_FIXTURE_PORT:-3112}
PAIRS=look/fixtures/fixtures.pairs.json
TMP=$(mktemp -d)
SERVER_PID=

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

serve() {
  node scripts/look-fixture-server.mjs "$PORT" "$1" > "$TMP/server-$1.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && return 0
    sleep 0.25
  done
  echo "the fixture server did not come up on port $PORT"
  cat "$TMP/server-$1.log"
  exit 1
}

stop() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=
  sleep 0.5
}

run() {
  set +e
  REBUILT_BASE="http://127.0.0.1:$PORT" LOOK_PAIRS="$PAIRS" LOOK_OUTPUT="$TMP/$1" \
    npx playwright test --config look/playwright.look.config.ts > "$TMP/run-$1.log" 2>&1
  local code=$?
  set -e
  echo "$code"
}

expect() {
  LOOK_SUMMARY="$1" LOOK_WANTED="$2" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const { results } = JSON.parse(readFileSync(process.env.LOOK_SUMMARY, "utf8"));
    const seen = results.map((r) => r.id + "@" + r.width + "=" + (r.passed ? "same" : "different")).sort().join(" ");
    const expected = process.env.LOOK_WANTED.split(" ").sort().join(" ");
    if (seen !== expected) {
      console.error("expected: " + expected);
      console.error("     got: " + seen);
      for (const r of results) if (r.error) console.error(r.id + "@" + r.width + ": " + r.error);
      process.exit(1);
    }
  '
}

echo "== run 1: the rebuilt pages match the prototype =="
serve match
MATCH_CODE=$(run match)
stop
if [ "$MATCH_CODE" != "0" ]; then
  echo "FAIL: the check went red on pages that match"
  cat "$TMP/run-match.log"
  exit 1
fi
expect "$TMP/match/summary.json" "home@390=same home@1280=same about@390=same about@1280=same" || {
  cat "$TMP/run-match.log"
  exit 1
}
echo "green, as it should be"

echo
echo "== run 2: the rebuilt hero heading is a different colour =="
serve drift
DRIFT_CODE=$(run drift)
stop
if [ "$DRIFT_CODE" = "0" ]; then
  echo "FAIL: the check stayed green on a deliberate colour change. It is not a gate."
  cat "$TMP/run-drift.log"
  exit 1
fi
expect "$TMP/drift/summary.json" "home@390=different home@1280=different about@390=same about@1280=same" || {
  cat "$TMP/run-drift.log"
  exit 1
}

for width in 390 1280; do
  for image in reference rebuilt diff; do
    path="$TMP/drift/pages/home/$width/$image.png"
    [ -s "$path" ] || { echo "FAIL: $image.png missing for home at ${width}px"; exit 1; }
  done
done
grep -q "different" "$TMP/drift/summary.md" || { echo "FAIL: the summary does not report the difference"; exit 1; }

echo "red on the change, green on the page it did not touch, with all three images written"
echo
sed -n '/## Look check/,$p' "$TMP/drift/summary.md"
echo "look check selftest passed"
