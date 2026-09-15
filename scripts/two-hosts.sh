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
PREVIEW_SECRET=two-hosts-share-secret-not-a-real-one-0123
APP="http://127.0.0.1:$APP_PORT"

# A data cache left by an earlier run would answer with that run's settings before this CMS is asked.
rm -rf .next/cache/fetch-cache

# One private directory per run, so two runs on one machine cannot read or truncate each other's files.
TMP=$(mktemp -d)

node scripts/fake-cms.mjs "$CMS_PORT" &
CMS_PID=$!
CMS_URL="http://127.0.0.1:$CMS_PORT" REVALIDATE_SECRET=$SECRET PRESS_PREVIEW_SECRET=$PREVIEW_SECRET PRESS_CONSOLE_ORIGINS=https://brew.example npx next start --port "$APP_PORT" > "$TMP/two-hosts-app.log" 2>&1 &
APP_PID=$!
trap 'kill "$CMS_PID" "$APP_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "$APP/api/revalidate" && break
  sleep 1
done

fail() { echo "FAIL: $1"; cat "$TMP/two-hosts-app.log" | tail -40; exit 1; }
page() { curl -s -H "Host: $1" "$APP$2"; }
status() { curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "$APP$2"; }

page rckoronadal.org / > "$TMP/rotary.html"
page baryo.dev / > "$TMP/baryo.html"
grep -q "Rotary Club of Koronadal" "$TMP/rotary.html" || fail "rckoronadal.org does not carry its name"
grep -q "#17458F" "$TMP/rotary.html" || fail "rckoronadal.org does not carry its palette"
grep -q "Zilla+Slab" "$TMP/rotary.html" || fail "rckoronadal.org does not load its heading face"
grep -q 'lang="en-PH"' "$TMP/rotary.html" || fail "rckoronadal.org does not carry its locale"
grep -q "BaryoDev" "$TMP/baryo.html" || fail "baryo.dev does not carry its name"
grep -q "#1A6B41" "$TMP/baryo.html" || fail "baryo.dev does not carry its palette"
if grep -q -e "BaryoDev" -e "shipping-notes" "$TMP/rotary.html"; then fail "rckoronadal.org shows baryo.dev content"; fi
if grep -q -e "Koronadal" -e "club-news" "$TMP/baryo.html"; then fail "baryo.dev shows rckoronadal.org content"; fi
echo "ok: two hosts, two names, palettes, faces"

page baryo.dev /feed.xml | grep -q "https://baryo.dev/blog/shipping-notes" || fail "feed is not baryo.dev's"
page rckoronadal.org /sitemap.xml | grep -q "https://rckoronadal.org/blog/club-news" || fail "sitemap is not rckoronadal.org's"
page baryo.dev /robots.txt | grep -q "https://baryo.dev/sitemap.xml" || fail "robots is not baryo.dev's"
echo "ok: feed, sitemap and robots per tenant"

grep -q 'data-press="navigation"' "$TMP/baryo.html" || fail "baryo.dev does not draw its page menu"
about_at=$(grep -bo 'href="/about"' "$TMP/baryo.html" | head -1 | cut -d: -f1)
docs_at=$(grep -bo 'href="/docs"' "$TMP/baryo.html" | head -1 | cut -d: -f1)
[ -n "$about_at" ] && [ -n "$docs_at" ] && [ "$about_at" -lt "$docs_at" ] || fail "baryo.dev does not draw its menu in the order the CMS gave"
grep -q 'href="/projects"' "$TMP/rotary.html" || fail "rckoronadal.org does not draw its own page menu"
if grep -q 'href="/about/team"' "$TMP/rotary.html"; then fail "rckoronadal.org draws baryo.dev's page menu"; fi
page baryo.dev /about/team > "$TMP/team.html"
grep -q "Meet the team" "$TMP/team.html" || fail "the page at /about/team does not render"
grep -q 'data-press="breadcrumbs"' "$TMP/team.html" || fail "the page at /about/team has no breadcrumbs"
[ "$(status rckoronadal.org /about/team)" = "404" ] || fail "rckoronadal.org serves baryo.dev's page"
echo "ok: each tenant draws its own menu in the CMS order, and renders only its own pages, with breadcrumbs"

[ "$(status baryo.dev /blog/shipping-notes)" = "200" ] || fail "a page slugged blog shadows the post route"
[ "$(status baryo.dev /blog)" = "404" ] || fail "a page under a reserved slug is not a 404"
if page baryo.dev /blog | grep -q "must never render"; then fail "a page under a reserved slug renders"; fi
page baryo.dev /sitemap.xml > "$TMP/baryo-sitemap.xml"
grep -q "<loc>https://baryo.dev/about/team</loc>" "$TMP/baryo-sitemap.xml" || fail "the sitemap does not list baryo.dev's pages"
if grep -q "<loc>https://baryo.dev/blog</loc>" "$TMP/baryo-sitemap.xml"; then fail "the sitemap lists a page under a reserved slug"; fi
echo "ok: a page under a reserved slug neither renders nor shadows the post route, and is left out of the sitemap"

