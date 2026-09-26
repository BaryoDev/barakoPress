# Pages

## Pages and navigation from the Pages module

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
  a warning. The list is `api`, `feed.xml`, `sitemap.xml`, `robots.txt`, `_next`, `_press`,
  `_share`, `%5fshare` and `favicon.ico`, plus each configured route that is one segment long;
  `reservedSlugs` adds to it. A deeper route reserves itself and what is below it, matched segment
  by segment, not its first segment. A one-segment route whose collections all have `index: false`
  is freed at exactly that path unless something else holds the slug: the engine's own names above,
  a `reservedSlugs` entry or a tenant's `ReservedSlugs`, or the blog's author and category routes.
  The resolved config lists those as `heldSlugs`. Give barakoCMS the same list as
  `Modules:Pages:ReservedSlugs` and an editor is refused the slug on save.
- **Contract.** Both bodies carry `contract`, and this renderer reads the range in `PAGES_CONTRACT`
  (1 to 1). A body outside it logs a warning and reads as absent: no menu, no page. A public site does
  not stop rendering because a menu shape moved.
- The sitemap lists the pages in the menu, and `createPageStaticParams` returns their path segments on
  a build-time site, because the module publishes no other public list of paths. A page outside the
  menu renders on request.

`Navigation`, `Breadcrumbs`, `getNavigation(config)`, `getPageByPath(config, path)`,
`getRedirect(config, path)` and `pageHref(config, path)` are exported for a site that draws its own
layout. Every read goes through the same tagged, cached, per tenant read as the rest of the site.

## Pages built from blocks

A page can hold an ordered list of blocks in a json field, each `{ "type": ..., "props": { ... } }`.
The blueprint's `page` type has no such field, so add one:

```bash
curl -X POST "$CMS_URL/api/content-types/page/fields" -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"fieldName":"Blocks","displayName":"Blocks","type":"json"}'
```

A page with a non-empty list renders its blocks. A page without one renders its `Body` as before.
Field names come from `pageFields` in the config, and the type from `types.page`.

`PageView` draws the page's `Title` above its blocks. A page whose blocks open with their own
heading sets a boolean `HideTitle` field to stop it drawing twice: `Title` still names the page for
a tab and for search either way.

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
a frame), `stickyBar` (a band that stays put while the page moves under it, at the top or the
bottom), `spacer`, `divider`, and `tabGroup` with `tabPanel` (tabs that need no script: each
`tabPanel` in a `tabGroup` is a `label` in the strip and the panel it opens, the panels that share
a `group` open one at a time, and `open` picks the one shown first).

A `stack` or a `panel` given an `href` is a link, the whole of it: a card whose face goes somewhere.
A site path is drawn with Next's `Link`, anything with a scheme as a plain anchor, and the address is
held to the same check as any link field. What is inside is the link's name, so nothing inside should
be a link of its own: one that holds a link, a button, a linked container, a control or a text with
a markdown link in it is drawn without its `href`, and the server log says so once, since a link
inside a link is markup a browser rewrites. A `section`, `stack` or `panel` given an `anchor` carries
it as its `id`, for a link to `#start` elsewhere; one that is not a plain name is left off.

`row` and `grid` take one list per cell, which suits a designer placing each one. `flow` takes a
single list and lays out whatever is in it, which is what a `repeat` and a preset's `slot` produce:
a card per row that came back, however many that is. Its column count is a choice and not a number,
because only a string field takes a binding, and a preset has to pass its own `columns` through.

