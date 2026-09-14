#!/usr/bin/env bash
# One built reference app, two tenants on two hosts, then the CMS stopped.
#
# Run after `npm run build`, which needs no CMS. Proves the claims in barakoPress #20: one container
# answers two hosts with two names and palettes, a host with no tenant is a 404, a purge on one
# tenant leaves the other's cached reads in place, and with the CMS stopped a purged tenant still
# answers 200 with its own identity.
set -euo pipefail

CMS_PORT=${CMS_PORT:-5098}
APP_PORT=${APP_PORT:-3001}
SECRET=two-hosts-not-a-secret
APP="http://127.0.0.1:$APP_PORT"

node scripts/fake-cms.mjs "$CMS_PORT" &
CMS_PID=$!
CMS_URL="http://127.0.0.1:$CMS_PORT" REVALIDATE_SECRET=$SECRET PRESS_CONSOLE_ORIGINS=https://brew.example npx next start --port "$APP_PORT" > /tmp/two-hosts-app.log 2>&1 &
APP_PID=$!
trap 'kill $CMS_PID $APP_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$APP/api/revalidate" && break
  sleep 1
done

fail() { echo "FAIL: $1"; cat /tmp/two-hosts-app.log | tail -40; exit 1; }
page() { curl -s -H "Host: $1" "$APP$2"; }
status() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "$APP$2"; }

page rckoronadal.org / > /tmp/rotary.html
page baryo.dev / > /tmp/baryo.html
grep -q "Rotary Club of Koronadal" /tmp/rotary.html || fail "rckoronadal.org does not carry its name"
grep -q "#17458F" /tmp/rotary.html || fail "rckoronadal.org does not carry its palette"
grep -q "Zilla+Slab" /tmp/rotary.html || fail "rckoronadal.org does not load its heading face"
grep -q 'lang="en-PH"' /tmp/rotary.html || fail "rckoronadal.org does not carry its locale"
grep -q "BaryoDev" /tmp/baryo.html || fail "baryo.dev does not carry its name"
grep -q "#1A6B41" /tmp/baryo.html || fail "baryo.dev does not carry its palette"
if grep -q -e "BaryoDev" -e "shipping-notes" /tmp/rotary.html; then fail "rckoronadal.org shows baryo.dev content"; fi
if grep -q -e "Koronadal" -e "club-news" /tmp/baryo.html; then fail "baryo.dev shows rckoronadal.org content"; fi
echo "ok: two hosts, two names, palettes, faces"

page baryo.dev /feed.xml | grep -q "https://baryo.dev/blog/shipping-notes" || fail "feed is not baryo.dev's"
page rckoronadal.org /sitemap.xml | grep -q "https://rckoronadal.org/blog/club-news" || fail "sitemap is not rckoronadal.org's"
page baryo.dev /robots.txt | grep -q "https://baryo.dev/sitemap.xml" || fail "robots is not baryo.dev's"
echo "ok: feed, sitemap and robots per tenant"

[ "$(status unknown.example /)" = "404" ] || fail "a host with no tenant is not a 404"
[ "$(status unknown.example /feed.xml)" = "404" ] || fail "the feed for a host with no tenant is not a 404"
echo "ok: a host with no tenant is a 404"

cors() { curl -s -o /dev/null -D - -X "$1" -H "Host: baryo.dev" -H "Origin: $2" "$APP/api/blocks" | tr -d '\r'; }
cors GET https://brew.example | grep -qi '^access-control-allow-origin: https://brew.example$' || fail "the console origin cannot read /api/blocks"
cors OPTIONS https://brew.example | grep -qi '^access-control-allow-methods: GET, OPTIONS$' || fail "the preflight from the console origin is not answered"
cors GET https://brew.example | grep -qi '^vary:.*origin' || fail "/api/blocks does not vary on Origin"
if cors GET https://evil.example | grep -qi '^access-control-allow-origin'; then fail "an unlisted origin can read /api/blocks"; fi
if cors GET https://brew.example | grep -qi '^access-control-allow-credentials'; then fail "/api/blocks allows credentials"; fi
echo "ok: /api/blocks answers the console origin only"

# soon.example is coming soon. KEY is what its settings hold the SHA-256 of.
KEY=soon-preview-key-0123456789
COOKIE="__Host-press-preview=$KEY"
held() { grep -q 'data-press="coming-soon"' "$1" && grep -q "Opening in October" "$1" && grep -q 'name="robots" content="noindex' "$1"; }
real() { grep -q "launch-plans" "$1" && ! grep -q 'data-press="coming-soon"' "$1"; }
curl -s -D /tmp/soon-head.txt -H "Host: soon.example" "$APP/" > /tmp/soon.html
held /tmp/soon.html || fail "soon.example does not answer the holding page with noindex"
# Next streams the page, so the status is sent before the page stops. What must hold is that a path
# that exists and one that does not answer alike.
[ "$(status soon.example /blog/launch-plans)" = "$(status soon.example /no-such-page)" ] || fail "the holding page tells an existing path from a missing one"
grep -q "launch-plans" /tmp/soon.html && fail "the holding page carries soon.example content"
tr -d '\r' < /tmp/soon-head.txt | grep -qi '^cache-control:.*no-store' || fail "the holding page may be stored by a cache"
page soon.example /blog/launch-plans > /tmp/soon-post.html
held /tmp/soon-post.html || fail "a post on soon.example does not answer the holding page"
grep -q "Soon Club post" /tmp/soon-post.html && fail "the holding page carries the post's title"
[ "$(status soon.example /feed.xml)" = "404" ] || fail "soon.example serves its feed while coming soon"
[ "$(status soon.example /sitemap.xml)" = "404" ] || fail "soon.example serves its sitemap while coming soon"
page soon.example /robots.txt | grep -q "Disallow: /" || fail "soon.example robots does not disallow while coming soon"
asset=$(grep -o '/_next/static/[^"]*\.js' /tmp/soon.html | head -1)
[ -n "$asset" ] && [ "$(status soon.example "$asset")" = "200" ] || fail "static assets are not reachable while coming soon"
[ "$(status soon.example /api/revalidate)" != "404" ] || fail "the revalidate endpoint is not reachable while coming soon"
echo "ok: soon.example answers the holding page, no feed or sitemap, robots and assets reachable"

