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
