# barakoPress

The renderer for barakoCMS sites: pages from blocks, collections and docs trees, cached until the CMS
says otherwise.

It ships as an npm package, `barakopress`, that a Next app mounts route by route, and as a container
image, `ghcr.io/baryodev/barako-press`, that serves every site a [barakoCMS](https://github.com/BaryoDev/barakoCMS)
instance knows. Pages are server rendered and cached per tenant, so ordinary traffic never reaches
Postgres and a publish is live in one request. You own it and run it where you choose. Nothing is
metered per seat, record or environment.

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
| `app/page.tsx` | `default`, `generateMetadata` | `createHome(config, blocks)`, `createHomeMetadata(config)` |
| `app/blog/[slug]/page.tsx` | `default`, `generateMetadata` | `createBlogPost(config)`, `createPostMetadata(config)` |
| `app/authors/[slug]/page.tsx` | `default` | `createCollectionDetail(config, "author", { related: { collection: "post", via: "Author" } })` |
| `app/categories/[slug]/page.tsx` | `default` | `createCollectionDetail(config, "category", { related: { collection: "post", via: "Category" } })` |
| `app/feed.xml/route.ts` | `GET` | `createFeed(config)` |
| `app/sitemap.ts` | `default` | `createSitemap(config)` |
| `app/robots.ts` | `default` | `createRobots(config)` |
| `app/api/revalidate/route.ts` | `POST`, `GET` | `createRevalidateRoute(config)` |
| `app/[...path]/page.tsx` | `default`, `generateMetadata` | `createPage(config, blocks)`, `createPageMetadata(config)` |
| `app/doctors/page.tsx` | `default` | `createCollectionIndex(config, "doctors")` |
| `app/doctors/[slug]/page.tsx` | `default`, `generateMetadata`, `generateStaticParams` | `createCollectionDetail(config, "doctors")`, `createCollectionMetadata(config, "doctors")`, `createCollectionStaticParams(config, "doctors")` |
| `app/api/blocks/route.ts` | `GET`, `OPTIONS` | `createBlockSchemaRoute(config, blocks)`, `createBlockSchemaPreflight()` |
| `app/api/blocks/bindings/route.ts` | `GET`, `OPTIONS` | `createBindingReportRoute(config, blocks)`, `createBindingReportPreflight()` |
| `app/layout.tsx` | `default`, `generateMetadata` | `createSiteLayout(config, { blocks })`, `createSiteMetadata(config)` |
| `app/%5Fshare/route.ts` | `GET` | `createSharePage(config)` |
| `app/api/share/redeem/route.ts` | `POST` | `createShareRedeemRoute(config)` |

`createHome` serves whatever the tenant picked for `/`: the page at `HomePath`, the index of
`HomeCollection`, or the post index when it picked neither, which is what `createBlogIndex` did and
still does for a site that mounts that instead.

`via` is the post's field that references the author or category. `createArchive(config, "author")`
makes that same call and is `@deprecated` since 0.7.0, as is `createArchiveStaticParams`, which is
`createCollectionStaticParams`.

Mount only what you want. Nothing requires anything else. The paths only have to agree with the
`routes` in your config, which is what every generated link is built from.

`createBlogPostPreview` replaces `createBlogPost` when you want `?preview=TOKEN` to render a draft.
It reads `searchParams`, which forces the route dynamic, so a site using `output: "export"` takes
`createBlogPost` and gives up preview. `createPostStaticParams` and `createCollectionStaticParams`
exist for that static case.

A site that draws its own post page keeps preview by giving the detail route its own view, and maps
the item with the engine's own mapping:

```tsx
export default createCollectionDetail(config, POST_COLLECTION, {
  preview: true,
  view: ({ config, item, preview }) => <MyPost post={postFromItem(config, item)} preview={preview} />,
});
```

The binding report says why a binding on a page did not resolve, so an editor fixes it in barakoBrew
instead of asking whoever can read the server log. Ask for one page at a time, by `?slug=` or
`?path=`, and each problem names the binding as typed, the reason (`unknown scope`, `unbound scope`
or `no value`), and the block and field it came from. It reports the page as rendered, not as
stored, so a `{{item.X}}` outside a repeat is reported as an unbound scope. Give it the `query`
option the page's route works out to. `createPage` and `createHome` default it by where they are
mounted: off under a request-time site's `app/%5Fpress/[site]`, where a `{{query.X}}` is an unbound
scope for every visitor, and on for a route outside it, such as a build-time site's
`app/[...path]`. The report defaults to off wherever it is mounted, so for a page on a route outside
the tenant segment pass `{ query: true }`, or the report calls a `{{query.X}}` that works on the page
an unbound scope. It is never anonymous:
the caller presents the tenant's key as `Authorization: Bearer`, derived from `PRESS_SECRET` and
printed by `barakopress bindings-key <tenant>`. Answers are never cached.

`Card` and `PostView` are exported too, for a site that wants its own page but the engine's markup.

## What it renders

Each of these is its own page in `docs/`, because npm shows only the first 64 KiB of a README.

- [Collections](https://github.com/BaryoDev/barakoPress/blob/master/docs/collections.md): any content type as a list and a detail page, with
  references, related items, a long-form article layout, and a collection drawn as a docs tree with
  sections, products, search and an in-page index.
- [Pages](https://github.com/BaryoDev/barakoPress/blob/master/docs/pages.md): the Pages module's page tree and menus at a mount, reserved slugs,
  and pages built from blocks: layout and content primitives, lists and groups, the block budget.
- [Bindings](https://github.com/BaryoDev/barakoPress/blob/master/docs/bindings.md): `{{site.X}}`, `{{page.X}}`, `{{item.X}}` and `{{query.X}}`
  in a block's props, sources that read a collection, repeats, counts, sums and groups.
- [Presets, the block library and plugins](https://github.com/BaryoDev/barakoPress/blob/master/docs/blocks.md): named arrangements of primitives,
  the blocks every site gets, and plugin packages built into a derived image.
- [Sites and the header](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md): one image serving many sites, identity and theme from
  each tenant's settings, labels, holding mode and share links, and the built-in header.
- [The look](https://github.com/BaryoDev/barakoPress/blob/master/docs/look.md): the theme, tokens and tones, style recipes, inline marks, and assets
  used exactly as supplied.
- [Caching and the webhook](https://github.com/BaryoDev/barakoPress/blob/master/docs/caching.md): what a publish drops, running more than one
  container, the render cache, the one secret, and a key per tenant.
- [Deploying](https://github.com/BaryoDev/barakoPress/blob/master/docs/deploying.md): the reference app, its container image, the compose stack and
  the BaryoVM release manifests.

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

| Key | Default | Tenant setting | What |
| --- | --- | --- | --- |
| `site` | required | `Name`, `Tagline`, `Url` and one per field | Name, tagline and absolute origin. Every absolute link is built from the origin |
| `types` | `post`, `author`, `category` | operator only | The content type names |
| `fields` | the blueprint's PascalCase names | operator only | Which field holds what |
| `pageFields` | the blueprint's PascalCase names | operator only | Which field on the page type holds what |
| `routes` | `/blog`, `/authors`, `/categories` | operator only | Where you mounted each route |
| `pageSizes` | 20, 50, 1000, 50 | `PageSizes` | Index, feed, sitemap, archive. The sitemap one bounds the entries one collection contributes, and is not a page size: the sitemap pages to that number at whatever size the API allows |
| `cacheTag` | `cms` | operator only | The tag this site purges. Two sites on one server need two tags |
| `backstopSeconds` | 300 | operator only | How long a cached read may live with no webhook. 0 disables it |
| `cmsTimeoutMs` | 5000 | operator only | How long any one call to the CMS may take, a share link redemption included. Past it the call has failed, and a request-time site answers from its last good copy |
| `locale` | `en-GB` | `Locale` | Passed to `toLocaleDateString` |
| `currency` | none | `Currency` | The ISO code a `money` binding formats with. Unset, an amount renders as a plain number |
| `embedHosts` | seven player hosts | `EmbedHosts` | The hosts an `embed` block may frame |
| `presets` | none | `Presets` | Named blocks saved as arrangements of primitives. See [Presets](https://github.com/BaryoDev/barakoPress/blob/master/docs/blocks.md#presets) |
| `cmsUrl` | `CMS_URL`, or `http://localhost:5005` | operator only | Where the CMS is, from this server. The variable is read when the CMS is called, not when this file runs |
| `tenant` | `CMS_TENANT` | operator only | Tenant slug, for a multi-tenant deployment. On a request-time site, pins every host to it. The variable is read when the CMS is called, not when this file runs |
| `sites` | off | operator only | Request-time identity and theme from the tenant's site settings. See [One build, many sites](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md#one-build-many-sites) |
| `pages` | off | operator only | Where the Pages module's pages are mounted. `""` is the site root. It has to match a route file on disk, which is why it is not a tenant's to set |
| `reservedSlugs` | the routes and the engine's files | `ReservedSlugs`, added to them | First path segments a root-mounted page may not take. Adds to the defaults |
| `regions` | off | `HeaderPath`, `HeaderTone`, `FooterPath`, `FooterTone` | The header and the footer as block regions |
| `collections` | the blog's `post`, `author` and `category` | `Collections` | Content types rendered as lists and detail pages, with each index's copy, index page and default byline. See [Collections](https://github.com/BaryoDev/barakoPress/blob/master/docs/collections.md) |
| `optionStyles` | none | `OptionStyles` | Tone, icon and label by `type.field` and option, for `colorBy` |
| `optionColors` | none | `OptionColors` | The same, when a tone is all an option has. Read as `optionStyles` |
| `labels` | English | `Labels` | The words the screens print for a visitor. See [Sites](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md) |
| `store` | in process | operator only | Where the state a fleet has to agree on is kept: kept answers, the host map, the replay guard, the generation of each cache tag. Needed only when more than one container serves the site. See [Running more than one container](https://github.com/BaryoDev/barakoPress/blob/master/docs/caching.md#running-more-than-one-container) |
| `home` | the post index | `HomePath`, `HomeCollection` | What `createHome` serves at `/`. See [Sites](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md) |
| `theme` | the barakoCMS palette | `Colors`, `Fonts`, `Radii`, `Layout`, `Space`, `Text`, `Tokens`, `Tones`, `StyleRecipes` | Colours, faces, radii, column widths, a site's own named values and tones, and the looks its blocks can name. See [The look](https://github.com/BaryoDev/barakoPress/blob/master/docs/look.md) |

The third column is the whole of the split. A key marked operator only is one the image decides for
every tenant it serves, and each is that for a reason you can name: `types`, `fields`, `pageFields`
and `routes` are what the blog factories compile against, `cacheTag`, `backstopSeconds`,
`cmsTimeoutMs`, `cmsUrl`, `tenant`, `sites` and `store` are facts about the deployment rather than
the site,
and `pages` has to match a route file on disk. Everything else is that tenant's data, edited in
barakoBrew, and wins over what this file said. A tenant that sets nothing renders exactly as the
file says.

### The environment

Every environment value this package reads goes through one reader, `readEnv` in `src/env.ts`, and
every one of them is read on the call that uses it. None is read when `press.config.ts` runs. That
used to differ per variable: `CMS_URL` and `CMS_TENANT` were read inside `defineConfig`, the rest
per request, so when a value was read depended on which value it was.

| Variable | What it sets |
| --- | --- |
| `CMS_URL` | Where the delivery API is. `cmsUrl` in the config wins |
| `CMS_TENANT` | Pins the process to one tenant. `tenant` in the config wins |
| `CMS_DEFAULT_TENANT` | The tenant for a host the CMS does not know. `sites.defaultTenant` wins |
| `CMS_RENDERER_KEY` | Sent to the CMS as `X-Barako-Renderer-Key` on every delivery read when the CMS URL is https or loopback, and when a share link is redeemed, so the CMS rate limits by renderer. See [Share links](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md#one-build-many-sites) |
| `PRESS_CONSOLE_ORIGINS` | Browser origins allowed to read the block schema, comma separated |
| `PRESS_SECRET` | The HMAC key for everything this renderer signs. See [One secret](https://github.com/BaryoDev/barakoPress/blob/master/docs/caching.md#one-secret) |
| `REVALIDATE_SECRET` | The webhook key before `PRESS_SECRET`, read only while that is unset |
| `PRESS_PREVIEW_SECRET` | The share key before `PRESS_SECRET`, read only while that is unset |
| `PRESS_FONT_ORIGINS` | The origins a font stylesheet may be linked from. Unset, Google Fonts only. See [One build, many sites](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md#one-build-many-sites) |

Values are used exactly as the environment has them, untrimmed. A secret with a trailing space is a
different HMAC key, so trimming one here would stop a webhook that verifies today.

The reference app's `Dockerfile` also takes two build arguments, read when the image is built and
not by the package: `PRESS_DEPLOY` names a directory under `deploy/` to lay over the reference app,
and `PRESS_TRAILING_SLASH=true` sets Next's `trailingSlash` in `next.config.ts`. See
[The reference deployment](https://github.com/BaryoDev/barakoPress/blob/master/docs/deploying.md#the-reference-deployment-in-this-repository).

**A site is build time or request time.** Without `sites`, identity is build time: the index, the
feed, the sitemap and robots are prerendered, so anything *your own* `press.config.ts` reads from the
environment is baked when you build, not when the server starts. Write per-site values as literals in
that file. Getting this wrong is how a client site ships with the vendor's name in its masthead. With
`sites`, identity is data in the CMS and read per request: see
[One build, many sites](https://github.com/BaryoDev/barakoPress/blob/master/docs/sites.md#one-build-many-sites).

## The caching design, which is the whole point

A static site reads content at build time, so an edit is invisible until someone rebuilds and
redeploys. A naive dynamic site reads the database on every page view. This does neither.

```
request  ->  Next cache  ->  HTML                        (no database)
publish  ->  signed webhook  ->  revalidate  ->  next render reads once
```

Every read in `src/delivery.ts` is tagged with your `cacheTag`. `POST /api/revalidate` drops that tag
the moment barakoCMS says something changed, so a publish is live in one request and the steady state
is no database reads. [Caching and the webhook](https://github.com/BaryoDev/barakoPress/blob/master/docs/caching.md) has the rest: what a publish
drops, the render cache, running more than one container, and wiring the webhook.

## Deploying

The reference app in `app/` is a site that consumes this package by its name, the way yours does. It
is published as `ghcr.io/baryodev/barako-press` for linux/amd64 and linux/arm64, tagged with each
release's version and `latest`, and `dev` from master. The compose stack, the site-only compose file,
the BaryoVM release manifests and building a site's own image with an overlay are in
[Deploying](https://github.com/BaryoDev/barakoPress/blob/master/docs/deploying.md).

## What it reads

The `blog` blueprint barakoCMS ships: `post`, `category`, `author`, `page`. Apply it with
`POST /api/content-types/blueprints/blog`. Field names are PascalCase because that is what the
blueprint creates. The default names live in `src/config.ts`, the blueprint's field map and
`REFERENCE_FIELDS`, and a site's config replaces any of them.

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

## The look check

Before a site's domain moves to this stack, the look check proves the rebuilt pages look like the
design that was approved. It takes pairs, a reference and a rebuilt page, screenshots both at 390px
and 1280px in the same run, and fails the page whose pixels moved more than that page allows,
handing back the reference, the rebuilt screenshot and a diff image.

The reference is either a prototype file on disk with a page state, or the live URL of the site
being replaced. The pages themselves are data the site owns, so adding a page, or a whole site,
never means editing the job:

```yaml
jobs:
  look:
    uses: BaryoDev/barakoPress/.github/workflows/look-check.yml@master
    with:
      pairs: look/pairs.json
      variables: '{"REBUILT_BASE":"https://staging.rckoronadal.org"}'
```

The pair list format, the per page threshold and the list of things that would otherwise make a run
flake are in [docs/look-check.md](https://github.com/BaryoDev/barakoPress/blob/master/docs/look-check.md). `npm run look:selftest` runs the check twice
over fixture pages, once green and once against a deliberate colour change, which is how anyone can
see for themselves that it fails when it should.

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
itself: the decision and what it costs are recorded in [CLAUDE.md](https://github.com/BaryoDev/barakoPress/blob/master/CLAUDE.md).

Releasing is in [RELEASING.md](https://github.com/BaryoDev/barakoPress/blob/master/RELEASING.md). No npm token is stored anywhere.

## Status

0.8.0, on npm as `barakopress` and on ghcr as `ghcr.io/baryodev/barako-press`. It renders
barakocms.com and press.baryo.dev against real barakoCMS instances. barakocms.com still runs a
derived image of the engine, with a plugin and a small overlay; #166 to #170 track what it takes to
run it on the published image as configuration. Other open gaps are in the issues, among them
visitor-switchable theme variants (#80) and a generated Open Graph image (#81).
