#!/usr/bin/env bash
# Proves the parts of look-site.sh that decide whether its number means anything, without a build.
#
# look-site.sh tells its own site from whatever else is on the port by the site's name in the page,
# and it has been wrong both ways a check like that can be: it called its own 181KB page the wrong
# site, and it compared a page an earlier run had rendered. This serves pages larger than a pipe
# holds and lays out a build directory by hand, and runs the same functions look-site.sh runs.
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/look-site-lib.sh

NAME="selftest.example"
TMP=$(mktemp -d)
SERVER_PID=

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; exit 1; }

echo "== the name is found in a page larger than a pipe holds, and only when it is there =="
# Port 0 so the system picks a free one, and the page is sent in two writes so the client is still
# receiving when the name has already gone by.
: > "$TMP/server.log"
LOOK_NAME="$NAME" node --input-type=module -e '
  import { createServer } from "node:http";
  const name = process.env.LOOK_NAME;
  const filler = "<p>nothing to see in this paragraph</p>\n".repeat(26000);
  const pages = {
    "/first": [`<title>${name}</title>\n`, filler],
    "/last": [filler, `<footer>${name}</footer>\n`],
    "/without": [filler, "<footer>another site</footer>\n"],
    "/small": [`<title>${name}</title>\n`, ""],
  };
  const server = createServer((request, response) => {
    const page = pages[request.url];
    if (!page) { response.writeHead(404).end("not found"); return; }
    response.writeHead(200, { "content-type": "text/html" });
    response.write(page[0]);
    response.end(page[1]);
  });
  server.listen(0, "127.0.0.1", () => console.log("listening on " + server.address().port));
' >> "$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  grep -q "listening on" "$TMP/server.log" && break
  sleep 0.25
done
PORT=$(sed -n 's/^listening on //p' "$TMP/server.log")
[ -n "$PORT" ] || { echo "the page server did not come up"; cat "$TMP/server.log"; exit 1; }
BASE="http://127.0.0.1:$PORT"

BYTES=$(curl -s "$BASE/first" | wc -c)
[ "$BYTES" -gt 1000000 ] || fail "the large page is only $BYTES bytes, which proves nothing about a pipe"

page_says "$BASE/first" "$NAME" || fail "a large page that opens with the name was read as another site"
page_says "$BASE/last" "$NAME" || fail "a large page that ends with the name was read as another site"
page_says "$BASE/small" "$NAME" || fail "a small page with the name was read as another site"
if page_says "$BASE/without" "$NAME"; then fail "a page without the name was taken for this site"; fi
if page_says "$BASE/missing" "$NAME"; then fail "a 404 was taken for this site"; fi
CODE=0; page_says "$BASE/first" "" || CODE=$?
[ "$CODE" = "2" ] || fail "an empty name was matched against a page (exit $CODE), and every page carries it"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=
if page_says "$BASE/first" "$NAME"; then fail "a port nothing answers on was taken for this site"; fi
echo "found at either end of a ${BYTES} byte page, and not found where it is not"

echo
echo "== a fixture that names no site is refused =="
mkdir "$TMP/named" "$TMP/empty" "$TMP/absent"
echo "{\"Name\":\"$NAME\"}" > "$TMP/named/site.json"
echo '{"Name":""}' > "$TMP/empty/site.json"
echo '{"Url":"https://selftest.example"}' > "$TMP/absent/site.json"
[ "$(site_name "$TMP/named")" = "$NAME" ] || fail "the name in site.json was not read"
for fixture in empty absent; do
  CODE=0; GOT=$(site_name "$TMP/$fixture" 2> "$TMP/$fixture.err") || CODE=$?
  [ "$CODE" = "2" ] || fail "a site.json with an $fixture Name exits $CODE, not 2"
  [ -z "$GOT" ] || fail "a site.json with an $fixture Name still gave the name \"$GOT\""
  grep -q 'names no "Name"' "$TMP/$fixture.err" || fail "a site.json with an $fixture Name is refused without saying why"
done
echo "exit 2 for an empty name and for none"

echo
echo "== an earlier run's renders go, and nothing else under the build does =="
APP="$TMP/next/server/app"
mkdir -p "$APP/_press/[site]/blog" "$APP/_press/mine~public~-.segments" "$APP/_press/mine~public~-/about" \
  "$APP/_press/other~public~-.segments" "$APP/api" "$TMP/next/cache/fetch-cache"
KEPT="_press/[site]/page.js _press/[site]/blog/page.js _press/other~public~-.html _press/other~public~-.segments/_full.segment.rsc
_press/mine-two~public~-.html _press/mine~public~mine.example.html _press/mine~shared~-.html api/route.js _not-found.html"
GONE="_press/mine~public~-.html _press/mine~public~-.meta _press/mine~public~-.rsc _press/mine~public~-.segments/_full.segment.rsc
_press/mine~public~-/about.html _press/mine~public~-/about/team.html"
for file in $KEPT $GONE; do echo rendered > "$APP/$file"; done
echo cached > "$TMP/next/cache/fetch-cache/entry"

clear_site_renders "$TMP/next" mine || fail "the renders of a valid tenant were not cleared"
for file in $GONE; do
  [ ! -e "$APP/$file" ] || fail "$file from an earlier run is still there to be served"
done
[ ! -e "$APP/_press/mine~public~-" ] && [ ! -e "$APP/_press/mine~public~-.segments" ] || fail "an earlier run's render directory is still there"
for file in $KEPT; do
  [ -s "$APP/$file" ] || fail "$file was removed, and it is not this run's render"
done
[ -s "$TMP/next/cache/fetch-cache/entry" ] || fail "something outside server/app/_press was removed"

# A second call with nothing left to remove is the first run after a build, and has to pass.
clear_site_renders "$TMP/next" mine || fail "clearing a build with no earlier render fails"

for tenant in "" "../.." "mine/../other" "*" "[site]" "mine~public~-" ".hidden"; do
  CODE=0; clear_site_renders "$TMP/next" "$tenant" 2> /dev/null || CODE=$?
  [ "$CODE" = "2" ] || fail "\"$tenant\" is not a tenant handle and was not refused (exit $CODE)"
done
for file in $KEPT; do
  [ -s "$APP/$file" ] || fail "$file was removed by a tenant that should have been refused"
done
[ -d "$TMP/next/server/app/api" ] || fail "a refused tenant removed build output"
echo "the tenant's own public renders removed, the build and every other tenant's left in place"
echo
echo "look site selftest passed"
