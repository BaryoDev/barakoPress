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
| `app/doctors/page.tsx` | `default` | `createCollectionIndex(config, "doctors")` |
| `app/doctors/[slug]/page.tsx` | `default`, `generateMetadata`, `generateStaticParams` | `createCollectionDetail(config, "doctors")`, `createCollectionMetadata(config, "doctors")`, `createCollectionStaticParams(config, "doctors")` |
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

### Collections: any content type as a list and a detail page

A hospital has departments and doctors, a law firm practice areas and people. Each is a collection: a
content type with a route, a field map, references to other collections, a sort, and whether it has a
feed. The blog is three collections that `defineConfig` derives from `types`, `fields` and `routes`
(`post`, `author` and `category`), and `createBlogIndex`, `createBlogPost` and `createArchive` are thin
wrappers over the collection screens. A site configured the old way changes nothing:
`src/blog-wrappers.test.tsx` renders every blog factory, the feed, the sitemap and the metadata, and
compares them and the requests they make with `test/blog-wrappers.golden.json`, which was written
before collections existed.

On a request-time site the map is the tenant's, from a json field `Collections` on its site settings,
merged over the configured collections by key. A build-time site passes `collections` to
`defineConfig` in the same shape:

```json
{
  "departments": {
    "type": "department", "route": "/departments",
    "fields": { "title": "Name", "body": "About" },
    "noun": ["department", "departments"]
  },
  "doctors": {
    "type": "doctor", "route": "/doctors", "sort": "Name",
    "fields": { "title": "Name", "summary": "Specialty", "image": "Photo" },
    "references": { "Department": { "collection": "departments", "label": "in" } },
    "noun": ["doctor", "doctors"]
  }
}
```

| Key | What |
| --- | --- |
| `type` | The content type. Required |
| `route` | The index is served at the route and an item at `route/slug`. Absent, items are listed and never linked |
| `fields` | `title` (required), `slug`, `summary`, `body` (markdown), `date`, `image`, `imageAlt`, `featured`, `tags`, `url`. Each is a field name or a list tried in order; `@createdAt` and `@updatedAt` read the entry itself |
| `references` | Reference fields, each naming the collection it points into and the word a card puts before the link. Resolved in the same request |
| `sort` | Sent to the API, for example `-PublishedAt` |
| `feed` | Whether `createFeed(config, key)` serves it |
| `sitemap` | On unless `false` |
| `index` | Whether the root catch-all serves an index at the route. On unless `false`; the derived `author` and `category` have it off, so `/authors` stays a 404 unless a route file mounts it |
| `pageSize`, `label`, `noun` | Items on the index, its heading, and how a count reads |
| `colorBy` | A choice field whose option colours the item. See below |

A settings entry that does not read as a collection is left out whole: a type or field that is not a
plain identifier, a route that is not a plain site path, or no title field. The keys `post`, `author`
and `category` are refused from settings, because the blog factories map posts through `types` and
`fields`. A build-time collection mounted at `/` throws in `defineConfig`. When two routes match, the
longer one wins.

A request-time site cannot add a route file per tenant, so the root catch-all from the pages section
also serves every collection with a route: its index at the route, and an item one segment below. A
route file wins where there is one. A collection's first segment is reserved from pages at the root.

