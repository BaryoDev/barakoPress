# Review rules

Read by the adversarial-review skill (arnelirobles/lean-agent-method) before any code. Each rule is answered yes or no with a line.

## Contract

- **barakoPress is a published package.** barakocms.com and any other site consume its exports, so removing or changing an export, a component prop or a config key is a breaking change under semver. Old helpers stay as thin wrappers until a major release.
- **The API bodies it reads carry their own `contract` integer** (the Pages module's navigation and resolve). A body outside the supported range degrades, for example to no menu, and never stops a public site.

## The renderer computes nothing

- **Rules live in barakoCMS** (D20, D22). Navigation is drawn in the order given and linked to the paths given; nothing here sorts, nests, filters by permission or derives a path.
- **Identity, theme and holding mode come from the tenant's site settings at request time.** Nothing tenant specific is baked into the build.

## Tenancy and caching

- **Every CMS read names its tenant,** and every cache key and cache tag includes it. A test with two tenants proves one tenant's page is never served for another host.
- **A response that differs by a header varies on that header** (the tenant header, the host header when it is not `host`).
- **Holding mode wins** over pages, collections, the sitemap and the feed, and a cached real page is never served to a visitor without a session.
- **Stale-if-error keeps a site up during a CMS outage** without calling the CMS on every request.

## Security

- **Nothing secret in the site settings entry,** which is publicly readable.
- **A share key never appears in a URL the server logs.** It arrives in a fragment and is posted, and the answer sets `Cache-Control: no-store`.
- **Cookies are HttpOnly, Secure, SameSite=Lax and host scoped,** signed with a server secret, and expire.
- **Every outbound call to the CMS has a timeout,** and refuses redirects when it carries a secret.

## Tests

- A bug fix names the test that fails without it.
- `scripts/two-hosts.sh` runs for any change to tenant resolution, caching or holding mode.

## Style

- No em dashes or arrow glyphs, no banned words, and no attribution lines anywhere, review threads included.
