# Caching and the webhook

## What a publish drops

A read carries a second, narrower tag beside the site's own: the entry's when it read one entry, the
type's when it read a list, a search, the site settings or the page tree. barakoCMS names the content
type and sends the entry's public data with every delivery, so a publish drops that type's tag and
that entry's tag, and leaves every other entry of the type cached. Correcting one typo on a school
with a thousand news posts re-renders that post and the lists it appears in, not the other 999.

A delivery that names no content type, or one this site renders nothing of, drops the site's own tag,
which is every read it has cached. That is what every delivery did before this, so a workflow posting
a body of its own keeps working.

A response barakoCMS marks `Cache-Control: no-store` is not cached: the class is remembered against
that path and every later read of it asks the CMS uncached, carrying no tag. That is how a type that
has to be fresh to the minute lives beside pages cached for hours.

## Running more than one container

The kept answers, the host to tenant map, the webhook replay guard and the generation of each cache
tag are in process by default, which is right for one container and wrong for two: a purge reaches
one of them through the load balancer, and the others keep serving their own copies until the
backstop runs out.

Pass a `store` on the config and they share it. It is three methods over anything the deployment
already runs:

```ts
import type { PressStore } from "barakopress";

const store: PressStore = {
    async get(key) { return (await redis.get(key)) ?? null; },
    async set(key, value, ttlSeconds) { await (ttlSeconds ? redis.set(key, value, { EX: ttlSeconds }) : redis.set(key, value)); },
    async delete(key) { await redis.del(key); },
    // Only when the key is absent, atomically. This is what honours a replayed delivery once.
    async add(key, value, ttlSeconds) { return (await redis.set(key, value, { NX: true, ...(ttlSeconds ? { EX: ttlSeconds } : {}) })) !== null; },
};
```

A purge one container receives then reaches the rest: the honoured delivery writes a generation
against each tag it dropped, and a read carries the newest generation of its own tags in the URL it
asks the CMS for, so a container that was never told is asking for something it has never cached.
Next's own data cache stays per container; what crosses is the knowledge that it is out of date.

Each read also carries a backstop, 300 seconds by default. That is not for correctness, it is for the
deployment where nobody ever created the webhook: without it their blog would be empty forever and
nothing would say why. With it, a missing webhook degrades publishing from instant to a few minutes.

**The cache invalidation is configuration, not code.** In barakoBrew: a workflow on each content type
the site renders, trigger `Published`, one Webhook action with the URL and a shared secret. Nothing is deployed
to change it.

## The render cache

Reads being cached is half of it. The other half is not rendering the page again, and for a
request-time site that used to be impossible: resolving the tenant meant reading the request host,
reading a header makes a route dynamic, and Next never keeps a dynamic route. One container serving
forty domains re-rendered every page for every visitor, with every read under it already cached.

Next keys what it keeps by the path and by nothing else. There is no `Vary` and no second key to
add. So whatever a render depends on has to be in the path, and three things are:

| In the segment | Why |
| --- | --- |
| the tenant | two tenants must never share an entry. This is the whole reason the segment exists |
| the gate | `public`, or `shared` for a request carrying a valid share session. A holding tenant answers differently for each, so each gets its own entry |
| the host | the site's origin when the tenant's settings leave `Url` empty. Two hosts on one tenant are two renders, not one |

The proxy writes them, as `/_press/<tenant>~<gate>~<host>/<path>`, and it is the only thing that
does: a path that arrives under `/_press` from outside is a 404, because otherwise
`https://one.example/_press/other~public~other.example/` would render another tenant's site on this
tenant's domain. A host the CMS does not know is a 404 before anything renders, so an invented host
never makes an entry: only a host a tenant owns can put one there.

**What is cached.** The index, the pages tree, the collection indexes and the archives, per tenant
and per path. `revalidateTag` drops a tenant's renders along with its reads, so the webhook that was
already purging one purges both, and a publish on one tenant leaves every other tenant's renders in
place. The first few views of a path answer `STALE` rather than `HIT` while the reads under them are
still filling Next's data cache; after that it is `HIT` with no render and no read.

**What is not cached, deliberately.**

| Not cached | Why |
| --- | --- |
| a route that reads `?preview=` | a draft must never be in a shared cache, and reading the query is what keeps the route out of it. `createBlogPostPreview` is such a route; `createBlogPost` is not |
| a page binding `{{query.X}}` | same reason. On a kept route the query is not handed to the blocks at all, so the binding is reported as an unbound scope and renders as nothing. A site that wants it writes `createPage(config, blocks, { query: true })` and leaves `generateStaticParams` out of that file |
| `createViewerPage` | per viewer by definition. It calls `connection()`, and a route that does cannot be kept |
| the feed, the sitemap and robots | `sitemap.ts` and `robots.ts` have to sit at the root of the app tree, so neither can carry a tenant segment. They resolve their own tenant and stay dynamic |
| `/_share` and the redeem route | per visitor |

**Which routes are kept is the consumer's call, in the consumer's file**, the same as `revalidate`.
A page route that exports `createSiteStaticParams()` is kept; one that does not is rendered per
request. That is also the switch for the two rows above: a route that reads the query leaves it out.

**Nothing downstream may keep a copy.** Every rewritten answer carries `Cache-Control: private,
no-store`, which is what a request-time site has always sent. Next's cache is the server's own and is
not that header, so the render is still kept here. What stays true is that a browser or a proxy
holding `/` is never holding one visitor's gate for the next visitor.

