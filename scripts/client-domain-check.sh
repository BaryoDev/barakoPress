#!/usr/bin/env bash
# A second client on its own domain, served by the shipped compose.yml and Caddyfile with no edit.
#
# Brings the stack up as it ships, with an override file that changes only what a laptop or a CI
# runner has to: the published ports (loopback, high numbers), throwaway secrets, `*.localhost` names
# for the three fixed domains, a seed file that registers two tenants with one `*.localhost` domain
# each, Caddy's local CA for the client domains, and a stand-in for the console. Then it proves, over
# TLS verified against Caddy's own root and never with -k:
#
#   a. the second client's domain answers 200 with its own title and not the first's
#   b. the first client's domain answers with its own title and not the second's
#   c. a `*.localhost` name that no tenant holds gets no certificate, so the handshake fails
#   e. a fixed name still reaches its own block (the API's health check on API_DOMAIN)
#
# Not checked: a viewer signing in on the client's domain (d). It cannot be done from here, for
# three reasons that are each enough. The reference site's press.config.ts does not enable
# `viewerSessions`, so its sign-in route answers 404. The site calls the API at http://api:8080,
# and the engine refuses to post a password over http to anything but loopback. And a seed file
# creates its members with no password. Each would be a change to what ships, not to this check.
#
# The console is replaced by a one-line Caddy responder. The real image is large and nothing here
# reads it: Caddy only needs the name to resolve inside the network.
#
# The host a client sends comes from its TLS handshake and cannot be trusted, so nothing below
# builds a command, a URL or a log line from one. Every name used is fixed in this file.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT=press-client-domain
HTTPS_PORT=${CDC_HTTPS_PORT:-18443}
HTTP_PORT=${CDC_HTTP_PORT:-18080}
API_PORT=${CDC_API_PORT:-18099}
for p in "$HTTPS_PORT" "$HTTP_PORT" "$API_PORT"; do
  case $p in '' | *[!0-9]*) echo "FAIL: a port is not a number" >&2; exit 1 ;; esac
done

SITE_DOMAIN=site.localhost
API_DOMAIN=api.localhost
CONSOLE_DOMAIN=console.localhost
CLIENT_A=a-client.localhost
CLIENT_B=b-client.localhost
UNKNOWN=unregistered-client.localhost
TITLE_A="Alder Fields Weekly"
TITLE_B="Birch Hollow Bulletin"

TMP=$(mktemp -d)
ENVF="$TMP/env"
OVERRIDE="$TMP/override.yml"
SEED="$TMP/seed.json"
ROOT="$TMP/root.crt"

dc() { docker compose -p "$PROJECT" --env-file "$ENVF" -f compose.yml -f "$OVERRIDE" "$@"; }

# Container logs carry whatever a client sent, so each line is stripped of control characters and
# indented, which also stops a line that starts with "::" being read as a workflow command.
logs() {
  dc logs --no-color --tail 40 "$1" 2>&1 | tr -cd '\11\12\40-\176' | sed 's/^/  | /' || true
}

