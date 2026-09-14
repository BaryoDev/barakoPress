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
CMS_URL="http://127.0.0.1:$CMS_PORT" REVALIDATE_SECRET=$SECRET npx next start --port "$APP_PORT" > /tmp/two-hosts-app.log 2>&1 &
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
