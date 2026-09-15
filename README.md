# barakoPress

A blog engine for [barakoCMS](https://github.com/BaryoDev/barakoCMS), shipped as a package. Server
rendered, cached until the CMS says otherwise, so ordinary traffic never reaches Postgres and a
publish is live in one request.

It is an engine, not a site. Content types in barakoCMS are defined at runtime, so a client's posts
are as likely to be an `article` with a `Headline` as the blog blueprint's `post` with a `Title`.
Every name is configuration, which is why the same package serves a site mounted at `/writing` with
no authors and no categories.

Part of BaryoDev, alongside [barakoCMS](https://github.com/BaryoDev/barakoCMS) (the API) and
[barakoBrew](https://github.com/BaryoDev/barakoBrew) (the console).

## Install

```bash
npm install barakopress
```

Needs Next 16 or later, React 19 or later, and Node 20.9 or later. Next and React are peer
dependencies, so your app's copies are the ones that run.

**No consumer build configuration.** The package ships compiled JavaScript and type declarations, so
there is no `transpilePackages` line to add and nothing to configure in `next.config.ts`. If you are
coming from 0.1.0, which shipped TypeScript sources, you can delete the
`transpilePackages: ["barakopress"]` line when you upgrade. Leaving it in does no harm, it just does
nothing.

## Quick start

One config file, then one route file per route you want. A route file is two or three lines: a Next
route is decided by its path, and a package cannot create files in your app.

**`press.config.ts`**

```ts
import { defineConfig } from "barakopress";

export const config = defineConfig({
  site: {
    name: "My Blog",
    tagline: "Things I wrote",
    url: "https://myblog.example",
  },
});
```

That is everything a site on the `blog` blueprint needs. `CMS_URL` comes from the environment.

**`app/page.tsx`**

```tsx
import { createBlogIndex } from "barakopress";
import { config } from "@/press.config";

export default createBlogIndex(config);
export const revalidate = 300;
```

**`app/blog/[slug]/page.tsx`**

```tsx
import { createBlogPost, createPostMetadata } from "barakopress";
import { config } from "@/press.config";

export default createBlogPost(config);
export const generateMetadata = createPostMetadata(config);
export const revalidate = 300;
```

**`app/layout.tsx`**

```tsx
import "barakopress/styles.css";
```

`export const revalidate` stays in your file on purpose. Next reads route segment config from the
file that owns the route and does not reliably follow a re-export, and the caching window is your
decision, not the engine's.

### The rest of the routes

| Create | Export | From |
| --- | --- | --- |
| `app/page.tsx` | `default` | `createBlogIndex(config)` |
| `app/blog/[slug]/page.tsx` | `default`, `generateMetadata` | `createBlogPost(config)`, `createPostMetadata(config)` |
| `app/authors/[slug]/page.tsx` | `default` | `createArchive(config, "author")` |
| `app/categories/[slug]/page.tsx` | `default` | `createArchive(config, "category")` |
| `app/feed.xml/route.ts` | `GET` | `createFeed(config)` |
| `app/sitemap.ts` | `default` | `createSitemap(config)` |
| `app/robots.ts` | `default` | `createRobots(config)` |
| `app/api/revalidate/route.ts` | `POST`, `GET` | `createRevalidateRoute(config)` |
| `app/[...path]/page.tsx` | `default`, `generateMetadata` | `createPage(config, blocks)`, `createPageMetadata(config)` |
| `app/api/blocks/route.ts` | `GET`, `OPTIONS` | `createBlockSchemaRoute(blocks)`, `createBlockSchemaPreflight()` |
| `app/layout.tsx` | `default`, `generateMetadata` | `createSiteLayout(config, { blocks })`, `createSiteMetadata(config)` |
| `app/%5Fshare/route.ts` | `GET` | `createSharePage()` |
| `app/api/share/redeem/route.ts` | `POST` | `createShareRedeemRoute(config)` |

Mount only what you want. Nothing requires anything else. The paths only have to agree with the
`routes` in your config, which is what every generated link is built from.

`createBlogPostPreview` replaces `createBlogPost` when you want `?preview=TOKEN` to render a draft.
It reads `searchParams`, which forces the route dynamic, so a site using `output: "export"` takes
`createBlogPost` and gives up preview. `createPostStaticParams` and `createArchiveStaticParams` exist
for that static case.

`Card` and `PostView` are exported too, for a site that wants its own page but the engine's markup.

### Pages and navigation from the Pages module

With `BarakoCMS.Pages` installed, the CMS owns the page tree: which pages are in the menu, their
order, their nesting and each page's path. Mount it with `pages`:

```ts
export const config = defineConfig({ sites: {}, pages: "" });
```

`""` is the site root. `"/docs"` serves the CMS page at `/about` on `/docs/about`. Leaving `pages` out
means the site has no page tree, and nothing below asks for one. Then one catch-all route,
`app/[[...path]]/page.tsx`, or `app/[...path]/page.tsx` when `app/page.tsx` keeps `/`:

```tsx
import { createPage, createPageMetadata } from "barakopress";
import { blocks, config } from "@/press.config";

export default createPage(config, blocks);
export const generateMetadata = createPageMetadata(config);
export const revalidate = 300;
```

- `createPage` reads `GET /api/public/pages/resolve?path=` and renders the page's blocks, or its
  body, with breadcrumbs above the title when the page has a parent. Mounted on a `[slug]` route
  instead, it reads the page type by slug as before.
- `createSiteLayout` draws `GET /api/public/pages/navigation` in the header. `Navigation` draws the
  items in the order it received them and links to the paths it was given, under the mount. It does
  not sort, nest, filter or derive a path. A menu that cannot be read is no menu, not a broken page,
  and while holding the holding page is left out of it.
- A miss asks `GET /api/public/redirects/resolve?path=` before it is a 404, because a catch-all is
  where a rebuilt site's old URLs land. A 301 answers as a permanent redirect and anything else as a
  temporary one. A destination that is not a site path or an http or https URL is ignored.
- **Reserved slugs.** Next answers a static route before a catch-all, so a root page slugged `blog`
  or `feed.xml` would silently never render. At the root mount, a path whose first segment is
  reserved is a 404 and is never asked for, and it is left out of the sitemap and static params with
  a warning. The list is the first segment of each configured route plus `api`, `feed.xml`,
  `sitemap.xml`, `robots.txt`, `_next`, `_share` and `favicon.ico`; `reservedSlugs` adds to it. Give
  barakoCMS the same list as `Modules:Pages:ReservedSlugs` and an editor is refused the slug on save.
- **Contract.** Both bodies carry `contract`, and this renderer reads the range in `PAGES_CONTRACT`
  (1 to 1). A body outside it logs a warning and reads as absent: no menu, no page. A public site does
  not stop rendering because a menu shape moved.
- The sitemap lists the pages in the menu, and `createPageStaticParams` returns their path segments on
  a build-time site, because the module publishes no other public list of paths. A page outside the
  menu renders on request.

`Navigation`, `Breadcrumbs`, `getNavigation(config)`, `getPageByPath(config, path)`,
`getRedirect(config, path)` and `pageHref(config, path)` are exported for a site that draws its own
layout. Every read goes through the same tagged, cached, per tenant read as the rest of the site.

### Pages built from blocks

A page can hold an ordered list of blocks in a json field, each `{ "type": ..., "props": { ... } }`.
The blueprint's `page` type has no such field, so add one:

```bash
curl -X POST "$CMS_URL/api/content-types/page/fields" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"fieldName":"Blocks","displayName":"Blocks","type":"json"}'
```

A page with a non-empty list renders its blocks. A page without one renders its `Body` as before.
Field names come from `pageFields` in the config, and the type from `types.page`.

```json
[
  { "type": "richText", "props": { "markdown": "## Hello" } },
  { "type": "columns", "props": { "columns": [
      [{ "type": "image", "props": { "src": "https://example.com/a.png", "alt": "A" } }],
      [{ "type": "callToAction", "props": { "heading": "Talk to us", "label": "Contact", "href": "/contact" } }]
  ] } },
  { "type": "collection", "props": { "collection": "post", "limit": 3, "heading": "Latest" } }
]
```

Built in: `richText` (markdown), `image`, `columns` (up to four lists of blocks), `callToAction` and
`collection` (the newest posts, or authors or categories when the site has those routes).

A site adds its own blocks, or replaces a built-in, by registering a definition. The fields are the
only description of the props: the renderer reads props through them, and `app/api/blocks` publishes
them for an editor, so the two cannot drift.

```tsx
import { createBlockRegistry, defineBlock } from "barakopress";

const pricing = defineBlock<{ plan: string; price?: number }>({
  type: "pricing",
  label: "Pricing",
  fields: [
    { name: "plan", kind: "text", required: true },
    { name: "price", kind: "number", min: 0 },
  ],
  component: ({ props, theme }) => <p style={{ color: theme.colors.ink }}>{props.plan}: {props.price}</p>,
});

export const blocks = createBlockRegistry(config, [pricing]);
```

**Reading the schema from barakoBrew.** The console usually runs on another origin than the site, so
a browser only lets its block editor read `app/api/blocks` when the site names that origin. Set
`PRESS_CONSOLE_ORIGINS` to a comma separated list, for example
`PRESS_CONSOLE_ORIGINS=https://brew.example.com`. It is read per request. Unset, no origin is
allowed. A listed origin gets `Access-Control-Allow-Origin` echoed back on `GET` and on the `OPTIONS`
preflight, never `*` and never credentials, and every answer carries `Vary: Origin`. Pass
`{ consoleOrigins: [...] }` to both factories to set the list in code instead.

Field kinds are `text`, `markdown`, `url`, `number`, `boolean`, `select` (with `options`) and `slots`
(lists of nested blocks, handed to the component already rendered). The list is editor input, so a
block renders only when its type is registered and every prop passes its field. A present but wrong
value fails the whole block, a `url` must pass the same check markdown links do, and a component
never receives a prop its fields did not declare. A page reads at most 100 blocks in total, nested
ones included, and four levels deep.

`defineBlock<Props, SlotNames>` checks the fields against the props at compile time: every field
names a prop, its kind suits the prop's type, and a prop that is not optional must be `required`.

A component gets `props`, `slots` and `theme`, not the config, because a client component's props
are serialised into the page and the config holds the CMS address. A server block that needs the
config closes over it.

A block that shows something depending on who is looking sets `perViewer: true`. `createPage` leaves
such blocks out, because its output is cached and shared. `createViewerPage` renders them and calls
`connection()` first, so that route is always dynamic. Signing a viewer in, and gating a block by
role, is issue #7.

## Configuring it

`press.config.ts` is the one file a site owns, and the seam the whole package turns on.

```ts
export const config = defineConfig({
  types:  { post: "article", author: undefined, category: undefined },
  fields: { title: "Headline", slug: "Permalink", body: "Story", publishedAt: "RunDate" },
  routes: { post: "/writing" },
  site:   { name: "Client Three", url: "https://clientthree.example" },
});
```

That is a test, not an illustration. CI installs the packed tarball into a separate app, points it at
a content type called `article` with none of the blueprint's field names, no authors and no
categories, and asserts the site renders, links to `/writing`, and produces a feed carrying the
client's own identity.

Only `title` and `body` are required in `fields`. Anything you leave out is a feature the site does
without: the engine never asks the API for that data and never renders an empty slot for it. Naming a
reference type you do not have is worse than useless, because `include=Author` is a 400 from the API
for a post type with no such field.

| Key | Default | What |
| --- | --- | --- |
| `site` | required | Name, tagline and absolute origin. Every absolute link is built from the origin |
| `types` | `post`, `author`, `category` | The content type names |
| `fields` | the blueprint's PascalCase names | Which field holds what |
| `routes` | `/blog`, `/authors`, `/categories` | Where you mounted each route |
| `pageSizes` | 20, 50, 1000, 50 | Index, feed, sitemap, archive |
| `cacheTag` | `cms` | The tag this site purges. Two sites on one server need two tags |
| `backstopSeconds` | 300 | How long a cached read may live with no webhook. 0 disables it |
| `cmsTimeoutMs` | 5000 | How long a read from the CMS may take. Past it the read has failed, and a request-time site answers from its last good copy |
| `locale` | `en-GB` | Passed to `toLocaleDateString` |
| `cmsUrl` | `CMS_URL`, or `http://localhost:5005` | Where the CMS is, from this server |
| `tenant` | `CMS_TENANT` | Tenant slug, for a multi-tenant deployment. On a request-time site, pins every host to it |
| `sites` | off | Request-time identity and theme from the tenant's site settings. See below |
| `pages` | off | Where the Pages module's pages are mounted. `""` is the site root |
| `reservedSlugs` | the routes and the engine's files | First path segments a root-mounted page may not take. Adds to the defaults |
| `theme` | the barakoCMS palette | Colours, faces, radii and column widths. See below |

**A site is build time or request time.** Without `sites`, identity is build time: the index, the
feed, the sitemap and robots are prerendered, so anything `press.config.ts` reads from `process.env`
is baked when you build, not when the server starts. Write per-site values as literals in that file.
Getting this wrong is how a client site ships with the vendor's name in its masthead. With `sites`,
identity is data in the CMS and read per request, which is the next section.

### One build, many sites

barakoCMS D22 reverses "identity is build time" for the shared renderer: every site runs the same
image, and what makes a site that site is its tenant's `site` settings entry, edited in barakoBrew.

```ts
export const config = defineConfig({ sites: {} });
```

On each request the engine resolves the tenant, reads that tenant's settings, and renders with them:

1. `CMS_TENANT` (or `tenant`) set: every host is that tenant, with no lookup.
2. `sites.tenantHeader` set and the request carries a valid handle in it: that tenant. Off by default.
3. The host, from `sites.hostHeader` (default `host`), looked up with `GET /api/tenants/by-host/{host}`.
4. `sites.defaultTenant`, or `CMS_DEFAULT_TENANT` read at request time.
5. None of those: a 404. Never another tenant's site.

A handle is only ever read from the request through a header the operator named. `X-Tenant` and
`X-Forwarded-Host` sent by a caller are ignored unless you configure them, and you should configure
them only behind a proxy that sets the header and strips a caller's value.

The settings are the singleton `site` type from barakoCMS `docs/site-settings.md`
(`POST /api/content-types/blueprints/site`, then publish its one entry). The engine reads `Name`,
`Tagline`, `Url`, `Locale`, `Logo`, `LogoAlt`, `FooterLogo`, `Favicon`, `ShareImage`, `Copyright`,
`Colors` (the theme slots), `Fonts` (Google Fonts family names), `Radii`, `Layout`, `TopBar`,
`HeaderLinks`, `FooterColumns` and `SocialLinks`. `OptionColors`, `Variants` and colour names outside
the theme slots are not rendered yet. Every value is checked for shape; one that fails, and any the
entry leaves out, keeps the configured value, so a half-filled theme renders. A link is a path on the
site or an absolute http or https URL. Set `Url`: without it the feed and sitemap fall back to the
host the tenant was found by.

`createSiteLayout` and `createSiteMetadata` render the root layout from all of this: `lang`, the
faces, the palette, the top bar, header links, footer columns, social links and the copyright line.

**Caching per tenant.** Every read carries the tenant in `X-Tenant` and in its cache tag,
`<cacheTag>:<tenant>`. The webhook purges the tag of the tenant its host resolves to, so point each
tenant's webhook at `https://<that tenant's domain>/api/revalidate`, signed with that tenant's own key
(see [One key per tenant](#one-key-per-tenant)). A publish on one tenant leaves every other tenant's
cached reads in place.

**When the CMS is down.** Each successful read is also kept in process, keyed by CMS, tenant and path.
A read that fails with a network error, a 5xx, or no answer within `cmsTimeoutMs` answers from the
last good copy and logs a warning; the next successful read replaces it. For ten seconds after such a
failure that read answers from the copy without asking the CMS, so an outage costs one request per
read every ten seconds rather than one per visitor. Known hosts keep resolving the same way. A page that was cached
for a tenant keeps answering 200 with that tenant's identity and theme. A tenant never gets another
tenant's kept answer.

**Holding mode.** A tenant can show a holding page on every route in place of its site, for a launch,
maintenance or a seasonal break, and share the real site with a few people through site share links.
Two fields on the `site` entry control it:

| Field | Type | What |
| --- | --- | --- |
| `Mode` | string | `Live` or `Holding`. Unset, or anything else, is `Live` |
| `HoldingPath` | string | A site path such as `/coming-soon`. The page the Pages module serves there is the holding page. Empty, or nothing served there, renders the name, tagline and "Coming soon." in the theme |

Holding is presentation, not access control: the API still delivers every published entry. Content
that must stay hidden before launch stays unpublished with a scheduled publish.

While a tenant is holding, for that tenant only:

- every page answers the holding page with `noindex` and `Cache-Control: private, no-store`. A page
  stops in `siteConfig` with a not-found before it reads anything, so its content and its title never
  reach the response. Next has already sent the status by then, so it is 200, the same for a path
  that exists and one that does not;
- the holding page is read with `GET /api/public/pages/resolve?path=<HoldingPath>` and rendered with
  the page renderer and the registry passed to `createSiteLayout(config, { blocks })`;
- a link to `HoldingPath` is left out of the header, top bar and footer. `feed.xml` and `sitemap.xml`
  are 404 for everyone, session or not, and `robots.txt` answers `Disallow: /` with no sitemap line;
- route handlers (revalidate, blocks, `/_share`, `/api/share/redeem`) and `/_next/static` are served
  as usual.

Switching `Mode` is a publish: the webhook purges the tenant's tag and the next request reads the new
settings. No deploy.

**Site share links.** barakoCMS creates, lists and revokes them; anyone who may update the `site` type
can. A client is given `{site Url}/_share#{key}`. The key is in the fragment, so no server log, proxy
or referrer sees it:

1. `/_share` is a tiny page. Its script reads the fragment, removes it from the address and history,
   and posts the key in a form to `/api/share/redeem`. Without JavaScript it says the link needs
   JavaScript. No key is ever accepted in a query string.
2. `/api/share/redeem` asks barakoCMS once, `POST /api/public/site/share-links/redeem` with the key in
   the body and the tenant header. On 200 it sets `__Host-press-share` (HttpOnly, Secure,
   SameSite=Lax, Path=/, no Domain, so only that host gets it) and answers a `no-store` 303 to `/`.
   On 404, 429 or any failure it sets nothing and sends the visitor to `/#share-invalid`, the holding
   page with "This link is not valid or has expired." A post whose `Origin` or `Sec-Fetch-Site` names
   another site is refused the same way. The key is never logged.
3. With a valid cookie that visitor sees the real site for that tenant. A forged, expired or
   other-tenant cookie is ignored.

The cookie holds no key. It is an expiry and an HMAC-SHA256 over the tenant and that expiry, so each
later request is checked in process without asking the CMS, and a cookie made for one tenant opens no
other. It needs one setting:

| Variable | What |
| --- | --- |
| `PRESS_PREVIEW_SECRET` | The HMAC key, at least 32 characters, for example `openssl rand -base64 48`. Read per request. Unset or shorter, no session is issued or accepted and everyone gets the holding page. Every instance behind one domain needs the same value |

**A session lasts until the link expires or for 24 hours, whichever is sooner.** Opening the link
again starts a new one while the link is valid. **A revoked link can keep working for up to 24
hours** for someone who already opened it, because the session is checked here, not in barakoCMS. To
end every session now, change `PRESS_PREVIEW_SECRET`, which does it for every tenant on that
deployment.

Whether a request gets the holding page is decided per request from the cookie, and a request-time
site renders every route dynamically, so a cached render made for a visitor with a session is never
served to one without, or the reverse. A page you write by hand must call `siteConfig(config)` before
it reads or renders anything, which is what keeps it behind the holding page. A build-time site has
no settings entry and no holding mode.

`generateStaticParams` factories return nothing on a request-time site, since there is no tenant at
build. `scripts/two-hosts.sh` runs the built reference app against a stand-in CMS with two tenants
and checks all of the above; CI runs it on every push.

### The look is configuration too

The post screen styles itself from `config.theme`, inline, so it renders correctly whether or not you
import `barakopress/styles.css`. That import is optional and a screen that needs it renders unstyled
for anyone who skips it, which is exactly what happened: barakocms.com never imported it, got an
article at x=0 on a blank page, and stopped using the screen at all.

```ts
export const config = defineConfig({
  site:  { name: "Client Three", url: "https://clientthree.example" },
  theme: { colors: { accent: "#008060" }, layout: { prose: "68ch" } },
});
```

Each group merges over the defaults on its own, so setting one colour keeps the other seventeen. The
groups are `colors` (18 values), `fonts` (`heading`, `body`, `mono`), `radii` (`panel`, `control`,
`pill`) and `layout` (`prose`, `wide`, `gutter`). `DEFAULT_THEME` is exported if you want to read the
values or build a palette from them.

Loading the faces is the site's job, not the engine's. The default theme names Sora, Manrope and
JetBrains Mono with real fallback stacks, and a `<link>` in your root layout is what makes them
arrive.

**Three slots**, for what belongs to the site rather than the engine:

```tsx
<PostView
  config={config}
  post={post}
  headerBackdrop={<Bean />}      {/* decoration behind the header band */}
  beforeBody={<RoleStrip />}     {/* a wide band under the header */}
  afterBody={<Newsletter />}     {/* the foot of the reading column */}
/>
```

They are not a way to compose a post out of arbitrary sections. Anything that has to sit between two
paragraphs belongs to the block model, which is issue #6, because only the body knows where it goes.

Read time is derived from the body at 200 words a minute, with fenced code blocks excluded, so there
is no field to fill in and nothing to keep in sync.

### Related posts, if the CMS has the AI module

`listRelated` asks `BarakoCMS.AI` for the posts closest to this one and hands them to `PostView`,
which renders a band of cards with the similarity score on each. `createBlogPost` already does the
call, so a site using the factory gets it for nothing.

Nothing about it is required. A CMS without the module answers 404, a type that is not publicly
deliverable answers 404, a module installed but not enabled answers an empty list, and an
unreachable CMS throws. All four end the same way: an empty array, no band, no heading, no empty
state. The reader of a site without the module never learns the feature exists.

The post being read is its own closest match, so the fetch asks for more than it renders and drops
itself. A hit with no slug is dropped too, because there is nothing to link it to.

Turning it on is the CMS's job, not this package's: `dotnet add package BarakoCMS.AI`, point
`Ai:EmbeddingBaseUrl` at an Ollama instance, set `Ai:Enabled`, and index the type.

## The caching design, which is the whole point

A static site reads content at build time, so an edit is invisible until someone rebuilds and
redeploys. A naive dynamic site reads the database on every page view. This does neither.

```
request  ->  Next cache  ->  HTML                        (no database)
publish  ->  signed webhook  ->  revalidate  ->  next render reads once
```

Every read in `src/delivery.ts` is tagged with your `cacheTag`. `POST /api/revalidate` drops that tag
the moment barakoCMS says something changed, so a publish is live in one request and the steady state
is no database reads.

Each read also carries a backstop, 300 seconds by default. That is not for correctness, it is for the
deployment where nobody ever created the webhook: without it their blog would be empty forever and
nothing would say why. With it, a missing webhook degrades publishing from instant to a few minutes.

**The cache invalidation is configuration, not code.** In barakoBrew: a workflow on your post content
type, trigger `Published`, one Webhook action with the URL and a shared secret. Nothing is deployed
to change it.

### Wiring the webhook

1. Put a long random value in `REVALIDATE_SECRET` where your app runs.
2. In barakoBrew, create a workflow on your post content type, event `Published`.
3. Add a Webhook action with `Url` set to `https://your-site/api/revalidate` and `Secret` set to the
   same value. On a site with `sites` configured, the `Secret` is the tenant's key instead, below.

### One key per tenant

With `sites` configured, one app serves many tenants, and each tenant's admin can read and edit its
own workflows. So no tenant is given `REVALIDATE_SECRET`. Each delivery is verified with a key derived
for the tenant its host resolves to:

```
key = lowercase hex HMAC-SHA256(REVALIDATE_SECRET, "revalidate." + tenant handle)
```

A delivery signed with one tenant's key gets a 401 on every other tenant's host, and so does one
signed with `REVALIDATE_SECRET` itself. Print a tenant's key where `REVALIDATE_SECRET` is set:

```bash
npx barakopress revalidate-key baryo
# or, with no Node:
printf 'revalidate.%s' baryo | openssl dgst -sha256 -hmac "$REVALIDATE_SECRET" | sed 's/^.* //'
```

Both read the secret from the environment and print only the key. Paste it into the `Secret` of that
tenant's Webhook action, with `Url` on that tenant's domain. A new tenant needs nothing on the
renderer. Changing `REVALIDATE_SECRET` changes every tenant's key, so each workflow needs its new one.

A site without `sites` (one build, one site) verifies with `REVALIDATE_SECRET` itself, as before.

**Upgrading a multi-tenant site to 0.4.0 is a breaking change.** Every tenant's workflow holds
`REVALIDATE_SECRET` today, and after the upgrade that value verifies for no tenant: deliveries get a
401 and purges stop, with the backstop the only refresh. Before or right after deploying, print each
tenant's key and put it in that tenant's Webhook `Secret`. Then change `REVALIDATE_SECRET` and print
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
delivery gets a 401. If `REVALIDATE_SECRET` is unset the endpoint answers 503 and purges nothing,
because an open cache-purge endpoint is a free denial of service.

## What it reads

The `blog` blueprint barakoCMS ships: `post`, `category`, `author`, `page`. Apply it with
`POST /api/content-types/blueprints/blog`. Field names are PascalCase because that is what the
blueprint creates, and `src/cms.ts` is the only file in the package that knows any field name.

Only published entries of a type opted into public delivery appear. Ordering is asked of the API
rather than applied to the page that came back, because sorting one page of results gives you the
newest of an arbitrary page.

## Security

Markdown is rendered as untrusted input in `src/markdown.ts`: raw HTML is escaped rather than passed
through, link and image destinations must be http, https or mailto, and text is escaped into every
attribute. An editor is authenticated, so this is the second line of defence, not the first. The
trade is that an author cannot embed raw HTML or an iframe. When you want that, the answer is a
content field your frontend renders deliberately, not a hole here.

The same renderer is its own entry, `barakopress/markdown`, for code that runs in the browser, such
as an editor previewing a post. The only package it reaches is `marked`, where the main entry also
pulls in `next/cache`, `next/server` and `node:crypto`.

```ts
import { renderMarkdown } from "barakopress/markdown";

renderMarkdown(source);                                     // what the site renders
renderMarkdown(source, { headingIds: false, newTab: true }); // no ids, links open a new tab
```

Both options change only the markup around what is already sanitised. `headingIds` defaults to true
and `newTab` to false, which is the site's output.

## Two behaviours that were measured, not assumed

**`revalidateTag` needs `{ expire: 0 }`, not a named profile.** Next 16 made the second argument
mandatory. Passing `"max"` left the prerendered sitemap stale indefinitely.

**Cache warming after a purge does nothing, so there is none.** An earlier version fetched the main
pages after purging, on the theory that Next serves one stale response after a purge and the server
should absorb it rather than a reader. Measured against a CMS that logged every read, those fetches
caused zero reads: `{ expire: 0 }` already makes the next request a blocking miss. It cost three
requests per delivery and tripled what an attacker got from one captured signature, for nothing.

## The reference deployment in this repository

`app/` is not the product. It is a site that consumes this package by its name, exactly as yours
does, so the package cannot quietly depend on something only its own repository has. It comes with a
container, a compose stack with Caddy terminating TLS, and a BaryoVM release manifest.

```bash
cp .env.example .env      # point CMS_URL at your instance, set REVALIDATE_SECRET
npm install
npm run build && npm start
```

Deploying that stack to a VM:

```bash
baryovm vm provision blog1                     # or bring your own VM
baryovm vm bootstrap blog1                     # installs Docker, and only Docker
baryovm vm harden blog1                        # sshd policy and fail2ban
baryovm stack add blog --vm blog1 --sudo --release-file ./baryovm.release.json
baryovm stack release blog
```

Before the first release, three DNS names have to point at the machine (`SITE_DOMAIN`, `API_DOMAIN`,
`CONSOLE_DOMAIN`) and a `.env` has to exist on it at `/opt/barakopress/.env`. The release refuses to
start without that file, and refuses again if `REVALIDATE_SECRET` is empty, because a stack that
comes up with no secret can never be told that content changed. Only ports 80 and 443 are published:
the API, the console and the site are reachable only through Caddy on the compose network.

## Working on the engine

```bash
npm install
npm run build:package     # src to dist: JS, declarations and source maps
npm run watch             # the same, in watch mode, while iterating
npm run typecheck
npm run build             # builds the package, then the reference app
```

`app/` imports `barakopress`, not `../src`, so it resolves through `dist` like any other consumer.
That means `dist` has to exist before the app builds, which is why `npm run dev` and `npm run build`
run the package build first. While changing `src/`, leave `npm run watch` going in one terminal and
`next dev` in another.

Why there is a build step at all, when every consumer is a Next app that could compile TypeScript
itself: the decision and what it costs are recorded in [CLAUDE.md](CLAUDE.md).

Releasing is in [RELEASING.md](RELEASING.md). No npm token is stored anywhere.

## Status

Early. The blog works end to end against a real instance. Known gaps, all tracked upstream: no media
picker, no rich editor, and no visitor theme variants.