finish() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ -f "$OVERRIDE" ]; then
    echo "--- last caddy log lines"
    logs caddy
    echo "--- last api log lines"
    logs api
  fi
  if [ -f "$OVERRIDE" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap finish EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

# The pinned Caddy image is read from compose.yml, so the stand-in cannot drift from the real proxy.
CADDY_IMAGE=$(grep -m1 -o 'caddy:2-alpine@sha256:[0-9a-f]*' compose.yml || true)
[ -n "$CADDY_IMAGE" ] || fail "no pinned caddy image found in compose.yml"

# Throwaway values, made fresh each run and never printed.
rand() { openssl rand -hex 16; }
ADMIN_PASSWORD="Aa1-$(rand)"
cat > "$ENVF" <<ENV
DB_PASSWORD=$(rand)
JWT_KEY=$(rand)$(rand)
ADMIN_PASSWORD=$ADMIN_PASSWORD
PRESS_SECRET=$(rand)$(rand)
ACME_EMAIL=ci@example.test
SITE_DOMAIN=$SITE_DOMAIN
API_DOMAIN=$API_DOMAIN
CONSOLE_DOMAIN=$CONSOLE_DOMAIN
ENV

# Seed file domains are trusted, so they are verified without a DNS record. Members: the initial
# admin (its address is admin@example.com) is made a member of each tenant, so one login can write
# to either. Entries cannot come from a seed file, so they are written through the API below.
cat > "$SEED" <<JSON
{
  "version": 1,
  "tenants": {
    "client-a": {
      "name": "Alder Fields",
      "isActive": true,
      "domains": ["$CLIENT_A"],
      "members": [{ "email": "admin@example.com", "roles": ["Admin"] }]
    },
    "client-b": {
      "name": "Birch Hollow",
      "isActive": true,
      "domains": ["$CLIENT_B"],
      "members": [{ "email": "admin@example.com", "roles": ["Admin"] }]
    }
  }
}
JSON
chmod 644 "$SEED"

# The whole override. Everything else, the Caddyfile included, is what ships.
#   caddy.ports: loopback and high ports, in place of 80 and 443 (!override replaces the list).
#   caddy.CLIENT_TLS_ISSUER: Caddy's local CA signs the client names. The default would try a public
#     ACME server for a *.localhost name, which Caddy refuses, and CI must not contact one anyway.
#   api: the seed file, and a loopback port so this script can log in and write entries.
#   console: a stand-in, with its health check off.
cat > "$OVERRIDE" <<YAML
services:
  caddy:
    ports: !override
      - "127.0.0.1:$HTTP_PORT:80"
      - "127.0.0.1:$HTTPS_PORT:443"
    environment:
      CLIENT_TLS_ISSUER: "issuer internal"
  api:
    ports:
      - "127.0.0.1:$API_PORT:8080"
    environment:
      Seed__File: /seed/seed.json
    volumes:
      - $SEED:/seed/seed.json:ro
  console:
    image: $CADDY_IMAGE
    command: ["caddy", "respond", "--listen", ":3000", "console stand-in"]
    healthcheck:
      disable: true
YAML

echo "starting the stack"
if ! dc up -d --build --wait --wait-timeout 900 > "$TMP/up.log" 2>&1; then
  tail -n 40 "$TMP/up.log" | tr -cd '\11\12\40-\176' | sed 's/^/  | /'
  fail "the stack did not come up"
fi

# The API has no in-container health check, so wait for it from outside. Host: api is one of its
# AllowedHosts.
api_up=0
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: api' "http://127.0.0.1:$API_PORT/health")" = "200" ]; then
    api_up=1
    break
  fi
  sleep 2
done
[ "$api_up" = 1 ] || fail "the API did not answer /health"

# Calls to the API from this script. The tenant is a fixed handle, sent as X-Tenant.
api() { # method path tenant [json body]
  local method=$1 path=$2 tenant=$3 body=${4:-}
  local args=(-s --fail-with-body --max-time 30 -X "$method" -H 'Host: api' -H "X-Tenant: $tenant")
  if [ -n "$TOKEN" ]; then args+=(-H "authorization: Bearer $TOKEN"); fi
  if [ -n "$body" ]; then args+=(-H 'content-type: application/json' -d "$body"); fi
  curl "${args[@]}" "http://127.0.0.1:$API_PORT$path"
}

seed_tenant() { # handle title slug
  local handle=$1 title=$2 slug=$3 login
  TOKEN=
  login=$(api POST /api/auth/login "$handle" "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}") \
    || fail "admin could not sign in to tenant $handle"
  TOKEN=$(printf '%s' "$login" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') \
    || fail "the sign-in to tenant $handle returned no token"
  api POST /api/content-types/blueprints/blog "$handle" '{}' >/dev/null \
    || fail "the blog blueprint was not applied to tenant $handle"
  api POST /api/contents "$handle" "{\"contentType\":\"post\",\"status\":\"Published\",\"data\":{\"Title\":\"$title\",\"Slug\":\"$slug\",\"Body\":\"Written for $handle only.\",\"PublishedAt\":\"2026-01-01T00:00:00Z\"}}" >/dev/null \
    || fail "the post was not published in tenant $handle"
  TOKEN=
}
TOKEN=
seed_tenant client-a "$TITLE_A" alder-fields
seed_tenant client-b "$TITLE_B" birch-hollow
echo "ok: two tenants, each with one published post"

# Caddy writes its local root when it first issues for a fixed name, which is at start.
for _ in $(seq 1 30); do
  dc cp caddy:/data/caddy/pki/authorities/local/root.crt "$ROOT" >/dev/null 2>&1 && [ -s "$ROOT" ] && break
  sleep 2
done
[ -s "$ROOT" ] || fail "Caddy's local root certificate was not found"

# One request over verified TLS. The name resolves to loopback for this call only. Prints the status
# and writes the body to the file; a failed handshake prints 000.
fetch() { # fixed-name path out-file
  curl -s --max-time 25 --cacert "$ROOT" --resolve "$1:$HTTPS_PORT:127.0.0.1" \
    -o "$3" -w '%{http_code}' "https://$1:$HTTPS_PORT$2" || true
}

# The first visit to a client name makes Caddy request its certificate, which takes a moment, so a
# few tries are allowed. Bounded.
wait_for_200() { # fixed-name out-file
  local code=000
  for _ in $(seq 1 12); do
    code=$(fetch "$1" / "$2")
    [ "$code" = "200" ] && break
    sleep 3
  done
  printf '%s' "$code"
}

code=$(wait_for_200 "$CLIENT_B" "$TMP/b.html")
[ "$code" = "200" ] || fail "the second client's domain did not answer 200 over verified TLS (last status $code)"
grep -qF "$TITLE_B" "$TMP/b.html" || fail "the second client's domain does not show its own title"
if grep -qF "$TITLE_A" "$TMP/b.html"; then fail "the second client's domain shows the first client's title"; fi
echo "ok: the second client's domain is served over TLS with its own title and not the first's"

code=$(wait_for_200 "$CLIENT_A" "$TMP/a.html")
[ "$code" = "200" ] || fail "the first client's domain did not answer 200 over verified TLS (last status $code)"
grep -qF "$TITLE_A" "$TMP/a.html" || fail "the first client's domain does not show its own title"
if grep -qF "$TITLE_B" "$TMP/a.html"; then fail "the first client's domain shows the second client's title"; fi
echo "ok: the first client's domain shows its own title and not the second's"

# No tenant holds this name, so the API's TLS check answers 404 and Caddy never issues for it. What
# the visitor sees is a failed handshake, not a page, so curl reports no status at all.
if curl -s --max-time 25 --cacert "$ROOT" --resolve "$UNKNOWN:$HTTPS_PORT:127.0.0.1" \
  -o /dev/null "https://$UNKNOWN:$HTTPS_PORT/"; then
  fail "a name no tenant holds completed a TLS handshake"
fi
echo "ok: a name no tenant holds gets no certificate"

# The fixed names still win. API_DOMAIN reaches the API, not the catch-all and so not the site.
code=$(fetch "$API_DOMAIN" /health "$TMP/health.txt")
[ "$code" = "200" ] || fail "the API's own name did not answer its health check (status $code)"
echo "ok: a fixed name still reaches its own block"

echo "all checks passed"