keyroute() { curl -s -o /dev/null -D - -H "Host: soon.example" "$APP/api/coming-soon?key=$1&to=/blog/launch-plans" | tr -d '\r'; }
keyroute wrong-key-but-long-enough-000 > /tmp/soon-wrong.txt
grep -q '^HTTP/1.1 303' /tmp/soon-wrong.txt || fail "a wrong key is not redirected"
grep -qi '^set-cookie:' /tmp/soon-wrong.txt && fail "a wrong key was given a cookie"
keyroute "$KEY" > /tmp/soon-key.txt
grep -q '^HTTP/1.1 303' /tmp/soon-key.txt || fail "the preview key is not redirected"
grep -qiE '^location: (https?://[^/]+)?/blog/launch-plans$' /tmp/soon-key.txt || fail "the key redirect does not drop the query"
cookie=$(grep -i '^set-cookie: __Host-press-preview=' /tmp/soon-key.txt) || fail "the preview key did not set its cookie"
for part in HttpOnly Secure SameSite=Lax "Path=/"; do
  echo "$cookie" | grep -qi "; $part" || fail "the preview cookie is missing $part"
done
echo "$cookie" | grep -qi "domain=" && fail "the preview cookie names a domain"
echo "ok: the preview key sets a host-only HttpOnly, Secure, SameSite=Lax cookie and redirects the key away"

visit() { curl -s -D "$2.head" ${3:+-H "Cookie: $3"} -H "Host: soon.example" "$APP$1" > "$2"; }
visit / /tmp/soon-1.html "$COOKIE"; real /tmp/soon-1.html || fail "the preview cookie does not show the real site"
tr -d '\r' < /tmp/soon-1.html.head | grep -qi '^cache-control:.*no-store' || fail "the real site behind coming soon may be stored by a cache"
visit / /tmp/soon-2.html; held /tmp/soon-2.html || fail "a visitor without the key got the real site after one with it"
visit / /tmp/soon-3.html "$COOKIE"; real /tmp/soon-3.html || fail "a visitor with the key got the holding page after one without it"
visit / /tmp/soon-4.html "__Host-press-preview=wrong-key-but-long-enough-000"; held /tmp/soon-4.html || fail "a wrong cookie shows the real site"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE" -H "Host: soon.example" "$APP/sitemap.xml")" = "404" ] || fail "the sitemap is served to a previewer"
page baryo.dev / > /tmp/baryo-beside-soon.html
grep -q "shipping-notes" /tmp/baryo-beside-soon.html || fail "baryo.dev is not its real site beside a coming soon tenant"
grep -q 'data-press="coming-soon"' /tmp/baryo-beside-soon.html && fail "baryo.dev got a holding page"
[ "$(status baryo.dev /feed.xml)" = "200" ] || fail "baryo.dev lost its feed beside a coming soon tenant"
grep -q "$KEY" /tmp/two-hosts-app.log && fail "the preview key reached the log"
echo "ok: key and no key alternate without crossing, and baryo.dev is unaffected"

purge() {
  local body='{"event":"Published"}' ts sig
  ts=$(date +%s)
  sig=$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
  curl -s -X POST -H "Host: $1" -H 'content-type: application/json' \
    -H "x-barako-timestamp: $ts" -H "x-barako-signature: sha256=$sig" --data "$body" "$APP/api/revalidate"
}

before=$(curl -s "http://127.0.0.1:$CMS_PORT/__reads")
purge baryo.dev | grep -q '"tag":"cms:baryo"' || fail "the purge did not name baryo's tag"
page rckoronadal.org / > /dev/null
page baryo.dev / > /dev/null
after=$(curl -s "http://127.0.0.1:$CMS_PORT/__reads")
node -e '
  const [b, a] = process.argv.slice(1).map((s) => JSON.parse(s));
  if (a.rckoronadal !== b.rckoronadal) { console.log("rckoronadal re-read after baryo purge", b, a); process.exit(1); }
  if (a.baryo <= b.baryo) { console.log("baryo was not re-read after its purge", b, a); process.exit(1); }
' "$before" "$after" || fail "a purge on one tenant reached the other"
echo "ok: a purge on baryo left rckoronadal's cached reads in place"

kill $CMS_PID
wait $CMS_PID 2>/dev/null || true
purge baryo.dev > /dev/null
[ "$(status baryo.dev /)" = "200" ] || fail "baryo.dev is not 200 with the CMS stopped"
page baryo.dev / > /tmp/baryo-down.html
grep -q "BaryoDev" /tmp/baryo-down.html || fail "baryo.dev lost its name with the CMS stopped"
grep -q "#1A6B41" /tmp/baryo-down.html || fail "baryo.dev lost its palette with the CMS stopped"
grep -q "shipping-notes" /tmp/baryo-down.html || fail "baryo.dev lost its posts with the CMS stopped"
[ "$(status rckoronadal.org /)" = "200" ] || fail "rckoronadal.org is not 200 with the CMS stopped"
echo "ok: with the CMS stopped and the cache purged, baryo.dev answers 200 as itself"