## One secret

`PRESS_SECRET` keys everything this renderer signs: each tenant's webhook key, each tenant's binding
report key and each share session cookie. A key derived from it puts its purpose first in what it
signs (`revalidate.`, `bindings.` or `press-share.`), so one derived for one purpose never verifies as
another. Webhook keys are derived per tenant on a request-time site, binding report keys when the
tenant is pinned or resolved per request. Elsewhere `PRESS_SECRET` itself is the key, so a
build-time site with no pinned tenant verifies its webhook and its binding report with the same
value. It is read per request and has one rule for every
purpose: at least 32 characters, for example `openssl rand -base64 48`.

| When `PRESS_SECRET` is | Webhooks | Share sessions | Binding reports |
| --- | --- | --- | --- |
| 32 characters or more | verified with it | signed with it | verified with it |
| set but shorter | refused with 503 | none issued or accepted | refused with 503 |
| unset | `REVALIDATE_SECRET`, as in 0.3.0 | `PRESS_PREVIEW_SECRET` | refused with 503, since there is no older name |

The older names are read only when `PRESS_SECRET` is unset, so a site that set them keeps working, and
the keys derive byte for byte as before, so a key already pasted into a tenant's workflow keeps
verifying. A `REVALIDATE_SECRET` shorter than 32 characters still verifies and logs a warning once,
until 1.0.0. A `PRESS_PREVIEW_SECRET` shorter than 32 characters opens no session, as before.

Moving to the new name is copying the value: `PRESS_SECRET` set to what `REVALIDATE_SECRET` held
derives the same tenant keys, provided it is 32 characters or more. A shorter one has to be replaced,
and each tenant given its new key.

## Wiring the webhook

1. Put a random value of at least 32 characters in `PRESS_SECRET` where your app runs.
2. In barakoBrew, create a workflow for each content type the site renders, event `Published`. A
   workflow matches one content type, so a site whose posts are an `article` type needs it on
   `article`, and one on `post` never fires.
3. Add a Webhook action to each with `Url` set to `https://your-site/api/revalidate` and `Secret`
   set to the same value. On a site with `sites` configured, the `Secret` is the tenant's key
   instead, below.

## One key per tenant

With `sites` configured, one app serves many tenants, and each tenant's admin can read and edit its
own workflows. So no tenant is given `PRESS_SECRET`. Each delivery is verified with a key derived
for the tenant its host resolves to:

```
key = lowercase hex HMAC-SHA256(PRESS_SECRET, "revalidate." + tenant handle)
```

A delivery signed with one tenant's key gets a 401 on every other tenant's host, and so does one
signed with `PRESS_SECRET` itself. Print a tenant's key where `PRESS_SECRET` (or `REVALIDATE_SECRET`) is set:

```bash
npx barakopress revalidate-key baryo
# or, with no Node:
printf 'revalidate.%s' baryo | openssl dgst -sha256 -hmac "${PRESS_SECRET:-$REVALIDATE_SECRET}" | sed 's/^.* //'
```

Both read the secret from the environment and print only the key. Paste it into the `Secret` of that
tenant's Webhook action, with `Url` on that tenant's domain. A new tenant needs nothing on the
renderer. Changing `PRESS_SECRET` changes every tenant's key, so each workflow needs its new one.

A site without `sites` (one build, one site) verifies with `PRESS_SECRET` itself, as it did with
`REVALIDATE_SECRET`. Its workflow holds that value, so give it a value no other deployment uses.

**Upgrading a multi-tenant site to 0.4.0 is a breaking change.** Every tenant's workflow holds
`REVALIDATE_SECRET` today, and after the upgrade that value verifies for no tenant: deliveries get a
401 and purges stop, with the backstop the only refresh. Before or right after deploying, print each
tenant's key and put it in that tenant's Webhook `Secret`. Then set a new `PRESS_SECRET` and print
the keys again, because every tenant admin has seen the old value and could derive any tenant's key
from it.

The barakoCMS webhook body does not name its tenant yet, so the host is what picks the key. Once the
body carries the tenant (barakoCMS #868), a delivery whose body names a different tenant than its host
resolves to is to be refused.

**If your site sets `trailingSlash: true`, the webhook URL needs the slash.** Next redirects
`/api/revalidate` to `/api/revalidate/` with a 308, and barakoCMS does not follow redirects on a
webhook, deliberately: following one was an SSRF hole, because the guard checked only the first hop.
So a URL without the slash gets a 308, the delivery is recorded as failed, it retries five times and
gives up, and the cache is never purged. The site keeps working because of the backstop, so the only
symptom is that publishing feels slow.

barakoCMS refuses to sign a delivery to an `http://` URL unless `Webhooks:AllowInsecureSignedUrls` is
on, which is for a loopback receiver in a lab. In production the URL is https, so this is not in your
way.

Verification follows the recipe in the API's `docs/webhooks.md`: HMAC-SHA256 over
`"<timestamp>.<raw body>"`, compared in constant time, with a 300 second tolerance so a captured
delivery cannot be replayed later, and each signature honoured once per tenant. An unsigned, missigned or stale
delivery gets a 401. If neither `PRESS_SECRET` nor `REVALIDATE_SECRET` is set, or `PRESS_SECRET` is
shorter than 32 characters, the endpoint answers 503 and purges nothing,
because an open cache-purge endpoint is a free denial of service.
