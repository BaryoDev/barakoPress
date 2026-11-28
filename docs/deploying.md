# Deploying

## The reference deployment in this repository

`app/` is not the product. It is a site that consumes this package by its name, exactly as yours
does, so the package cannot quietly depend on something only its own repository has. It comes with a
container, a compose stack with Caddy terminating TLS, and a BaryoVM release manifest.

The container is published as `ghcr.io/baryodev/barako-press`, one manifest list for linux/amd64 and
linux/arm64. Each release tag is pushed as its version (`0.8.0`) and `latest`, and each push to
master as `dev` and `dev-<commit sha>` (`.github/workflows/publish.yml`). It is this reference app
as built here: request-time identity, no overlay and no plugins. A site with its own theme or blocks
builds from the same source; see the overlay below and [Plugin packages](blocks.md#plugin-packages).

### Verify the image

The images are signed with cosign (keyless, from this repository's publish workflow) and carry a
build provenance attestation. You need `cosign` 3 or later (cosign 2 does not read the bundle format these signatures use by default), `docker` and `jq`. Resolve the tag to a digest, then
verify the digest:

```bash
DIGEST=$(docker buildx imagetools inspect --format '{{json .Manifest}}' ghcr.io/baryodev/barako-press:0.8.0 | jq -r '.digest')

cosign verify \
  --certificate-identity-regexp '^https://github\.com/BaryoDev/barakoPress/\.github/workflows/publish\.yml@refs/(heads/master|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/baryodev/barako-press@$DIGEST

cosign verify-attestation --type slsaprovenance1 \
  --certificate-identity-regexp '^https://github\.com/BaryoDev/barakoPress/\.github/workflows/publish\.yml@refs/(heads/master|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/baryodev/barako-press@$DIGEST
```

The same two commands work for `ghcr.io/baryodev/barako-press-source`. Do not run an image that
fails. To run exactly what was verified, deploy by digest.

The images that carry a signature are the version tag, `latest` and `dev`, and `dev-<commit sha>`, of
both `barako-press` and `barako-press-source`. The tag is created before the signature, so a tag is
signed when the Publish run that made it passed. The verify commands above are how to tell. `latest`
and `dev` are copied from the digest that was verified, and move only after the signature and the
attestation check out. A prerelease (a version with a hyphen) is signed under its own version tag and
does not move `latest`. Not signed: the per-architecture images the build pushes by digest, and any
image published before signing was added.

What a signature proves: the image was built by this repository's publish workflow, run from master
or a semver version tag, with the GitHub OIDC issuer. An image published by a manual run with `tag`
set holds that tag's source, but its signature and provenance name the master run and commit that
dispatched it.

```bash
cp .env.example .env      # point CMS_URL at your instance, set PRESS_SECRET
npm install
npm run build && npm start
```

Deploying that stack to a VM:

```bash
baryovm vm provision blog1                     # or bring your own VM
baryovm vm bootstrap blog1                     # installs Docker, and only Docker
baryovm vm harden blog1                        # sshd policy and fail2ban
baryovm stack add blog --vm blog1 --sudo --path /opt/barakopress --release-file ./baryovm.release.json
baryovm stack release blog
```

Before the first release, three DNS names have to point at the machine (`SITE_DOMAIN`, `API_DOMAIN`,
`CONSOLE_DOMAIN`) and a `.env` has to exist on it at `/opt/barakopress/.env`. The release refuses to
start without that file, and refuses again if `PRESS_SECRET` and `REVALIDATE_SECRET` are both empty, because a stack that
comes up with no secret can never be told that content changed. Only ports 80 and 443 are published:
the API, the console and the site are reachable only through Caddy on the compose network.

The API trusts `X-Forwarded-For` from one address only: Caddy's, 172.28.0.10 on a fixed `edge`
subnet, 172.28.0.0/24. If that subnet is already in use on the host, `docker compose up` fails
with an overlapping pool error. Set `EDGE_SUBNET` to a free range and `EDGE_PROXY_IP` to an
address inside it in `.env`; both the network and the API's trusted proxy follow. With a load
balancer in front of Caddy, add its range to Caddy's `trusted_proxies` server option, or Caddy
forwards the load balancer's address as the client's, and the API's rate limits and audit log
count every visitor as one.

### The site alone, on a host that already has a proxy

That stack brings its own Caddy, so on a machine already terminating TLS it fights the existing
proxy for 80 and 443, and on a machine serving other sites that failure is somebody else's outage.
`compose.site.yml` is the other case: one container on a loopback port, joined to the edge network
the existing stack created, reached through the proxy the host already runs. The host supplies the
server block and the certificate.

It is a different compose file and a different manifest, so it is a different registration. `--path`
is the compose directory, which is where the `.env` lives, and `--file` is what stops BaryoVM
reaching for `compose.yml` and starting Caddy:

```bash
baryovm stack add barakopress --vm oracle --sudo \
  --path /opt/barakopress \
  --file compose.site.yml \
  --release-file ./baryovm.site.json
baryovm stack release barakopress
```

The manifest syncs to `/opt/barakopress-src`, not to the compose directory, because it syncs with
`--delete` and that directory holds the `.env`. Its `.env` needs `SITE_PORT`, `CMS_URL` pointing at
the API's container name on the shared network, `SITE_URL` and `PRESS_SECRET`; `SITE_DOMAIN`,
`API_DOMAIN` and `CONSOLE_DOMAIN` belong to the full stack and are not read here.

A site deployed this way writes its identity at build time, so it keeps its config and its root
routes under `deploy/<name>/` and the manifest passes `PRESS_DEPLOY=<name>` to the build. See
`deploy/press.baryo.dev/`. The reason it cannot use the reference app as it stands: every page there
lives under `app/%5Fpress/[site]`, which only the proxy's rewrite reaches, and the rewrite only fires
when the config sets `sites`. With no tenant to resolve to, every page answers 404 while the feed and
the sitemap still work.

A site with its own theme keeps the overlay in its own repository and passes the directory as a
build context instead of copying it into `deploy/`:

```bash
docker buildx build \
  --build-context overlay=../barakocms-site/theme \
  --build-arg PRESS_TRAILING_SLASH=true \
  -t barako-press:barakocms .
```

In compose that is `build.additional_contexts: { overlay: ../barakocms-site/theme }`. The overlay is
laid over the reference app the same way. If it ships its own `app/%5Fpress/`, it is a request-time
site with its own layout and routes, and its tree replaces the reference one; otherwise the tenant
tree is removed as above. `PRESS_TRAILING_SLASH=true` sets Next's `trailingSlash`, for a site whose
URLs end in a slash; configure its webhook URL with the slash too (see the revalidate endpoint).

### Serving a second client on its own domain

The compose stack serves more than its three fixed names. A client's own domain needs no edit to
the `Caddyfile` or to `compose.yml`, and the default tenancy mode (`Single`) is enough: core's
multi-tenancy page says that mode "does not stop a `Single` deployment from registering tenants".

1. In the CMS, create the client's tenant and add its domain to the tenant. The tenant then lists
   the TXT record that proves you control the name, at `_barako-challenge.<the domain>`.
2. Add a `CNAME` on the domain pointing at `SITE_DOMAIN`, the deployment host here, and publish the
   TXT record. Then verify the domain in the CMS. The check reads both records, so an `A` or `AAAA`
   record alone never verifies.
3. Visit `https://<the domain>/`. On that first visit Caddy gets the certificate, and the site finds
   the tenant by the host and serves its pages.

A subdomain such as `blog.client.example` verifies this way. An apex domain cannot hold a `CNAME`,
and core drops a leading `www.` from a claim, so `www.client.example` is checked at the apex too.
Neither verifies through DNS; register those in a seed file (`Seed:File`), whose domains are trusted
and verified on load, and point them at the machine with whatever record your DNS host allows. The
TLS check also answers for the `www.` form of a verified domain, so point that name at the machine
too, or a visit to it fails to get a certificate.

Before Caddy requests a certificate for a name it does not know, it calls the API's TLS check,
`GET /api/tenants/tls-ask?domain=<name>`, over the compose network. The API answers 200 for a
verified domain of an active tenant and 404 for anything else, and a 404 means no certificate is
requested and the TLS handshake fails. A domain that is registered but not yet verified is refused
the same way, so a stranger who points a name at your machine cannot make it request one.

The three fixed names (`SITE_DOMAIN`, `API_DOMAIN`, `CONSOLE_DOMAIN`) keep their own blocks and are
matched before the client block. The client block sends the same response headers as the blog,
from one shared snippet in the `Caddyfile`.

`CLIENT_TLS_ISSUER` is for the check only. `compose.yml` does not pass it to Caddy, so a value in
`.env` has no effect and a deployment keeps Caddy's normal issuers (Let's Encrypt, then ZeroSSL).
`scripts/client-domain-check.sh` sets it to `issuer internal` through its own override file, so
Caddy's own CA signs `*.localhost` names, because Caddy will not request a public certificate for
one. A value Caddy cannot parse stops it from starting. The
`client-domain` CI job runs that script against the shipped files: it checks that each client
domain shows its own tenant's page over verified TLS and that an unregistered name completes no
handshake. It does not check visitor sign-in on a client domain, because the reference site does
not enable `viewerSessions`.

With `compose.site.yml` behind a proxy you already run, none of this is shipped: that proxy needs
its own catch-all with on-demand TLS that asks `GET /api/tenants/tls-ask?domain=<name>` before it
issues, and it must pass the client's `Host` through. Leave `CMS_TENANT` empty, because a pinned
tenant makes the site ignore the host and serve that one tenant on every domain. A proxy without
on-demand TLS needs a certificate added for each client domain.

## Serving under a path

One site can be served under a path prefix, such as `https://playground.baryo.dev/kape-ana/`, when
another site or the proxy owns the root of that host. Set `BASE_PATH=/kape-ana` twice: as a build
argument, because Next reads `basePath` at build time, and as a runtime variable, because the code
that writes links and cookies reads it when it runs. Both must match. Unset, the site is at the root
and nothing below applies.

```bash
docker buildx build --build-arg BASE_PATH=/kape-ana -t barako-press:kape-ana .
```

```nginx
location /kape-ana/ {
    proxy_pass http://127.0.0.1:3100;   # no trailing slash, so the prefix is passed through
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Do not strip the prefix in the proxy. The container serves `/kape-ana/...` itself, including its
assets under `/kape-ana/_next/` and the API routes under `/kape-ana/api/`. The health check must ask
for `/kape-ana/api/health`, since `/api/health` without the prefix answers 404 (`compose.site.yml` does this from
`BASE_PATH`). It renders no page, so a check made before barakoCMS serves the tenant caches nothing. A webhook URL
from barakoCMS is `https://playground.baryo.dev/kape-ana/api/revalidate`.

What the prefix changes in the engine:

- Plain anchors, form actions, `Location` headers, local image paths, markdown links, the feed link
  and the sitemap, robots, feed, canonical and share image addresses carry the prefix. `<Link>` and
  `redirect()` get it from Next.
- The site address in the settings may or may not include the prefix. Either way it is used once.
- A link written in the settings that already starts with the prefix (`/kape-ana/docs`) is taken as
  already prefixed and left alone, so a page of your own whose path starts with the prefix needs
  the prefix written twice (`/kape-ana/kape-ana/docs`) in a header, menu, footer or social link.
- Sites on one host must not sit inside each other's prefix (`/app` and `/app/team`). The viewer
  cookie of `/app` is sent to `/app/team` too, so signing out at one does not end the other.
- The session cookies (viewer and share) are `__Host-` cookies at the root, which require `Path=/`.
  Under a prefix that would send them to every other site on the host. They are renamed to
  `__Secure-press-viewer`, `__Secure-press-share` and `__Secure-press-link` and set with
  `Path=/kape-ana`, still `Secure`, `HttpOnly` and `SameSite=Lax`. A script on another path of the
  same host can still set a cookie for your path, which no cookie prefix prevents, so share a host
  only with sites you trust.
- `robots.txt` is only read by crawlers at the root of a host. The one under the prefix is served,
  but the host's own `/robots.txt` is the one that counts.

Extra blocks go in the same way, as a `plugins` build context: see
[Plugin packages](blocks.md#plugin-packages).

What a first release looks like depends on the config. The reference app resolves its tenant per
request, so its build renders nothing from the CMS, and `baryovm.release.json`'s `verify` checks that
the site, the feed, the sitemap and the API's `/health` answer (`curl --fail`) and that the revalidate
endpoint answers 401. A build-time site under `deploy/<name>/` prerenders during `docker build`,
where the CMS is not reachable, so its index, feed and sitemap are built empty and correct themselves
one revalidate window later. That is why `baryovm.site.json`'s `verify` greps the home page, the
feed and the sitemap for content rather than reading the status code, and why it retries 26 times,
15 seconds apart.