curl -s -o /dev/null -D - -H "Host: baryo.dev" "$APP/old-about" | tr -d '\r' > "$TMP/redirect.txt"
grep -qE '^HTTP/1.1 30[178]' "$TMP/redirect.txt" || fail "a legacy path is not redirected ($(head -1 "$TMP/redirect.txt"))"
grep -qi '^location: /about$' "$TMP/redirect.txt" || fail "a legacy path is not redirected to where the CMS says"
[ "$(status rckoronadal.org /old-about)" = "404" ] || fail "rckoronadal.org follows baryo.dev's redirect"
echo "ok: a miss asks the tenant's redirects map before it is a 404 ($(head -1 "$TMP/redirect.txt"))"

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

# soon.example is holding, its holding page is the page at /coming-soon, and KEY is a share link the
# stand-in CMS redeems for it with 30 days left. SHORT has one hour left.
KEY=soon-share-key-0123456789
SHORT=soon-short-key-0123456789
held() { grep -q 'data-press="holding"' "$1" && grep -q "Opening in October" "$1" && grep -q 'name="robots" content="noindex' "$1"; }
real() { grep -q "launch-plans" "$1" && ! grep -q 'data-press="holding"' "$1"; }
curl -s -D "$TMP/soon-head.txt" -H "Host: soon.example" "$APP/" > "$TMP/soon.html"
held "$TMP/soon.html" || fail "soon.example does not answer its holding page, from the page at /coming-soon, with noindex"
grep -q "Opening soon" "$TMP/soon.html" || fail "the holding page is not rendered as the page at /coming-soon"
grep -q 'id="share-invalid"' "$TMP/soon.html" || fail "the holding page has no notice for a link that did not redeem"
# Next streams the page, so the status is sent before the page stops. What must hold is that a path
# that exists and one that does not answer alike.
[ "$(status soon.example /blog/launch-plans)" = "$(status soon.example /no-such-page)" ] || fail "the holding page tells an existing path from a missing one"
grep -q "launch-plans" "$TMP/soon.html" && fail "the holding page carries soon.example content"
grep -q -e "Latest from the club" -e "Soon Club post" "$TMP/soon.html" && fail "the collection block on the holding page lists the site's posts"
tr -d '\r' < "$TMP/soon-head.txt" | grep -qi '^cache-control:.*no-store' || fail "the holding page may be stored by a cache"
page soon.example /blog/launch-plans > "$TMP/soon-post.html"
held "$TMP/soon-post.html" || fail "a post on soon.example does not answer the holding page"
grep -q "Soon Club post" "$TMP/soon-post.html" && fail "the holding page carries the post's title"
[ "$(status soon.example /feed.xml)" = "404" ] || fail "soon.example serves its feed while holding"
[ "$(status soon.example /sitemap.xml)" = "404" ] || fail "soon.example serves its sitemap while holding"
page soon.example /robots.txt | grep -q "Disallow: /" || fail "soon.example robots does not disallow while holding"
asset=$(grep -o '/_next/static/[^"]*\.js' "$TMP/soon.html" | head -1)
[ -n "$asset" ] && [ "$(status soon.example "$asset")" = "200" ] || fail "static assets are not reachable while holding"
[ "$(status soon.example /api/revalidate)" != "404" ] || fail "the revalidate endpoint is not reachable while holding"
echo "ok: soon.example answers the page at /coming-soon as its holding page, collection block and all with no posts listed, no feed or sitemap, robots and assets reachable"

curl -s -D "$TMP/share-head.txt" -H "Host: soon.example" "$APP/_share?key=$KEY" > "$TMP/share.html"
tr -d '\r' < "$TMP/share-head.txt" | grep -q '^HTTP/1.1 200' || fail "/_share is not served while holding"
tr -d '\r' < "$TMP/share-head.txt" | grep -qi '^cache-control: no-store' || fail "/_share may be stored by a cache"
grep -q "location.hash" "$TMP/share.html" || fail "/_share does not read the fragment"
grep -q '/api/share/redeem' "$TMP/share.html" || fail "/_share does not post to the redeem route"
grep -q "<noscript>.*needs JavaScript" "$TMP/share.html" || fail "/_share does not explain itself without JavaScript"
grep -q "$KEY" "$TMP/share.html" && fail "/_share echoed a key from the query string"
echo "ok: /_share is served while holding, reads only the fragment, and explains itself without JavaScript"