**Content primitives** hold content and no layout: `text` (a variant from the theme's type scale,
and `format: "inline"` for code, emphasis, strong, links and an accent in the line; see
[Inline marks](look.md#inline-marks-in-a-text-block); `tag` draws it as `p`, `span`, `code`, `strong`,
`em` or `h1` to `h4` rather than the variant's element, `decorative` hides it from a screen reader,
for an arrow after a link's words, unless its inline marks hold a link, and `title` is shown on hover),
`richText` (markdown), `image`, `video`, `embed` (an iframe, only for a host in `embedHosts`),
`icon`, `button`, `link`, `list`, `disclosure` (a labelled section that opens; give several the
same `group` and only one is open at a time), `comparisonTable` (rows typed as lines with `|`
between the cells, drawn as a real table with a heading on every column and every row) and
`progressBar` (how far along one thing is, as `role="progressbar"` so it is read and not only seen,
from a `value` already worked out, or from a `count` with either a `total` or what is `remaining`).

A comparison's first line is the column headings and the first cell of every line after it is that
row's heading. What goes in a cell is whatever the tenant types, ticks and dashes included: a mark
chosen inside the engine would be one more piece of English in the markup.

**Motion primitives** are drawn finished and animate only away from that: `reveal` (a wrapper whose
content lifts and fades in as it scrolls into view), `rotatingText` (a list of words in
`words`, one shown at a time; the older comma separated `items` still reads), `typingTerminal` (lines typed in sequence, held, then started again) and
`codeSample` (a snippet with its language and one click to select the whole of it). `text` takes a
`motion` of `countUp`, which counts a plain number up to the figure already written in the markup,
and `flow` takes a `hueRotate` of `subtle` or `wide`, which turns each cell's hue through the
theme's own colours in a cycle of three.

All of it is CSS. There is no script, so a page with JavaScript off renders the terminal typed out,
the figure at its number and the first word of the rotation standing, and every animation sits inside
`prefers-reduced-motion: no-preference`, so a visitor who asked for less motion gets exactly the same
finished page. "When it comes into view" is `animation-timeline: view()`, and a browser without it
shows the finished state too. `src/blocks/motion.test.tsx` strips the guards out of every stylesheet
these emit and fails if anything left animates or hides anything.

Every primitive takes theme tokens and never a colour or a pixel value. Tones are `page`, `surface`,
`accent`, `inverse`, `gradient` (the inverse band with the theme's three dark roles spread across
it) and `wash`, plus any the site names in `Tones` (see [Tokens and tones](look.md#tokens-and-tones)); spacing is `none` to `xxl` from `theme.space`; type is a role from
`theme.text`; corners are `none`, `control`, `panel` or `pill`. A tenant that changes the scale
changes every page built from primitives, and nobody can put one client's blue into a block.

The one way past the tokens is a [style recipe](look.md#style-recipes): every primitive takes `recipe`, the
name of a look the site defines in its settings, and draws with it in place of its own.

A tone belongs to the band and everything in it: a `section` or a `panel` publishes its ink, its
accent and its hairline, and the blocks inside read those rather than the page's. That is what makes
an inverse band readable, and it is why a block dropped anywhere still looks like it belongs.

**Presets** are named arrangements of primitives, stored as data: the shipped library in [the block library](blocks.md#the-block-library), plus
whatever a tenant saves of its own.

**Data blocks** load and choose rather than draw: `source`, `repeat`, `showIf`, `pager`, `filterBar`
and `slot`.
See [Bindings](bindings.md).

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

**Which tenant's schema.** Given the config, `createBlockSchemaRoute(config, blocks)` answers a
request-time site with the schema of the tenant the request belongs to: its own presets, and its own
tones on every tone field. The tenant is found as a page finds it, from `CMS_TENANT`, the header the
operator named, the host through the CMS, or `CMS_DEFAULT_TENANT`, so barakoBrew reads a tenant's
schema at that tenant's domain. Nothing else a caller sends picks the tenant. A host with no tenant
gets 404 `{ "error": "no site" }`, and a lookup that fails gets 503. The settings behind it are the
cached read every page makes, under the tenant's cache tag, so a settings change shows after the
delivery that purges it. A build-time site with no plugins gets the same answer as
`createBlockSchemaRoute(blocks)`, which still works and still ignores the request. Given only the
registry, the route cannot tell which plugins the site enabled, so it offers no plugin's blocks and
lists every plugin as off; a site with plugins passes the config.

Field kinds are `text`, `markdown`, `url`, `number`, `boolean`, `select` (with `options`), `slots`
(lists of nested blocks, handed to the component already rendered), `list` and `group` (below). The list is editor input, so a
block renders only when its type is registered and every prop passes its field. A present but wrong
value fails the whole block, a `url` must pass the same check markdown links do, and a component
never receives a prop its fields did not declare. A page reads at most 400 blocks in total, nested
ones included, and ten levels deep. The count is spent on every block the binder walks through as
well as every one that comes out, so a band from the library costs eight or ten of it. A page that
goes over renders what fits, drops the rest, and says so once in the server log (`blocks: a page
storing N blocks held more than 400 ...`). What a `repeat` draws for its rows is counted
against a budget of its own; see `mode: "all"` in [Bindings](bindings.md).

**Lists and groups.** A block that needs several of one thing declares a `list`, and a thing made
of parts declares a `group`, rather than numbered fields or text split in the component:

```ts
fields: [
  { name: "stages", kind: "list", min: 2, max: 6, item: { kind: "group", label: "Stage", fields: [
      { name: "label", kind: "text", required: true },
      { name: "body", kind: "markdown" },
  ] } },
  { name: "tags", kind: "list", max: 8, item: { kind: "text" } },
  { name: "cta", kind: "group", fields: [{ name: "label", kind: "text" }, { name: "href", kind: "url" }] },
]
```

A list's `item` is `text`, `url`, `number` (with its own `min` and `max`) or `group`, and the list's
own `min` and `max` count its entries. A list with no `max` holds at most 100. A group's `fields`
are any field kind except `slots`, and lists and groups nest three deep. A stored list checks every
entry, and one wrong entry, a list too short or too long, or a group missing a required part fails
the block like any wrong value. An empty list reads as absent. A group hands its component only the
keys its fields declare.

The schema at `app/api/blocks` stays version 2 and publishes `item` and `fields` for these, with
`bindable` resolved at every level. They only add a kind and two keys, and a console that does not
know a kind edits that one field as JSON, so a block with no list or group publishes exactly what it
did before.

`defineBlock<Props, SlotNames>` checks the fields against the props at compile time: every field
names a prop, its kind suits the prop's type, and a prop that is not optional must be `required`.

A component gets `props`, `slots` and `theme`, not the config, because a client component's props
are serialised into the page and the config holds the CMS address. A server block that needs the
config closes over it.

A block that shows something depending on who is looking sets `perViewer: true`. `createPage` leaves
such blocks out, because its output is cached and shared. `createViewerPage` renders them and calls
`connection()` first, so that route is always dynamic. Signing a viewer in, and gating a block by
role, is issue #7.