A detail page lists the items of the first collection that references it, so `/departments/cardiology`
lists its doctors, the way an author's archive lists their posts. `listRelated(config, "doctors",
department, { via: "Department" })` returns the same list; `listRelated(config, post)` still returns
related posts by semantic search.

**Filtering.** `listCollection(config, "doctors", { filter: { Department: "cardiology" } })` takes a
reference field by the target's slug and any other field by the value it holds, a choice field by its
option. The API takes five filters. `createCollectionIndex(config, key, { filter })` takes the same,
and the `collection` block has `filterField` and `filterValue`.

**A colour per option.** With `colorBy: "AreaOfFocus"` on a `project` collection, the site settings
`OptionColors` entry `{ "project.AreaOfFocus": { "Providing clean water": "sky" } }` names a colour
from `Colors` (a theme slot or a colour written out also works). Each card, item page and collection
block item carries it as a left border, with the option beside it. A name that does not resolve to
something readable as a colour is dropped. A build-time site passes `optionColors` with the colours
written out.

`Card` and `ItemView` are exported for a site that wants its own page, and `Card` still takes a `post`.
`getItem`, `listCollection` and `getGlobals(config)`, the tenant's settings entry as stored, are
exported too.

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

Blocks come in four layers.

**Layout primitives** hold blocks and no content: `section` (a tone, a width and a padding step),
`stack`, `row` (side by side, wrapping on a phone), `grid`, `flow`, `panel` (a card with a tone and
a frame), `spacer` and `divider`.

`row` and `grid` take one list per cell, which suits a designer placing each one. `flow` takes a
single list and lays out whatever is in it, which is what a `repeat` and a preset's `slot` produce:
a card per row that came back, however many that is. Its column count is a choice and not a number,
because only a string field takes a binding, and a preset has to pass its own `columns` through.

**Content primitives** hold content and no layout: `text` (a variant from the theme's type scale),
`richText` (markdown), `image`, `video`, `embed` (an iframe, only for a host in `embedHosts`),
`icon`, `button`, `link`, `list` and `disclosure` (a labelled section that opens; give several the
same `group` and only one is open at a time).

Every primitive takes theme tokens and never a colour or a pixel value. Tones are `page`, `surface`,
`accent` and `inverse`; spacing is `none` to `xxl` from `theme.space`; type is a role from
`theme.text`; corners are `none`, `control`, `panel` or `pill`. A tenant that changes the scale
changes every page built from primitives, and nobody can put one client's blue into a block.

A tone belongs to the band and everything in it: a `section` or a `panel` publishes its ink, its
accent and its hairline, and the blocks inside read those rather than the page's. That is what makes
an inverse band readable, and it is why a block dropped anywhere still looks like it belongs.

**Presets** are named arrangements of primitives, stored as data: the shipped library below, plus
whatever a tenant saves of its own.

**Data blocks** load and choose rather than draw: `source`, `repeat`, `showIf`, `pager` and `slot`.
See bindings below.

Also built in, from before the layers: `columns` (up to four lists of blocks), `callToAction` and
`collection` (the newest posts, or authors or categories when the site has those routes). Pages
already hold these and they render unchanged.

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

### Bindings

Any string prop can hold a placeholder, which is barakoCMS's workflow template syntax with an
optional format and fallback:

```json
{ "type": "text", "props": { "value": "Welcome to {{site.Name}}", "variant": "display" } }
{ "type": "text", "props": { "value": "{{item.Fee | money ?? Free}}" } }
{ "type": "text", "props": { "value": "{{page.PublishedAt | date}}" } }
```

Scopes are `site` (the tenant's settings and resolved identity), `page` (the entry the page
renders), `item` (the row inside a `source` or a `repeat`) and `query` (URL parameters). `viewer`
arrives with #7. Formats are `text`, `date`, `datetime`, `time`, `money`, `number`, `upper` and
`lower`; `money` uses the tenant's `Currency` setting, or a plain amount when it has none.

Paths, formats and fallbacks only. There are no expressions and no JavaScript. Everything resolves
on the server as the request's tenant, before a component is called, so a binding never makes the
browser call the API. A placeholder that finds no value renders its fallback and is reported in the
server log, never a crash. What a binding resolves to is checked against the field again, so a link
whose stored field holds `javascript:` drops the block; and a resolved value is never rescanned, so
one field cannot reach another through its own contents.

`source` loads one entry or a page of them and puts it in scope. `repeat` renders its content once
per row. `pager` draws prev and next links for the `source` it sits in, paged by the API. `showIf`
keeps its content only when a bound value has something, or equals what it names.

```json
{ "type": "source", "props": {
    "collection": "enrolments", "mode": "list", "pageSize": 20, "pageParam": "p",
    "filterField": "Class", "filterValue": "{{query.class}}",
    "content": [[
      { "type": "repeat", "props": { "empty": "No one yet.", "content": [[
        { "type": "text", "props": { "value": "{{item.Title}}" } }
      ]] } },
      { "type": "pager", "props": {} }
    ]]
} }
```

A filter narrows what the API already lets the reader see. It is never access control: who may read
which rows is decided in barakoCMS. A page reads at most eight sources, and a `source` at most fifty
rows a page.

### Presets

A preset is a named block saved as data, not code: a few props and an arrangement of primitives that
reads them through the `props` scope. A designer saves one in barakoBrew and every site on the
published image can use it, with no barakoPress release.

```json
{
  "type": "band",
  "label": "Band",
  "fields": [
    { "name": "heading", "kind": "text", "required": true },
    { "name": "tone", "kind": "select", "options": ["page", "accent"] },
    { "name": "content", "kind": "slots" }
  ],
  "blocks": [
    { "type": "section", "props": { "tone": "{{props.tone}}", "content": [[
      { "type": "text", "props": { "value": "{{props.heading}}", "variant": "title" } },
      { "type": "slot", "props": { "name": "content" } }
    ]] } }
  ]
}
```

A request-time site reads its tenant's presets from the `Presets` site setting. A build-time site
passes them as `presets` in the config. A preset never replaces a block that is code. It does
replace a preset, which is how a tenant adjusts one of the shipped blocks below without waiting for
a release. A preset body may not use another preset saved in the same pass, so a cycle cannot form;
it may use one compiled earlier, which is how a tenant's own block builds on a shipped one. `slot` marks where the content an editor dropped into the preset
goes, and that content binds in the page's scope rather than the preset's.

A preset that is not used says why, once, in the server log, with one line per reason rather than one
catchall: an entry that is not a preset, a type that is not a name, a type an earlier preset already
uses, a field list that is not a list, fields inside it that are not fields, a name a registered
block already has, and the presets past the point where a tenant's bodies hold more than 400 blocks
between them. A setting that quietly does nothing reads as done, which is worse than one that is
missing. A bad paste is spelled out five times and then counted.

### The block library

Every site gets these, compiled in from the primitives. None of them is code, so a site that wants
one to look different saves its own under the same name and that one wins.

| Block | What it is | Props |
| --- | --- | --- |
| `hero` | The band at the head of a page | heading, body, image, imageAlt, primaryLabel, primaryHref, secondaryLabel, secondaryHref, tone, columns, align, padding |
| `band` | Copy with one call to action | tone, heading, body, label, href, align, padding, width |
| `statBand` | A row of figures | heading, tone, columns, padding, items |
| `cardGrid` | Cards from a collection | heading, collection, filterField, filterValue, empty, tone, columns, padding |
| `peopleGrid` | People from a collection, typed in place, or both | heading, collection, filterField, filterValue, role, tone, columns, padding, items |
| `timeline` | Dated entries | heading, tone, padding, width, items |
| `steps` | Numbered entries | heading, tone, padding, width, items |
| `tiers` | Giving or pricing tiers | heading, tone, columns, padding, items |
| `keyValueTable` | A panel of facts | heading, tone, padding, radius, rows |
| `tabs` | Sections that open | heading, tone, padding, width, items |
| `map` | An embedded map, held to `embedHosts` | src, title, heading, aspect, tone, padding |
| `stat` | One figure and its label | value, label, align |
| `timelineEntry` | One dated entry | date, title, body |
| `step` | One numbered step | number, title, body |
| `tier` | One tier | name, amount, body, label, href, tone |
| `person` | One person | name, role, photo, href, linkLabel, align |
| `keyValueRow` | One fact | label, value |

The blocks in the second half go in the first half's slots: stats in a `statBand`, entries in a
`timeline`, `disclosure` blocks in `tabs`. A card grid reads its entries through `{{item.Title}}`,
`{{item.Summary}}`, `{{item.Date | date}}` and `{{item.Href}}`, so it works against whatever the
tenant calls those fields, and it takes the collection as a prop rather than knowing any name.

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
| `pageSizes` | 20, 50, 1000, 50 | `PageSizes` | Index, feed, sitemap, archive |
| `cacheTag` | `cms` | operator only | The tag this site purges. Two sites on one server need two tags |
| `backstopSeconds` | 300 | operator only | How long a cached read may live with no webhook. 0 disables it |
| `cmsTimeoutMs` | 5000 | operator only | How long any one call to the CMS may take, a share link redemption included. Past it the call has failed, and a request-time site answers from its last good copy |
| `locale` | `en-GB` | `Locale` | Passed to `toLocaleDateString` |
| `currency` | none | `Currency` | The ISO code a `money` binding formats with. Unset, an amount renders as a plain number |
| `embedHosts` | seven player hosts | `EmbedHosts` | The hosts an `embed` block may frame |
| `presets` | none | `Presets` | Named blocks saved as arrangements of primitives. See Presets |
| `cmsUrl` | `CMS_URL`, or `http://localhost:5005` | operator only | Where the CMS is, from this server. The variable is read when the CMS is called, not when this file runs |
| `tenant` | `CMS_TENANT` | operator only | Tenant slug, for a multi-tenant deployment. On a request-time site, pins every host to it. The variable is read when the CMS is called, not when this file runs |
| `sites` | off | operator only | Request-time identity and theme from the tenant's site settings. See below |
| `pages` | off | operator only | Where the Pages module's pages are mounted. `""` is the site root. It has to match a route file on disk, which is why it is not a tenant's to set |
| `reservedSlugs` | the routes and the engine's files | `ReservedSlugs`, added to them | First path segments a root-mounted page may not take. Adds to the defaults |
| `regions` | off | `HeaderPath`, `HeaderTone`, `FooterPath`, `FooterTone` | The header and the footer as block regions |
| `collections` | the blog's `post`, `author` and `category` | `Collections` | Content types rendered as lists and detail pages. See Collections |
| `optionColors` | none | `OptionColors` | CSS colours by `type.field` and option, for `colorBy` |
| `theme` | the barakoCMS palette | `Colors`, `Fonts`, `Radii`, `Layout`, `Space`, `Text` | Colours, faces, radii and column widths. See below |