redeem() { curl -s -o /dev/null -D - -X POST -H "Host: soon.example" "$@" | tr -d '\r'; }
for refused in wrong-key-but-long-enough-000 soon-throttled-key-0123456789; do
  redeem --data-urlencode "key=$refused" "$APP/api/share/redeem" > "$TMP/soon-wrong.txt"
  grep -q '^HTTP/1.1 303' "$TMP/soon-wrong.txt" || fail "a link the CMS refused ($refused) is not redirected"
  grep -qi '^location: \(https\?://[^/]*\)\?/#share-invalid$' "$TMP/soon-wrong.txt" || fail "a link the CMS refused ($refused) does not land on the notice"
  grep -qi '^set-cookie:' "$TMP/soon-wrong.txt" && fail "a link the CMS refused ($refused) was given a cookie"
done
redeem -H 'content-type: application/x-www-form-urlencoded' --data '' "$APP/api/share/redeem?key=$KEY" > "$TMP/soon-query.txt"
grep -qi '^set-cookie:' "$TMP/soon-query.txt" && fail "the key was read from the query string"
redeem -H "Origin: https://evil.example" --data-urlencode "key=$KEY" "$APP/api/share/redeem" > "$TMP/soon-cross.txt"
grep -qi '^set-cookie:' "$TMP/soon-cross.txt" && fail "a post from another origin was given a cookie"
redeem -H "Origin: https://soon.example" -H "Sec-Fetch-Site: same-origin" --data-urlencode "key=$KEY" "$APP/api/share/redeem" > "$TMP/soon-key.txt"
grep -q '^HTTP/1.1 303' "$TMP/soon-key.txt" || fail "a valid link is not redirected"
grep -qiE '^location: (https?://[^/]+)?/$' "$TMP/soon-key.txt" || fail "a valid link does not redirect to /"
grep -qi '^cache-control: no-store' "$TMP/soon-key.txt" || fail "the redeem answer may be stored by a cache"
cookie=$(grep -i '^set-cookie: __Host-press-share=' "$TMP/soon-key.txt") || fail "a valid link did not set its cookie"
for part in HttpOnly Secure SameSite=Lax "Path=/"; do
  echo "$cookie" | grep -qi "; $part" || fail "the share cookie is missing $part"
done
age=$(echo "$cookie" | sed -nE 's/.*Max-Age=([0-9]+).*/\1/p')
[ -n "$age" ] && [ "$age" -le 86400 ] && [ "$age" -gt 86000 ] || fail "a link with 30 days left did not get the 24 hour cap (Max-Age=$age)"
echo "$cookie" | grep -qi "domain=" && fail "the share cookie names a domain"
echo "$cookie" | grep -q "$KEY" && fail "the share cookie carries the key"
COOKIE=$(echo "$cookie" | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]*);.*/\1/')
short_age=$(redeem --data-urlencode "key=$SHORT" "$APP/api/share/redeem" | sed -nE 's/^[Ss]et-[Cc]ookie: .*Max-Age=([0-9]+).*/\1/p')
[ -n "$short_age" ] && [ "$short_age" -le 3600 ] || fail "a link with an hour left outlived its expiry (Max-Age=$short_age)"
echo "ok: a valid link sets a signed host-only HttpOnly, Secure, SameSite=Lax cookie ending at the sooner of its expiry and 24 hours; refused, throttled, query string and cross-origin set nothing"

sign() { printf 'press-share.%s.%s' "$1" "$2" | openssl dgst -sha256 -hmac "$3" -binary | base64 | tr '+/' '-_' | tr -d '='; }
past=$(( $(date +%s) - 60 ))
future=$(( $(date +%s) + 3600 ))
EXPIRED="__Host-press-share=$past.$(sign soon "$past" "$PREVIEW_SECRET")"
FORGED="__Host-press-share=$future.$(sign soon "$future" some-other-secret-that-is-long-enough-0000)"
OTHER_TENANT="__Host-press-share=$future.$(sign baryo "$future" "$PREVIEW_SECRET")"
HAND_SIGNED="__Host-press-share=$future.$(sign soon "$future" "$PREVIEW_SECRET")"

visit() { curl -s -D "$2.head" ${3:+-H "Cookie: $3"} -H "Host: soon.example" "$APP$1" > "$2"; }
visit / "$TMP/soon-1.html" "$COOKIE"; real "$TMP/soon-1.html" || fail "the share cookie does not show the real site"
tr -d '\r' < "$TMP/soon-1.html.head" | grep -qi '^cache-control:.*no-store' || fail "the real site behind holding may be stored by a cache"
grep -q 'href="/coming-soon"' "$TMP/soon-1.html" && fail "the holding page is in the navigation while holding"
grep -q 'href="/about"' "$TMP/soon-1.html" || fail "the other header links went with the holding page's"
visit / "$TMP/soon-2.html"; held "$TMP/soon-2.html" || fail "a visitor without a session got the real site after one with it"
visit / "$TMP/soon-3.html" "$COOKIE"; real "$TMP/soon-3.html" || fail "a visitor with a session got the holding page after one without it"
visit / "$TMP/soon-4.html" "__Host-press-share=$KEY"; held "$TMP/soon-4.html" || fail "the raw key as a cookie shows the real site"
visit / "$TMP/soon-5.html" "$EXPIRED"; held "$TMP/soon-5.html" || fail "an expired cookie shows the real site"
visit / "$TMP/soon-6.html" "$FORGED"; held "$TMP/soon-6.html" || fail "a cookie signed with another secret shows the real site"
visit / "$TMP/soon-7.html" "$OTHER_TENANT"; held "$TMP/soon-7.html" || fail "a cookie signed for another tenant shows the real site"
visit / "$TMP/soon-8.html" "$HAND_SIGNED"; real "$TMP/soon-8.html" || fail "a cookie signed with the secret for this tenant does not show the real site"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE" -H "Host: soon.example" "$APP/sitemap.xml")" = "404" ] || fail "the sitemap is served to a visitor with a session"
page baryo.dev / > "$TMP/baryo-beside-soon.html"
grep -q "shipping-notes" "$TMP/baryo-beside-soon.html" || fail "baryo.dev is not its real site beside a holding tenant"
grep -q 'data-press="holding"' "$TMP/baryo-beside-soon.html" && fail "baryo.dev got a holding page"
[ "$(status baryo.dev /feed.xml)" = "200" ] || fail "baryo.dev lost its feed beside a holding tenant"
curl -s -o /dev/null -D - -X POST -H "Host: baryo.dev" --data-urlencode "key=$KEY" "$APP/api/share/redeem" | grep -qi '^set-cookie:' && fail "baryo.dev handed out a share cookie"
grep -q "$KEY" "$TMP/two-hosts-app.log" && fail "the share key reached the log"
echo "ok: expired, forged, other-tenant and raw-key cookies are held back, and baryo.dev is unaffected"

# A tenant's webhook key, as the README derives it: HMAC-SHA256 of "revalidate.<tenant>" keyed with the secret.
tenant_key() { printf 'revalidate.%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //'; }
# purge <host> <signing key>
purge() {
  local body='{"event":"Published"}' ts sig
  ts=$(date +%s)
  sig=$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$2" -hex | sed 's/^.* //')
  curl -s -X POST -H "Host: $1" -H 'content-type: application/json' \
    -H "x-barako-timestamp: $ts" -H "x-barako-signature: sha256=$sig" --data "$body" "$APP/api/revalidate"
}

before=$(curl -s "http://127.0.0.1:$CMS_PORT/__reads")
[ "$(purge baryo.dev "$SECRET" | grep -c '"revalidated":true')" = "0" ] || fail "the shared secret still purges a tenant"
[ "$(purge baryo.dev "$(tenant_key rckoronadal)" | grep -c '"revalidated":true')" = "0" ] || fail "rckoronadal's key purges baryo.dev"
purge baryo.dev "$(tenant_key baryo)" | grep -q '"tag":"cms:baryo"' || fail "the purge with baryo's key did not name baryo's tag"
page rckoronadal.org / > /dev/null
page baryo.dev / > /dev/null
after=$(curl -s "http://127.0.0.1:$CMS_PORT/__reads")
node -e '
  const [b, a] = process.argv.slice(1).map((s) => JSON.parse(s));
  if (a.rckoronadal !== b.rckoronadal) { console.log("rckoronadal re-read after baryo purge", b, a); process.exit(1); }
  if (a.baryo <= b.baryo) { console.log("baryo was not re-read after its purge", b, a); process.exit(1); }
' "$before" "$after" || fail "a purge on one tenant reached the other"
echo "ok: only baryo's own key purges baryo.dev, not the shared secret or rckoronadal's key, and the purge left rckoronadal's cached reads in place"

kill $CMS_PID
wait $CMS_PID 2>/dev/null || true
purge baryo.dev "$(tenant_key baryo)" > /dev/null
[ "$(status baryo.dev /)" = "200" ] || fail "baryo.dev is not 200 with the CMS stopped"
page baryo.dev / > "$TMP/baryo-down.html"
grep -q "BaryoDev" "$TMP/baryo-down.html" || fail "baryo.dev lost its name with the CMS stopped"
grep -q "#1A6B41" "$TMP/baryo-down.html" || fail "baryo.dev lost its palette with the CMS stopped"
grep -q "shipping-notes" "$TMP/baryo-down.html" || fail "baryo.dev lost its posts with the CMS stopped"
[ "$(status rckoronadal.org /)" = "200" ] || fail "rckoronadal.org is not 200 with the CMS stopped"
echo "ok: with the CMS stopped and the cache purged, baryo.dev answers 200 as itself"