The third column is the whole of the split. A key marked operator only is one the image decides for
every tenant it serves, and each is that for a reason you can name: `types`, `fields`, `pageFields`
and `routes` are what the blog factories compile against, `cacheTag`, `backstopSeconds`,
`cmsTimeoutMs`, `cmsUrl`, `tenant` and `sites` are facts about the deployment rather than the site,
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
| `CMS_RENDERER_KEY` | Sent to the CMS when a share link is redeemed. See [Share links](#one-build-many-sites) |
| `PRESS_CONSOLE_ORIGINS` | Browser origins allowed to read the block schema, comma separated |
| `PRESS_SECRET` | The HMAC key for everything this renderer signs. See [One secret](#one-secret) |
| `REVALIDATE_SECRET` | The webhook key before `PRESS_SECRET`, read only while that is unset |
| `PRESS_PREVIEW_SECRET` | The share key before `PRESS_SECRET`, read only while that is unset |

Values are used exactly as the environment has them, untrimmed. A secret with a trailing space is a
different HMAC key, so trimming one here would stop a webhook that verifies today.

**A site is build time or request time.** Without `sites`, identity is build time: the index, the
feed, the sitemap and robots are prerendered, so anything *your own* `press.config.ts` reads from the
environment is baked when you build, not when the server starts. Write per-site values as literals in
that file. Getting this wrong is how a client site ships with the vendor's name in its masthead. With
`sites`, identity is data in the CMS and read per request, which is the next section.

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
4. `sites.defaultTenant`, or `CMS_DEFAULT_TENANT`, read at request time.
5. None of those: a 404. Never another tenant's site.

A handle is only ever read from the request through a header the operator named. `X-Tenant` and
`X-Forwarded-Host` sent by a caller are ignored unless you configure them, and you should configure
them only behind a proxy that sets the header and strips a caller's value.

The settings are the singleton `site` type from barakoCMS `docs/site-settings.md`
(`POST /api/content-types/blueprints/site`, then publish its one entry). The engine reads `Name`,
`Tagline`, `Url`, `Locale`, `Logo`, `LogoAlt`, `FooterLogo`, `Favicon`, `ShareImage`, `Copyright`,
`Colors` (the theme slots), `Fonts` (a family name per role, and the stylesheet that loads it),
`Radii`, `Layout`, `TopBar`, `HeaderLinks`, `FooterColumns`, `SocialLinks`, `HeaderPath`,
`HeaderTone`, `FooterPath`, `FooterTone`, `AssetsAsSupplied`, `LogoAsSupplied`, `LogoClearSpace`,
`PageSizes` and `ReservedSlugs`. `Collections` and `OptionColors` are read as the collections section
describes. `Variants` are not rendered yet. Every value is checked for shape; one that fails, and any the
entry leaves out, keeps the configured value, so a half-filled theme renders. A link is a path on the
site or an absolute http or https URL. Set `Url`: without it the feed and sitemap fall back to the
host the tenant was found by.

`createSiteLayout` and `createSiteMetadata` render the root layout from all of this: `lang`, the
faces, the palette, the top bar, header links, footer columns, social links and the copyright line.

**How many items, per tenant.** `PageSizes` sets the four counts for this site, each on its own:

```json
{ "PageSizes": { "index": 50 } }
```

A bakery listing 50 products and an agency listing 9 case studies run the same image. A key the
entry leaves out keeps the configured count, and a collection's own `pageSize` still wins over the
site's. barakoCMS clamps a public list at 100 whatever is asked for, so a larger number is not an
error and does not buy more rows.

**Paths this site does not serve.** `ReservedSlugs` adds to the configured reserved list:

```json
{ "ReservedSlugs": ["shop", "status"] }
```

A first segment on it is left out of the menu and the sitemap, and a page there is never asked for.
It is what a proxy in front of this domain answers instead of the renderer, which is a fact about
one tenant rather than about the image. It only ever adds: a tenant cannot free a segment the app's
own routes already hold, because a page there would sit behind a route file and render nowhere. A
tenant's collection routes need no entry, since those are read off its settings already.

**Fonts, from an allow list.** A family name on its own is loaded from Google Fonts, which is what it
has always meant:

```json
{ "Fonts": { "heading": "Zilla Slab" } }
```

A site that cannot use Google Fonts, a school with a licensed face on its own host or a tenant that
must not send visitor addresses to a third party, names the stylesheet instead:

```json
{ "Fonts": { "heading": { "family": "Zilla Slab", "url": "https://type.school.example/zilla.css" } } }
```

That URL is a tenant's setting on its way into a `<link>` in every visitor's page, so which origins a
page may reach is the deployment's decision and not the tenant's. `PRESS_FONT_ORIGINS` is the list:
origins separated by commas or spaces, each `https://host`, a bare host read as https.

| `PRESS_FONT_ORIGINS` | What a page may link |
| --- | --- |
| unset or blank | Google Fonts, and nothing else. This is what every site rendered before the list existed |
| `https://type.school.example` | That origin only. Nothing goes to Google Fonts, the built-in link and its preconnects included |
| `fonts.googleapis.com, type.school.example` | Both |

A URL on any other origin is refused: no link to it is rendered, the role falls back to its family
name, and the server log says so once rather than once a page view. The list replaces the default
rather than adding to it, which is what gives a tenant that must not reach Google Fonts a deployment
where nothing can. `createSiteLayout(config, { loadFonts: false })` still turns off every font link
for the whole image.

Only an absolute https URL is kept, for the whole chain: http is blocked as mixed content on every
site this serves, so allowing it would mean rendering a link that never loads. A role the tenant names
is the tenant's, family and stylesheet together, so a family set with no url clears a configured
stylesheet rather than leaving the page loading a face it no longer uses. A build-time site sets the
same thing in `theme.fontSources`, and it is held to the same list.

**Header and footer as block regions.** The built-in header and footer take links and text and
nothing else, so a clinic that wants a light footer with opening hours and a map cannot have one, and
a school that wants an enrolment banner with a button cannot either. Point a region at a page and its
blocks are drawn there instead, resolved and bound exactly as the page route resolves and binds them.

| Field | Type | What |
| --- | --- | --- |
| `HeaderPath` | string | A site path such as `/site/header`. The page served there is drawn in place of the top bar and the header band |
| `HeaderTone` | string | `page`, `surface`, `accent` or `inverse`: the tone behind the header region. `page` when unset or not one of the four |
| `FooterPath` | string | A site path such as `/site/footer`. The page served there is drawn in place of the footer |
| `FooterTone` | string | The same four names, behind the footer region |

Set neither and nothing changes: `TopBar`, `HeaderLinks`, `FooterColumns`, `SocialLinks` and
`Copyright` draw the built-in chrome with the markup they always had, which is what keeps a site
whose own CSS keys off that markup rendering. A path with nothing served at it does the same, so
naming a page before writing it is safe, and so is a typo.

A region page is chrome rather than somewhere to go, so it is left out of the menu and the sitemap.
It still answers on its own route, which is how an editor opens it to work on it.

A header region replaces the whole band, the site name, the menu and the RSS link along with the top
bar. There is no navigation or logo block yet, so a header region lists its own links until the block
library has one.

A build-time site sets the same thing in its config, and a tenant's settings win over it:

```ts
export const config = defineConfig({
    site: { name: "Mabini Clinic", url: "https://clinic.example" },
    pages: "",
    regions: { footer: { path: "/site/footer", tone: "surface" } },
});
```

The registry the regions render with is the one passed to `createSiteLayout(config, { blocks })`, and
the built-in blocks when none was passed.

**Caching per tenant.** Every read carries the tenant in `X-Tenant` and in its cache tag,
`<cacheTag>:<tenant>`. The webhook purges the tag of the tenant its host resolves to, so point each
tenant's webhook at `https://<that tenant's domain>/api/revalidate`, signed with that tenant's own key
(see [One key per tenant](#one-key-per-tenant)). A publish on one tenant leaves every other tenant's
cached reads in place.

**When the CMS is down.** Each successful read is also kept in process, keyed by CMS, tenant and path.
A read that fails with a network error, a 5xx, or no answer within `cmsTimeoutMs` answers from the
last good copy and logs a warning; the next successful read replaces it. For ten seconds after such a
failure that read answers from the copy without asking the CMS, so an outage costs one request per
read every ten seconds rather than one per visitor. The same holds after a purge: a publish that lands
within those ten seconds shows once the ten seconds are up. Known hosts keep resolving the same way. A page that was cached
for a tenant keeps answering 200 with that tenant's identity and theme. A tenant never gets another
tenant's kept answer.

**Holding mode.** A tenant can show a holding page on every route in place of its site, for a launch,
maintenance or a seasonal break, and share the real site with a few people through site share links.
Three fields on the `site` entry control it:

| Field | Type | What |
| --- | --- | --- |
| `Mode` | string | `Live` or `Holding`. Unset, or anything else, is `Live` |
| `HoldingPath` | string | A site path such as `/coming-soon`. The page the Pages module serves there is the holding page. Empty, or nothing served there, renders the default holding page: the name, the tagline and `HoldingMessage`, in the theme |
| `HoldingMessage` | string | The line the default holding page shows under the name and tagline, as text, for example `Closed until 6 January.` Unset or blank shows no line. Read only while holding. For more than a sentence, use `HoldingPath` |

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
| `PRESS_SECRET` | The HMAC key, at least 32 characters, for example `openssl rand -base64 48`. Read per request. Unset or shorter, no session is issued or accepted and everyone gets the holding page. Every instance behind one domain needs the same value. `PRESS_PREVIEW_SECRET` is read in its place when `PRESS_SECRET` is unset. See [One secret](#one-secret) |
| `CMS_RENDERER_KEY` | Optional. Sent to barakoCMS as `X-Barako-Renderer-Key` when a link is redeemed, and must match the renderer key barakoCMS is configured with. Read per request and never logged. Unset, no key header is sent |

**Redemption is rate limited per tenant and visitor.** Every redemption leaves this container from the
same address, so barakoCMS needs the visitor's address to tell visitors apart. Name the header a
proxy in front sets it in, `sites: { visitorIpHeader: "x-real-ip" }`, and it is sent on as
`X-Barako-Visitor-IP`. Name it only behind a proxy that sets that header and strips a caller's value,
the same rule as `hostHeader` and `tenantHeader`. A value that is not exactly one IPv4 or IPv6
address, a comma separated list included, is not sent. barakoCMS trusts the address only when
`CMS_RENDERER_KEY` matches, so both are needed for a per visitor limit. With no header named nothing
is sent: a Next route handler never sees the socket's address, and the `X-Forwarded-For` Next adds
keeps whatever a caller put there.

**A session lasts until the link expires or for 24 hours, whichever is sooner.** Opening the link
again starts a new one while the link is valid. **A revoked link can keep working for up to 24
hours** for someone who already opened it, because the session is checked here, not in barakoCMS. To
end every session now, change `PRESS_SECRET`, which does it for every tenant on that
deployment, and changes every tenant's webhook key with it.

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
arrive. `createSiteLayout` writes that link for you: a family name from Google Fonts, or the
stylesheet named in `theme.fontSources` when the face is not loaded from there, held to
`PRESS_FONT_ORIGINS` either way.

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

### Assets used exactly as supplied

Some marks come with an identity manual: never recoloured, never outlined, never put in a box, never
crowded. A renderer that rounds a corner or drops a logo into a tinted panel breaks that rule, and on
screen it looks like a nice touch. Mark the asset and it is drawn from the file, with a minimum clear
space held around it, everywhere the engine draws an image.

```ts
export const config = defineConfig({
  site:  { name: "The club", url: "https://club.example", logo: "/mark.svg" },
  theme: { asSupplied: [{ url: "/mark.svg", clearSpace: "lg" }] },
});
```

A tenant says the same thing in its site settings:

| Field | Type | What |
| --- | --- | --- |
| `AssetsAsSupplied` | list | URLs, or `{ "url": "...", "clearSpace": "lg" }` for one that needs more room. A list saved empty clears the configured one |
| `LogoAsSupplied` | boolean | Marks `Logo` and `FooterLogo`, so replacing the logo file does not mean editing a second setting that names the old one |
| `LogoClearSpace` | string | The clear space around those two |

The clear space is a name from the theme's spacing scale (`none`, `xs`, `sm`, `md`, `lg`, `xl`,
`xxl`), `md` when unset, and it is a minimum: a block asking for more gets more, a block asking for
less gets the site's. A URL is matched without its query, so a mark the CMS resized with `?w=480` is
still that mark.

What a marked asset gets is the file: no tint, no border, no corner, no shadow, no filter, no crop,
and the clear space around it at every width. A block that asked for a frame draws the mark alone
instead, which is what the `image` block's own `asSupplied` and `clearSpace` props are for when the
site has not listed the file. It holds in the header, the footer, the holding page, a header or
footer region, a page block, a preset, a post's cover image, a collection item's image and an image
inside markdown, and `src/assets.test.tsx` walks all of those and fails if a new way to draw an image
skips the rule.

One thing it cannot do: it does not know what is behind the mark. A tenant that puts a marked asset
on an `inverse` band gets the supplied file on that band, drawn plainly. Choosing the band is the
tenant's, and a white box behind the mark would itself be the boxing the rule forbids.

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

### One secret

`PRESS_SECRET` keys everything this renderer signs: each tenant's webhook key and each share session
cookie. Every signature puts its purpose first in what it signs (`revalidate.` or `press-share.`), so
one made for one purpose never verifies as another. It is read per request and has one rule for every
purpose: at least 32 characters, for example `openssl rand -base64 48`.

| When `PRESS_SECRET` is | Webhooks | Share sessions |
| --- | --- | --- |
| 32 characters or more | verified with it | signed with it |
| set but shorter | refused with 503 | none issued or accepted |
| unset | `REVALIDATE_SECRET`, as in 0.3.0 | `PRESS_PREVIEW_SECRET` |

The older names are read only when `PRESS_SECRET` is unset, so a site that set them keeps working, and
the keys derive byte for byte as before, so a key already pasted into a tenant's workflow keeps
verifying. A `REVALIDATE_SECRET` shorter than 32 characters still verifies and logs a warning once,
until 1.0.0. A `PRESS_PREVIEW_SECRET` shorter than 32 characters opens no session, as before.

Moving to the new name is copying the value: `PRESS_SECRET` set to what `REVALIDATE_SECRET` held
derives the same tenant keys, provided it is 32 characters or more. A shorter one has to be replaced,
and each tenant given its new key.

### Wiring the webhook

1. Put a random value of at least 32 characters in `PRESS_SECRET` where your app runs.
2. In barakoBrew, create a workflow on your post content type, event `Published`.
3. Add a Webhook action with `Url` set to `https://your-site/api/revalidate` and `Secret` set to the
   same value. On a site with `sites` configured, the `Secret` is the tenant's key instead, below.

### One key per tenant

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
cp .env.example .env      # point CMS_URL at your instance, set PRESS_SECRET
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
start without that file, and refuses again if `PRESS_SECRET` and `REVALIDATE_SECRET` are both empty, because a stack that
comes up with no secret can never be told that content changed. Only ports 80 and 443 are published:
the API, the console and the site are reachable only through Caddy on the compose network.

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
flake are in [docs/look-check.md](docs/look-check.md). `npm run look:selftest` runs the check twice
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
itself: the decision and what it costs are recorded in [CLAUDE.md](CLAUDE.md).

Releasing is in [RELEASING.md](RELEASING.md). No npm token is stored anywhere.

## Status

Early. The blog works end to end against a real instance. Known gaps, all tracked upstream: no media
picker, no rich editor, and no visitor theme variants.
