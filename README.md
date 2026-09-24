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
| `app/page.tsx` | `default`, `generateMetadata` | `createHome(config, blocks)`, `createHomeMetadata(config)` |
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
| `app/api/blocks/route.ts` | `GET`, `OPTIONS` | `createBlockSchemaRoute(config, blocks)`, `createBlockSchemaPreflight()` |
| `app/api/blocks/bindings/route.ts` | `GET`, `OPTIONS` | `createBindingReportRoute(config, blocks)`, `createBindingReportPreflight()` |
| `app/layout.tsx` | `default`, `generateMetadata` | `createSiteLayout(config, { blocks })`, `createSiteMetadata(config)` |
| `app/%5Fshare/route.ts` | `GET` | `createSharePage(config)` |
| `app/api/share/redeem/route.ts` | `POST` | `createShareRedeemRoute(config)` |

`createHome` serves whatever the tenant picked for `/`: the page at `HomePath`, the index of
`HomeCollection`, or the post index when it picked neither, which is what `createBlogIndex` did and
still does for a site that mounts that instead.

Mount only what you want. Nothing requires anything else. The paths only have to agree with the
`routes` in your config, which is what every generated link is built from.

`createBlogPostPreview` replaces `createBlogPost` when you want `?preview=TOKEN` to render a draft.
It reads `searchParams`, which forces the route dynamic, so a site using `output: "export"` takes
`createBlogPost` and gives up preview. `createPostStaticParams` and `createArchiveStaticParams` exist
for that static case.

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
stored, so a `{{item.X}}` outside a repeat is reported as an unbound scope. Give it the same `query`
option the page route has: off, which is the default, a `{{query.X}}` is an unbound scope for every
visitor and the report says so, and a report that resolved one anyway would tell an editor a field
works where it does not. It is never anonymous:
the caller presents the tenant's key as `Authorization: Bearer`, derived from `PRESS_SECRET` and
printed by `barakopress bindings-key <tenant>`. Answers are never cached.

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
| `fields` | `title` (required), `slug`, `summary`, `body` (markdown), `date`, `image`, `imageAlt`, `featured`, `tags`, `url`, `photo`, `progress`, `progressCount`, `progressTotal`, `href`. Each is a field name or a list tried in order; `@createdAt` and `@updatedAt` read the entry itself. `photo` is a portrait drawn above the title, `image` the wide one, and `progress` is a number from 0 to 100 that `progressList` draws. `progressCount` and `progressTotal` draw the same bar from two counts instead, for a source that gives those rather than a figure already worked out; `progress` wins when both are set. `href` is where a card links when that is not the item's own route: a collection filled by a sync usually carries the source's own URL and has no route on this site |
| `references` | Reference fields, each naming the collection it points into and the word a card puts before the link. Resolved in the same request |
| `sort` | Sent to the API, for example `-PublishedAt` |
| `feed` | Whether `createFeed(config, key)` serves it |
| `sitemap` | On unless `false`. A collection is paged to `pageSizes.sitemap` entries; the file stops at the standard's 50,000 URLs and says so in the log |
| `index` | Whether the root catch-all serves an index at the route. On unless `false`; the derived `author` and `category` have it off, so `/authors` stays a 404 unless a route file mounts it. An object is the index's copy, and the index is on. See below |
| `indexPage` | A site path such as `/site/blog`. The blocks of the page served there are drawn above the list on the index. See below |
| `defaultAuthor` | The byline name on an entry that names no author, on its card and on its `article` page |
| `pageSize`, `label`, `noun` | Items on the index, its heading, and how a count reads |
| `colorBy` | A choice field whose option colours the item. See below |
| `related` | What an item page lists under the item: `"semantic"` for the items of this collection closest to it by meaning, `false` for none. Unset, the first collection that references this one |
| `readingTime` | Whether an item page shows a read time worked out from its body. Off unless `true` |
| `layout` | How an item page is drawn: `"list"`, the shell markup every collection has had, or `"article"`, the reading column the blog's posts are drawn in. See below |
| `tree` | Set when the collection is a manual rather than a flat list: sections, an order, nesting, products. See below |

A settings entry that does not read as a collection is left out whole: a type or field that is not a
plain identifier, a route that is not a plain site path, or no title field. `post`, `author` and
`category` are replaceable by key like any other collection, since every read goes through the
collection's own field map. A build-time collection mounted at `/` throws in `defineConfig`. When two
routes match, the longer one wins.

A request-time site cannot add a route file per tenant, so the root catch-all from the pages section
also serves every collection with a route: its index at the route, and an item one segment below. A
route file wins where there is one. A collection's first segment is reserved from pages at the root.

A detail page lists the items of the first collection that references it, so `/departments/cardiology`
lists its doctors, the way an author's archive lists their posts. `listRelated(config, "doctors",
department, { via: "Department" })` returns the same list; `listRelated(config, post)` still returns
related posts by semantic search.

With `related: "semantic"` it lists the items of its own collection nearest it by meaning instead, so
an agency's case study gets the band a post has. That needs the CMS AI module: without it the search
answers nothing and the page draws no band at all, which is the same way the post page degrades.
`listRelatedItems(config, key, item)` returns that list on its own.

**The index's own words.** An editor sets what a collection's index says in the collection's
settings, rather than a theme writing a route file for it:

```json
{
  "blog": {
    "type": "post", "route": "/blog", "fields": { "title": "Title" },
    "index": {
      "eyebrow": "Changelog", "heading": "What shipped",
      "lede": "Every release, newest first.",
      "empty": "Nothing shipped yet.", "unavailable": "The changelog is resting. Try again shortly."
    },
    "indexPage": "/site/blog",
    "defaultAuthor": "The barakoCMS team"
  }
}
```

`eyebrow` is a short line above the heading, `heading` replaces `label`, `lede` replaces the site's
tagline under it, `empty` is what an index with nothing published says, and `unavailable` what one
whose read failed says, each in place of the `labels` lines that say it otherwise. Every line is
optional, one of the wrong kind or too long is dropped on its own, and a route file's own `heading`
still wins. `indexPage` draws a page's blocks above the list, so the index is composed like any page
and the route stays the collection's. With `defaultAuthor`, an entry whose first reference (the
byline) did not come back, or a collection with no reference at all, is signed with that name after
`labels.by`. Set none of the three and the index and the byline draw what they always did.

A page named by `indexPage` only holds data, the way a header or footer region page does: it answers
404 at its own path and is left out of the menu and the sitemap.

**Filtering.** `listCollection(config, "doctors", { filter: { Department: "cardiology" } })` takes a
reference field by the target's slug and any other field by the value it holds, a choice field by its
option. The API takes five filters. `createCollectionIndex(config, key, { filter })` takes the same,
and the `collection` block has `filterField` and `filterValue`.

**A style per option.** With `colorBy: "AreaOfFocus"` on a `project` collection, the site settings
`OptionStyles` entry says how each option of that field is shown:

```json
{
  "OptionStyles": {
    "project.AreaOfFocus": {
      "Providing clean water": { "tone": "sky", "icon": "location", "label": "Water" }
    }
  }
}
```

`tone` names a colour from `Colors`, a theme slot, or a colour written out, and each card, item page
and collection block item carries it as a left border. `icon` is one of the engine's icon names, and
`label` is the word a visitor reads in place of the option's own value; the value stays on the element
as `data-option`, where a site's own CSS can still find it. A tone that does not resolve to something
readable as a colour is dropped, a label past 40 characters is dropped, and an icon name nothing
draws draws nothing, each on its own rather than losing the whole entry.

`OptionColors` is the same thing said shorter, `{ "project.AreaOfFocus": { "Providing clean water":
"sky" } }`, an option whose style is a tone and nothing else. A tenant that saved colours keeps them,
and a style for the same option wins field by field. A build-time site passes `optionStyles`, or
`optionColors`, in the same shapes.

`Card` and `ItemView` are exported for a site that wants its own page, and `Card` still takes a `post`.
`getItem`, `listCollection` and `getGlobals(config)`, the tenant's settings entry as stored, are
exported too.

**A long-form layout.** `layout: "article"` draws an item as a reading column: a back link, the title
and standfirst, a byline from the collection's first reference, the date, a read time worked out from
the body, the other references, the tags, the cover image, the prose and a band of neighbours under
it. That is the page the blog's posts have always had, and it is a collection setting rather than a
blog screen, so a law firm's briefings or a newsroom's features get it by asking. Styled inline from
the theme, so it looks right whether or not the consumer imports `barakopress/styles.css`.
`PostView` is a wrapper over the same layout and is `@deprecated` for 1.0.0.

**Docs: a collection as a tree.** A manual is a collection plus four fields saying where each page
sits. `tree` names them, and the settings beside them say what the sidebar and the switcher show:

```json
{
  "docs": {
    "type": "doc", "route": "/docs", "label": "Documentation", "layout": "article",
    "fields": { "title": "Title", "slug": "Slug", "body": "Body" },
    "tree": {
      "section": "Section", "order": "Order", "parent": "Parent", "product": "Product",
      "sections": ["Getting started", "Guides", "Reference"],
      "searchPath": "/docs",
      "editPath": "Source",
      "editBase": "https://github.com/owner/repo/edit/master/",
      "products": [
        { "key": "cms", "label": "barakoCMS", "href": "/docs" },
        { "key": "press", "label": "barakoPress", "href": "/docs/press" }
      ]
    }
  }
}
```

| Key | What |
| --- | --- |
| `section` | The field holding the heading a page is grouped under |
| `order` | The field holding its position in that section. A page with none comes after those with one |
| `parent` | The field holding the slug of the page it hangs under, or a reference to it. A parent nobody has leaves the page at the top of its section rather than dropping it |
| `product` | The field naming the product it documents, matched against a product's `key`. One field name and not a list, since this one goes into an API filter |
| `sections` | The sections in the order the sidebar shows them. One not named here follows those that are. Named rather than worked out, because no ordering of the pages says which section comes first |
| `products` | What the switcher offers: a key, the word a reader sees, and where it goes. A destination that is not a site path or an http URL is dropped |
| `searchPath` | Where the search box submits, and whether one is drawn at all. Unset, no box, because only the site knows which of its routes reads the query |
| `editPath` | The field holding the page's path in whatever repository it is written in. Its slug when unset |
| `editBase` | Where "edit this page" points, with that path appended. Unset, no such link is drawn |
| `limit` | The most pages read to build the tree. 500 unless set, and 500 is the ceiling as well as the default |
| `variant` | How the parts are laid out. See "Styling the tree" below. Every part is today's layout when unset |
| `searchIndex` | `true` to search the tree's titles and headings in the page as the reader types. The box is drawn whenever this is set; with `searchPath` too, a reader with no script submits there |
| `icons` | `{ "search": "#id", "chevron": "#id" }`: symbols already on the page (a site's own sprite) for the compact search box's magnifier and the closed disclosure's chevron. A value that is not `#` and a name is dropped, and the engine draws its own |

A product may also carry a `note`, a few words drawn after its label in the list switcher (`"on GitHub"`).

An item page in such a collection draws the sidebar with the page being read marked, the switcher,
a search box, previous and next from the tree's reading order, and the edit link. The sidebar is a
`details` element, so it collapses on a phone with no script. `collectionTree(config, key, { product })`
and `treeNeighbours(order, slug)` return the same tree and the same neighbours for a site's own page.

**Search.** `searchCollection(config, key, query)` goes through barakoCMS's `/api/public/{type}/search`,
which matches only over the fields a type publishes, so a draft or a field held back from public
delivery can never come back. `createCollectionIndex(config, key, { search: true })` answers `?q=` with
what matched instead of the index; that reads the query, so the route is dynamic and `output: "export"`
refuses it, which is why it is off unless asked for. The box is a `form`, the results are links, and
the keyboard handling on top ("/" to focus, the arrow keys to walk the results, escape to clear) is the
one client component in the package. The root catch-all answers `?q=` on a collection index too, but
only where the route may be dynamic: a request-time site rewrites to a kept route, and a kept route
asking for the query fails rather than bailing out, so there the index lists and a page of blocks
holding the `search` block is where a reader searches.

Which is why `searchPath` exists rather than the box pointing at the collection's own route. Only the
site knows which of its routes reads the query, and a box submitting somewhere that ignores `q` sends
a reader to an unfiltered index that looks like a search which matched everything. Name the route that
answers, or name nothing and get no box.

**As blocks.** `docsSidebar`, `docsSwitcher` and `search` draw the same three on a page of blocks, each
taking a collection key. `search` takes a bindable `query`, so a landing page binds `{{query.q}}` and
the route file passes the query with `createPage(config, blocks, { query: true })`. `docsSwitcher`
takes a `variant`, `tabs` or `list`, and follows the collection's own when it is left unset.

**Styling the tree.** A site restyles the tree screens without drawing them itself, three ways.

*Tokens.* Every colour, gap, padding, margin, radius, font size, weight and line height in them is read as
`var(--t-tree-<name>, <today's value>)`. Letter spacing, and the flex bases that decide when a row wraps, are fixed.
A token named in the tenant's `Tokens` setting (or `theme.tokens`) lands on the root as `--t-<name>`,
so `"Tokens": { "tree-link-current-bg": "#FDEBD3" }` restyles the current page's row and nothing else.
A token in the settings is held to a colour, a length or a font stack; a weight or a unitless line
height is set from the site's stylesheet under the same name (`:root { --t-tree-link-weight: 500 }`).
A site that names none draws what it drew before, pixel for pixel.

| Token | Default | What |
| --- | --- | --- |
| `tree-gap` | `space.lg` | Between the sidebar and the page, `plain` |
| `tree-shell-width`, `tree-shell-pad-y`, `tree-shell-pad-x` | `layout.wide`, `space.lg`, `layout.gutter` | The shell's width and padding, `plain` |
| `tree-edge` | `hairline` | The rules between the columns and above them, `boxed` |
| `tree-min-height` | `0px` | The shell's least height, `boxed` |
| `tree-sidebar-width` | `280px` | The sidebar column (its most, `plain`; its width, `boxed`) |
| `tree-sidebar-bg`, `tree-sidebar-pad-y`, `tree-sidebar-pad-x` | `surface`, `space.lg`, `space.md` | The sidebar column, `boxed` |
| `tree-body-pad-y`, `tree-body-pad-x` | `space.xl`, `space.xl` | The page column, `boxed` |
| `tree-aside-gap` | `space.md` | Between the switcher, the search box and the sidebar |
| `tree-section-gap` | `space.md` | Between sections, and between the list switcher and the sections |
| `tree-label-gap`, `tree-label-size`, `tree-label-ink` | `space.xs`, `text.meta`, `muted` | Section labels, the list switcher's label and the rail's heading. The size is also the search box's label and the phone control's |
| `tree-summary-bg`, `tree-summary-edge`, `tree-summary-ink`, `tree-summary-radius`, `tree-summary-space`, `tree-summary-pad-y`, `tree-summary-pad-x` | `surface`, `hairline`, `muted`, `radii.control`, `space.sm`, `10px`, `12px` | The sidebar's control on a phone, and the space under it while open |
| `tree-summary-pad-y`, `tree-summary-pad-x`, `tree-summary-min-height`, `tree-summary-gap`, `tree-summary-line-gap` | `10px`, `12px`, `0px`, `space.sm`, `3px` | The closed disclosure's control |
| `tree-summary-title-size`, `tree-summary-title-weight`, `tree-summary-title-ink` | `text.small`, `700`, `ink` | The page it names |
| `tree-summary-action-size`, `tree-summary-action-weight`, `tree-summary-action-ink`, `tree-summary-action-gap`, `tree-summary-icon-size` | `text.small`, `600`, `accentInk`, `6px`, `13px` | Its "Contents" and "Close", and the chevron |
| `tree-link-gap`, `tree-indent` | `0px`, `space.md` | Between rows, and a child's indent |
| `tree-link-pad-y`, `tree-link-pad-x`, `tree-link-radius`, `tree-link-size`, `tree-link-leading` | `6px`, `10px`, `radii.control`, `text.small`, `1.45` | A row in the sidebar, and a product in the list switcher |
| `tree-link-ink`, `tree-link-weight` | `secondaryInk`, `inherit` | A row that is not the page being read |
| `tree-link-current-bg`, `tree-link-current-ink`, `tree-link-current-weight` | `accentTint`, `accentInk`, `600` | The page (or product) being read |
| `tree-note-gap`, `tree-note-size`, `tree-note-weight`, `tree-note-ink` | `6px`, `text.meta`, `inherit`, `muted` | A product's note |
| `tree-tab-gap`, `tree-tab-pad-y`, `tree-tab-pad-x`, `tree-tab-radius`, `tree-tab-size`, `tree-tab-weight` | `space.xs`, `6px`, `12px`, `radii.pill`, `text.small`, `600` | The tabs switcher |
| `tree-tab-bg`, `tree-tab-edge`, `tree-tab-ink`, `tree-tab-current-bg`, `tree-tab-current-ink` | `surface`, `hairline`, `secondaryInk`, `accent`, `inverseInk` | The tabs, and the current one |
| `tree-search-bg`, `tree-search-edge`, `tree-search-ink`, `tree-search-radius`, `tree-search-size`, `tree-search-pad-y`, `tree-search-pad-x` | `surface`, `hairline`, `ink`, `radii.control`, `text.small`, `9px`, `12px` | The search box |
| `tree-search-label-gap`, `tree-search-label-ink` | `space.xs`, `muted` | Its label |
| `tree-search-results-gap`, `tree-search-hit-gap`, `tree-search-hit-radius`, `tree-search-hit-ink`, `tree-search-hit-weight`, `tree-search-empty-ink`, `tree-search-hit-pad-y`, `tree-search-hit-pad-x` | `space.sm`, `2px`, `radii.control`, `ink`, `600`, `muted`, `7px`, `10px` | Its results |
| `tree-search-height`, `tree-search-gap`, `tree-search-icon-size` | `36px`, `9px`, `13px` | The compact well. It also reads `tree-search-bg` (`pageBg` here), `tree-search-radius`, `tree-search-pad-x`, `tree-search-size` (`text.meta` here), `tree-search-ink` and, for the well's own ink, `tree-search-label-ink` |
| `tree-search-key-pad-y`, `tree-search-key-pad-x`, `tree-search-key-radius`, `tree-search-key-bg`, `tree-search-key-edge`, `tree-search-key-size`, `tree-search-key-weight` | `2px`, `6px`, `6px`, `surface`, `hairline`, `text.meta`, `700` | The "/" key hint |
| `tree-search-panel-gap`, `tree-search-panel-pad`, `tree-search-panel-bg`, `tree-search-panel-edge`, `tree-search-panel-radius`, `tree-search-panel-shadow` | `6px`, `6px`, `surface`, `hairline`, `radii.panel`, `0 10px 24px -12px rgba(16,18,35,.25)` | The compact box's floating results |
| `tree-search-hit-size`, `tree-search-empty-pad-y`, `tree-search-empty-pad-x` | `text.small`, `8px`, `10px` | A compact result, and the line saying nothing matched |
| `tree-rail-width`, `tree-rail-pad-y`, `tree-rail-pad-x`, `tree-rail-label-gap`, `tree-rail-gap` | `layout.columnMin`, `space.xl`, `space.md`, `space.sm`, `2px` | The rail (its padding only when `boxed`) |
| `tree-rail-link-pad-y`, `tree-rail-link-pad-x`, `tree-rail-link-size`, `tree-rail-link-weight`, `tree-rail-link-ink`, `tree-rail-link-edge` | `6px`, `10px`, `text.small`, `inherit`, `secondaryInk`, `hairline` | A heading in the rail |
| `tree-pager-top`, `tree-pager-gap`, `tree-pager-pad-y`, `tree-pager-pad-x`, `tree-pager-radius`, `tree-pager-bg`, `tree-pager-edge` | `space.lg`, `space.sm`, `16px`, `18px`, `radii.panel`, `surface`, `hairline` | Previous and next |
| `tree-pager-label-size`, `tree-pager-label-ink`, `tree-pager-title-gap`, `tree-pager-title-size`, `tree-pager-title-weight`, `tree-pager-title-ink` | `text.meta`, `muted`, `space.xs`, `text.small`, `600`, `ink` | Their words |
| `tree-edit-top`, `tree-edit-ink`, `tree-edit-size` | `space.md`, `muted`, `text.meta` | "Edit this page" |

*Variants.* What a token cannot say, because it changes which elements are drawn or where they sit, is
the tree's `variant`, and a `variant` prop on the component:

```json
"tree": { "variant": { "switcher": "list", "sidebar": "boxed", "rail": true, "pager": "halves" } }
```

| Part | Values | What |
| --- | --- | --- |
| `switcher` | `tabs` (default), `list` | A row of pills above the search box, or a labelled column of rows inside the sidebar above the sections, under the search box, folding away with the pages on a phone |
| `sidebar` | `plain` (default), `boxed` | The sidebar beside the page in the wide column, or the page split edge to edge with the sidebar a surface column and a hairline between. `boxed` stacks on a phone |
| `rail` | `false` (default), `true` | An "on this page" column of the item's second level headings at the inline end, linking to the ids its body renders. Hidden below 64rem |
| `pager` | `wide` (default), `halves` | Previous and next taking the room there is and wrapping on a phone, or two halves that never wrap, next on the right even with no previous |
| `search` | `box` (default), `compact` | A labelled input with its results under it, or one well holding a magnifier, the input and a "/" key hint, the input named by `aria-label` with no label on screen, and the results in a panel floating over what follows. "/" focuses either |
| `disclosure` | `open` (default), `closed` | On a phone, the sidebar open under a "Contents" control, or closed until tapped, the control naming the product, the section and the page being read, with "Contents" and a chevron that turn to `closeContents` and point up while open. Above the phone breakpoint both show the whole sidebar and no control. `closed` needs no script: the content is shown above the breakpoint through `::details-content`, and a browser without it keeps the control there too, so the sidebar is one tap away rather than gone |

A value the engine does not know is today's layout for that part.

*Classes.* Each part carries a class a stylesheet can reach, for what neither a token nor a variant
covers (a hover, a transition): `bp-tree-shell` (and `bp-tree-shell-boxed`), `bp-tree-aside`,
`bp-tree-body`, `bp-tree-rail`, `bp-tree-sidebar`, `bp-tree-summary`, `bp-tree-sidebar-body`,
`bp-tree-sections`, `bp-tree-section`, `bp-tree-section-label`, `bp-tree-list`, `bp-tree-item`,
`bp-tree-link`, `bp-tree-link-current`, `bp-tree-switcher` (with `bp-tree-switcher-tabs` or
`bp-tree-switcher-list`), `bp-tree-switcher-label`, `bp-tree-tab`, `bp-tree-tab-current`,
`bp-tree-product`, `bp-tree-product-note`, `bp-tree-search`, `bp-tree-search-label`,
`bp-tree-search-input`, `bp-tree-search-results`, `bp-tree-search-index`, `bp-tree-search-hit` (a
result a route answered with), `bp-tree-search-empty`, `bp-tree-rail-nav`,
`bp-tree-rail-label`, `bp-tree-rail-link`, `bp-tree-pager`, `bp-tree-pager-link`,
`bp-tree-pager-prev`, `bp-tree-pager-next`, `bp-tree-pager-label`, `bp-tree-pager-title`,
`bp-tree-pager-empty`, `bp-tree-edit`, and for the variants `bp-tree-search-compact`,
`bp-tree-search-box`, `bp-tree-search-icon`, `bp-tree-search-key`, `bp-tree-nav-closed`, `bp-tree-summary-closed`, `bp-tree-summary-group`,
`bp-tree-summary-title`, `bp-tree-summary-action`, `bp-tree-summary-show`, `bp-tree-summary-hide` and
`bp-tree-summary-chevron`. Every label paragraph (a section's, the list switcher's, the pager's, the
rail's) also carries `bp-label`, so a rule aimed at running text can skip them all with
`:not(.bp-label)`. An index entry carries no class of its own, to stay small: it is
`.bp-tree-search-index li > a`, holding a `span` with the words that matched and, for a heading, a
second `span` naming its page. The styles are inline, so a stylesheet rule that sets a property the
part already sets needs `!important`; a token does not. The index's entries are the exception: they
are styled from one stylesheet scoped to their box, so an ordinary rule of the same or higher
specificity reaches them.

**The search index.** `treeSearchIndex(tree)` lists every page with a route and then its second level
headings, in reading order, each heading linked to its anchor. It is built once per tree read and
shared by everything drawn from that read, and a body's headings (`itemHeadings(item)`, from
`markdownHeadings` in `barakopress/markdown`) are tokenised once per distinct body and kept, so a static
build of a manual of n pages lexes each body once rather than n times. With `searchIndex`, the box
draws the index into the page hidden and its client code shows the entries holding every word typed,
eight at a time.

What that costs: an entry is a list item, a plain link and its words, styled from one stylesheet, so
it is its href and its text plus about 50 bytes. The index is part of the server render, so Next
carries it in the page's payload as well as its HTML, like any other server markup; it is never also
handed to the client component as props. At most 2000 entries (`TREE_INDEX_LIMIT`) go into a page.
Past that it is headings that are left out, never a page: every page's title is counted first and
headings fill the rest in reading order, and the server log says once which manual lost how many.
A body gives at most 100 headings (`HEADINGS_PER_BODY`), and what is kept between reads is those
headings under a digest of the body, never the body.

The results are put away, with what was typed kept, when focus leaves the box, when something outside
it is pressed, when one of them is followed, and on Escape; they come back when the box has focus again. Enter goes to the first
match. With no `searchPath` there is no form at all, so Enter can never reload the page with the
query: with script the box answers in the page, and a reader with no script gets a field that does
nothing, not one that reloads the page and empties itself.

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
bottom), `spacer` and `divider`.

A `stack` or a `panel` given an `href` is a link, the whole of it: a card whose face goes somewhere.
A site path is drawn with Next's `Link`, anything with a scheme as a plain anchor, and the address is
held to the same check as any link field. What is inside is the link's name, so nothing inside should
be a link of its own. A `section`, `stack` or `panel` given an `anchor` carries it as its `id`, for a
link to `#start` elsewhere; one that is not a plain name is left off.

`row` and `grid` take one list per cell, which suits a designer placing each one. `flow` takes a
single list and lays out whatever is in it, which is what a `repeat` and a preset's `slot` produce:
a card per row that came back, however many that is. Its column count is a choice and not a number,
because only a string field takes a binding, and a preset has to pass its own `columns` through.

**Content primitives** hold content and no layout: `text` (a variant from the theme's type scale,
and `format: "inline"` for code, emphasis, strong, links and an accent in the line; see
[Inline marks](#inline-marks-in-a-text-block); `tag` draws it as `p`, `span`, `code`, `strong`,
`em` or `h1` to `h4` rather than the variant's element, `decorative` hides it from a screen reader,
for an arrow after a link's words, and `title` is shown on hover),
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
it) and `wash`, plus any the site names in `Tones` (see [Tokens and tones](#tokens-and-tones)); spacing is `none` to `xxl` from `theme.space`; type is a role from
`theme.text`; corners are `none`, `control`, `panel` or `pill`. A tenant that changes the scale
changes every page built from primitives, and nobody can put one client's blue into a block.

The one way past the tokens is a [style recipe](#style-recipes): every primitive takes `recipe`, the
name of a look the site defines in its settings, and draws with it in place of its own.

A tone belongs to the band and everything in it: a `section` or a `panel` publishes its ink, its
accent and its hairline, and the blocks inside read those rather than the page's. That is what makes
an inverse band readable, and it is why a block dropped anywhere still looks like it belongs.

**Presets** are named arrangements of primitives, stored as data: the shipped library below, plus
whatever a tenant saves of its own.

**Data blocks** load and choose rather than draw: `source`, `repeat`, `showIf`, `pager`, `filterBar`
and `slot`.
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
well as every one that comes out, so a band from the library costs eight or ten of it, and a page
that goes over loses its tail with nothing said.

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

### Bindings

Any string prop can hold a placeholder, which is barakoCMS's workflow template syntax with an
optional format and fallback:

```json
{ "type": "text", "props": { "value": "Welcome to {{site.Name}}", "variant": "display" } }
{ "type": "text", "props": { "value": "{{item.Fee | money ?? Free}}" } }
{ "type": "text", "props": { "value": "{{page.PublishedAt | date}}" } }
```

Scopes are `site` (the tenant's settings and resolved identity), `page` (the entry the page
renders), `item` (the row inside a `source` or a `repeat`) and `query` (URL parameters). An item
reads its entry's own fields by name, with the collection's roles (`Title`, `Summary`, `Body`,
`Date` and the rest) laid over them only where the collection's `fields` maps that role, so an
unmapped `Body` is still the entry's own `Body`. `count`, `sum` and `group` are about a set of rows
rather than one, and are described with `source` below. `viewer` arrives with #7. Formats are `text`, `date`, `datetime`, `time`, `money`, `number`, `upper` and
`lower`; `money` uses the tenant's `Currency` setting, or a plain amount when it has none.

Paths, formats and fallbacks only. There are no expressions and no JavaScript. Everything resolves
on the server as the request's tenant, before a component is called, so a binding never makes the
browser call the API. A placeholder that finds no value renders its fallback and is reported in the
server log, never a crash. What a binding resolves to is checked against the field again, so a link
whose stored field holds `javascript:` drops the block; and a resolved value is never rescanned, so
one field cannot reach another through its own contents.

A `list` or a `group` takes its whole value from one placeholder with nothing around it, no format
and no fallback: `"tags": "{{item.Tags}}"` fills the list with the array itself, and
`"cta": "{{item.Link}}"` a group with the object. What it resolves to is data. Each entry is checked
against the field, an entry that fails is left out rather than failing the block, the list is cut at
its `max` since the data is not the editor's to shorten, and one that comes up short of `min` drops
the block. Nothing in it is scanned for placeholders. A list or a group typed out in full binds
each string inside it like any string prop.

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

**Counts, sums and groups.** `{{count.<collection>}}` anywhere on a page is how many published
entries the collection has, for example `{{count.posts}}`. It is the delivery API's `totalItems` for
a page of one row, cached like every other read, and the public API lists published entries only, so
it is the number of rows the page could list. Inside a `source`, `{{count}}` on its own is how many
rows that source's filter matched, all of them and not just the page it read:

```json
{ "type": "source", "props": {
    "collection": "packages", "mode": "list", "pageSize": 1,
    "filterField": "Category", "filterValue": "Auth",
    "content": [[ { "type": "text", "props": { "value": "{{count}} auth modules" } } ]]
} }
```

A filtered count is a `source` rather than something like `{{count.packages where Category=Auth}}`
because a placeholder is paths, formats and fallbacks, and a filter value is free text: a value with a
space or a hyphen cannot be a path segment, and a placeholder that could carry a condition would be
the start of an expression language. `filterField` and `filterValue` already bind, so the value can
come from `{{query.c}}` or an item, and the count costs the one read the source makes anyway. Set
`pageSize` to 1 when the count is all the source is for.

Each collection counted is one of the page's eight reads, spent the first time a placeholder names
it and shared by every other placeholder that names it. Sources and counts draw on the same eight, in
the order the page is written. A count past the budget, one for a collection the tenant does not
have, and one whose read failed all render the fallback and are reported as `no value`.

`{{sum.<Field>}}` inside a `source` adds that field over the rows the source read, for example the
open issues across a roadmap's milestones. A number stored as text counts. A field with a word in
any row is not a sum and renders its fallback, and a source with no rows has no sums, so write
`{{sum.Open ?? 0}}` where zero is the right answer. A sum covers the rows read, at most fifty; a
source that pages sums the page it is on.

`groupBy` names a field, and the source's content then renders once per distinct value of it among
the rows read, in the order first seen. `groupOrder` is a comma separated list of values to put
first, in that order; the rest follow in the order first seen. Inside each group `{{group.key}}` is
the value and `{{group.count}}` how many rows have it, and `repeat` and `{{sum.X}}` work over that
group's rows. `{{count}}` stays what the whole source matched. A row with nothing in the field is
kept, in a group whose key is empty, so `{{group.key ?? Other}}` names it. A pager inside a grouped
source renders nothing, since a page of rows is not a page of groups. One grouped source is one read,
where a source per value was one read each:

```json
{ "type": "source", "props": {
    "collection": "milestones", "mode": "list", "pageSize": 50,
    "groupBy": "Repository", "groupOrder": "barakoCMS, barakoPress",
    "content": [[
      { "type": "text", "props": { "value": "{{group.key}}: {{sum.Open}} open in {{group.count}} milestones" } },
      { "type": "repeat", "props": { "content": [[ { "type": "text", "props": { "value": "{{item.Title}}" } } ]] } }
    ]]
} }
```

All of it resolves on the server as the request's tenant, so a count or a sum never makes the
browser call the API. A page that uses none of it reads and renders exactly what it did before.

**Filter buttons.** A `filterBar` inside a `source` draws one button per distinct value of `field`
among the rows the source read, after an "all" button (`allLabel`, which binds, so `All {{count}}`
works). The values come in the order first seen; `order` is a comma separated list to put first, and
a value it names that no row holds gets no button. `separator` splits a text field that holds several
values, such as `4.4.0, 4.3.0`, and a list field gives one value per entry. A bar offers at most a
hundred values (`MAX_FILTER_VALUES`), the first hundred in that order, and a row carries only values
the bar offers. Fewer than two values is no choice, so the bar draws nothing.

```json
{ "type": "source", "props": {
    "collection": "packages", "mode": "list", "pageSize": 50,
    "content": [[
      { "type": "filterBar", "props": { "field": "Category", "allLabel": "All {{count}}", "label": "Filter by category" } },
      { "type": "repeat", "props": { "content": [[ { "type": "text", "props": { "value": "{{item.Title}}" } } ]] } }
    ]]
} }
```

The rows stay server-rendered and the buttons read nothing. The binder marks each row's own blocks
with `data-bp-filter`, the bar's id, and `data-bp-filter-values`, its values, each written as
`<id>:<value>` with the value percent-encoded so a value with a space is one token. A row of a source
nested in another source's row belongs to both bars, so each attribute can hold two, and each bar's
rule reads only its own. The id is `f<n>-<scope>`, where the scope is the part of the page the bind
draws (`body`, `header`, `footer`, or `index` for a collection's index page, and `scope` in
`bindBlocks` options for a site that binds its own), so a bar in the header and an identical one in the
body never share an id, and the same page renders the same bytes every time. A click sets `aria-pressed` on the button and
`data-bp-filter-value` on the bar, and writes one rule that hides every row of that bar without the
value, with the value escaped as a CSS string and `!important` so it wins over a row's inline
`display`. A site writes no rule of its own, so a value nobody planned for still filters, and a
reader with no script sees every row. The buttons are toggles with `aria-pressed` inside a labelled
group, not a tablist, since the tab pattern promises arrow keys and panels this does not have. A row
with nothing in the field has no value, so any choice hides it.

In a grouped source the bar is drawn once, ahead of the groups, and filters all of them. With
`hideEmptyGroups`, a group's own blocks carry every value its rows hold, so the same rule hides a
group that has no row left. Without it a group stays with its heading and no rows. Only the first bar
in a source counts. A grouped source honours only a bar at the top level of its content; one inside a
band there would repeat with every group, so it draws nothing and marks no row. The
values are those of the rows read, at most fifty, so a source that pages filters the page it is on.

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

A preset's fields may be lists and groups, in the same shape a block declares them, and
`{{props.x}}` of a list passes the list itself into a primitive's list field:

```json
{
  "type": "taglines",
  "fields": [{ "name": "words", "kind": "list", "max": 8, "item": { "kind": "text" } }],
  "blocks": [{ "type": "rotatingText", "props": { "words": "{{props.words}}" } }]
}
```

A request-time site reads its tenant's presets from the `Presets` site setting. A build-time site
passes them as `presets` in the config. `/api/blocks` lists a tenant's own presets beside the shipped ones when
it is mounted with the config. A preset never replaces a block that is code. It does
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
| `cardGrid` | Cards from a collection | heading, collection, filterField, filterValue, empty, tone, columns, padding, hueRotate, option |
| `peopleGrid` | People from a collection, typed in place, or both | heading, collection, filterField, filterValue, role, tone, columns, padding, items |
| `timeline` | Dated entries | heading, tone, padding, width, items |
| `steps` | Numbered entries | heading, tone, padding, width, items |
| `tiers` | Giving or pricing tiers | heading, tone, columns, padding, items |
| `keyValueTable` | A panel of facts | heading, tone, padding, radius, rows |
| `tabs` | Sections that open | heading, tone, padding, width, items |
| `announcement` | The one line above everything, and it stays there | message, label, href, tone, edge, align |
| `codeTabs` | A snippet to run, with the other ways behind it | heading, body, code, language, selectLabel, tone, padding, width, items |
| `progressList` | How far along each entry of a collection is | heading, collection, filterField, filterValue, empty, tone, padding, width |
| `changelogList` | Release entries, with the word for the kind of release | heading, collection, filterField, filterValue, empty, tone, padding, width |
| `faq` | Questions, all openable at once | heading, body, tone, padding, width, items |
| `map` | An embedded map, held to `embedHosts` | src, title, heading, aspect, tone, padding |
| `stat` | One figure and its label | value, label, align, motion |
| `timelineEntry` | One dated entry | date, title, body |
| `step` | One numbered step | number, title, body |
| `tier` | One tier | name, amount, body, label, href, tone |
| `person` | One person | name, role, photo, href, linkLabel, align |
| `keyValueRow` | One fact | label, value |
| `codeTab` | One more way to run it | label, code, language, selectLabel, group |
| `faqItem` | One question and its answer | question, answer, tone |

The blocks in the second half go in the first half's slots: stats in a `statBand`, entries in a
`timeline`, `disclosure` blocks in `tabs`, `codeTab` blocks in `codeTabs`, `faqItem` blocks in
`faq`. A card grid reads its entries through `{{item.Title}}`, `{{item.Summary}}`,
`{{item.Date | date}}` and `{{item.Href}}`, so it works against whatever the tenant calls those
fields, and it takes the collection as a prop rather than knowing any name. `{{item.Href}}` is the
collection's `href` field when it has one, and the item's own route otherwise, so a collection with
no route on this site (one filled by a sync, say) still gets a working card once its entries carry
their own link.

Set a card grid's `option` to `show` and each card carries the glyph and the word the site declared
for that entry's option, read through `{{item.Icon}}` and `{{item.Word}}`. With `filterField` and
`filterValue` picking the category, that is a module grid: one band per category, each card marked
with its own. It is off by default, so a grid that did not ask for it draws what it always drew.

`progressList` reads its figure through `{{item.Progress}}`, which is the collection's `progress`
field role: the tenant says which of its own fields holds a number from 0 to 100. Where a source
gives two counts instead, `progressCount` and `progressTotal` carry those through and the bar does
the division, so a GitHub milestone's open and closed issues need no field computing a percentage
first. `changelogList` does not group by itself, because grouping means knowing which field holds
the kind and that is the tenant's field name. One band per kind with `filterField` and `filterValue`
is the grouping, and the chip on each entry is the option's own word.

### Plugin packages

When no block covers a need, a developer writes one as a plugin package, and the published image
stays as it is. A plugin is an npm package that ships built JavaScript, like this one does, and whose
default export is `definePlugin`:

```tsx
import { defineBlock, definePlugin } from "barakopress";

type TallyProps = { count: number; label: string };

const tally = defineBlock<TallyProps>({
  type: "tally",
  label: "Tally",
  fields: [
    { name: "count", kind: "number", required: true },
    { name: "label", kind: "text", required: true },
  ],
  component: ({ props, theme }) => (
    <p style={{ color: theme.colors.accent }}>{props.count} {props.label}</p>
  ),
});

export default definePlugin({ name: "tally", blocks: [tally] });
```

`defineBlock` checks the fields against the props at compile time, the same as the built-ins: a field
name the props do not have, a kind that does not suit the prop's type, or an optional field for a prop
the component treats as always there does not compile. `examples/plugin-sample` is a complete one,
with its `package.json` and `tsconfig.json`; CI packs it, builds an image with it and renders it.

A plugin block is passed what every block is passed: its props, checked against its fields, its
slots, rendered, and the theme. It is not passed the config, the CMS address or a token, and data from
the CMS should reach it through a binding in its props or a module endpoint, not a credential. That is
what it is handed, not what it can reach: its code runs in the server with full access, `process.env`
and every `barakopress` export included. Installing a plugin means trusting it with the deployment.

Its name may not be one a built-in, a library block, the site or another plugin already registered.
Replacing one would change that block for every tenant, including the ones that never enabled the
plugin.

**Installing: a derived image.** Blocks are registered when the Next build runs, so a package cannot
be added to a built image. The published image holds the built server and not the source or the
toolchain, so the derived image is built from the engine's source at a release tag, which is what the
published image of that tag was built from, with the plugins handed in as a build context:

```bash
mkdir plugins
(cd ../my-plugin && npm pack --pack-destination ../site/plugins)   # your own plugin
npm pack barakopress-plugin-tally@1.2.0 --pack-destination plugins  # one from npm

docker buildx build \
  --build-context plugins=./plugins \
  -t my-press:0.8.0-plugins \
  https://github.com/BaryoDev/barakoPress.git#v0.8.0
```

`examples/derived-image/compose.yml` is the same thing in compose. The `plugins` directory holds
tarballs and nothing else, so what is built is exactly the bytes that were packed. The install runs
offline, so a plugin's own dependencies must travel inside its tarball: list each one in
`bundleDependencies`, and a tarball with a dependency it does not bundle is refused. So is a plugin
named like a package the engine already has (`react`, `next`, anything in its lockfile), which would
otherwise be linked over it. The build installs them beside the engine with no install scripts,
and writes `press.plugins.ts`, which the reference
`press.config.ts` passes to `createBlockRegistry(config, [], { plugins })`. An overlay with its own
`press.config.ts` imports `plugins` from `@/press.plugins` and passes it the same way. Pin the tag,
and next to it the commit it points at (`git ls-remote https://github.com/BaryoDev/barakoPress.git
v0.8.0`), since a tag can be moved; building from `#<commit>` is the strict form. The `v0.8.0` tag
exists from the 0.8.0 release on. Moving it is an engine upgrade, and a plugin should be rebuilt and
checked against it.

**Enabling: per tenant.** One derived image carries every plugin the deployment installs. A tenant
renders a plugin's blocks only when the `Plugins` setting in its `site` settings entry names it:

```json
{ "Plugins": ["tally"] }
```

Until then, it is as if the plugin were not installed for that tenant: `/api/blocks` does not offer its
blocks, a page that holds one renders everything around it and not the block, and a preset whose body
draws one is left out. A list saved empty turns every plugin off; a missing field leaves the ones the
config names (`plugins` in `defineConfig`, empty unless set). A build-time site enables plugins with
`plugins` in its config. `/api/blocks` also answers `plugins`, every installed plugin with whether the
tenant enabled it, which is what barakoBrew reads to show the switch. Each block a plugin added carries
`plugin` with its name.

What enablement does not do is keep code apart. Every plugin's module is loaded in the container for
every tenant it serves, and a tenant that has not enabled it is only kept from rendering it. So a
plugin nobody on the deployment trusts is not installed there. When tenants must not share plugins,
the answer is a separate deployment, its own barakoCMS, barakoBrew and barakoPress, not a second
barakoPress against the same API. A hotel's branch landing pages share one deployment; its booking
system gets its own.

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
| `presets` | none | `Presets` | Named blocks saved as arrangements of primitives. See Presets |
| `cmsUrl` | `CMS_URL`, or `http://localhost:5005` | operator only | Where the CMS is, from this server. The variable is read when the CMS is called, not when this file runs |
| `tenant` | `CMS_TENANT` | operator only | Tenant slug, for a multi-tenant deployment. On a request-time site, pins every host to it. The variable is read when the CMS is called, not when this file runs |
| `sites` | off | operator only | Request-time identity and theme from the tenant's site settings. See below |
| `pages` | off | operator only | Where the Pages module's pages are mounted. `""` is the site root. It has to match a route file on disk, which is why it is not a tenant's to set |
| `reservedSlugs` | the routes and the engine's files | `ReservedSlugs`, added to them | First path segments a root-mounted page may not take. Adds to the defaults |
| `regions` | off | `HeaderPath`, `HeaderTone`, `FooterPath`, `FooterTone` | The header and the footer as block regions |
| `collections` | the blog's `post`, `author` and `category` | `Collections` | Content types rendered as lists and detail pages, with each index's copy, index page and default byline. See Collections |
| `optionStyles` | none | `OptionStyles` | Tone, icon and label by `type.field` and option, for `colorBy` |
| `optionColors` | none | `OptionColors` | The same, when a tone is all an option has. Read as `optionStyles` |
| `labels` | English | `Labels` | The words the screens print for a visitor. See below |
| `store` | in process | operator only | Where the state a fleet has to agree on is kept: kept answers, the host map, the replay guard, the generation of each cache tag. Needed only when more than one container serves the site. See below |
| `home` | the post index | `HomePath`, `HomeCollection` | What `createHome` serves at `/`. See below |
| `theme` | the barakoCMS palette | `Colors`, `Fonts`, `Radii`, `Layout`, `Space`, `Text`, `Tokens`, `Tones`, `StyleRecipes` | Colours, faces, radii, column widths, a site's own named values and tones, and the looks its blocks can name. See below |

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

A request-time site puts its page routes under one tenant segment and adds a `proxy.ts` beside
`app/`:

```
proxy.ts                              export default createPressProxy(config)
app/
  %5Fpress/[site]/                    the tenant segment. %5F is `_`, which Next reads as a
    layout.tsx                        private folder when it is written plainly
    page.tsx
    [...path]/page.tsx
    blog/[slug]/page.tsx
  feed.xml/route.ts                   these resolve their own tenant and stay where they are
  robots.ts
  sitemap.ts
  api/...
  %5Fshare/route.ts
```

```ts
// proxy.ts
import { createPressProxy } from "barakopress";
import { config } from "@/press.config";

export default createPressProxy(config);
```

The proxy resolves the tenant and the share session once and rewrites to
`/_press/<tenant>~<gate>~<host>/<path>`. The pages read all three out of that segment, so nothing in
a page reads a header or a cookie, and Next can keep the render. Why the tenant has to be in the
path, and what is cached and what is not, is [The render cache](#the-render-cache) below. A build-time
site needs none of this and keeps its routes where they are.

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
`Radii`, `Layout`, `Tokens` and `Tones` (see [Tokens and tones](#tokens-and-tones)), `StyleRecipes` (see [Style recipes](#style-recipes)), `TopBar`, `HeaderLinks`, `MenuLinks`, `HeaderActions`, `FooterColumns`, `SocialLinks`, `HeaderPath`,
`HeaderTone`, `FooterPath`, `FooterTone`, `AssetsAsSupplied`, `LogoAsSupplied`, `LogoClearSpace`,
`PageSizes`, `ReservedSlugs`, `Labels`, `HomePath` and `HomeCollection`. `Collections`, `OptionStyles` and `OptionColors` are read as the collections section
describes. `Variants` are not rendered yet. Every value is checked for shape; one that fails, and any the
entry leaves out, keeps the configured value, so a half-filled theme renders. A link is a path on the
site or an absolute http or https URL. Set `Url`: without it the feed and sitemap fall back to the
host the tenant was found by. A link in `HeaderLinks`, `TopBar` or `FooterColumns` may also carry
`badge`, a marker of up to 12 characters drawn beside the label, and `external: true`, which the
built-in header does not need (every header link is already a plain anchor) and a theme can read.
A link in `HeaderLinks` or `MenuLinks` may also carry `activeOn` and `children`; see
[The built-in header](#the-built-in-header).

`createSiteLayout` and `createSiteMetadata` render the root layout from all of this: `lang`, the
faces, the palette, the top bar, header links, footer columns, social links and the copyright line.

**What the site serves at `/`.** Every site used to be a blog at the root, because the root route
mounted the post index and nothing else could be named:

| Field | Type | What |
| --- | --- | --- |
| `HomePath` | string | A site path such as `/home`. The page the Pages module serves there is the home page. Nothing served there falls back to the index, so naming a page before writing it is safe |
| `HomeCollection` | string | The key of a collection. Its index is the home page. `HomePath` wins when both are set |

Neither set, `/` is the post index, which is what it was. The blog's own `post`, `author` and
`category` are ordinary `Collections` entries now, so a school whose news lives in `article` with a
`Headline` replaces `post` in its settings and gets both its list and its item pages from that entry.
The RSS link in the built-in header, and the feed alternate in the page metadata, appear only when
some collection has `feed` on, so a clinic with no posts stops advertising an empty feed.

**The words a visitor reads.** `Labels` is the visitor-facing copy, key by key. A school setting
`Locale` to `fil-PH` used to get Filipino dates beside English "min read" and "Related":

```json
{ "Labels": { "minRead": "minutong pagbasa", "by": "ni", "related": "Kaugnay" } }
```

| Key | English |
| --- | --- |
| `minRead` | `min read` |
| `by` | `by` |
| `related` | `Related` |
| `relatedNote` | `cosine similarity, computed on load, not curated` |
| `featured` | `Featured` |
| `back` | `Back` |
| `home` | `Home` |
| `preview` | The banner over a draft being previewed |
| `untitled` | `Untitled` |
| `feed` | `RSS` |
| `empty`, `emptyNote` | The notice on an index with nothing published |
| `failed`, `failedNote` | The notice on an index whose read failed |
| `shareInvalid` | `This link is not valid or has expired.` |
| `openMenu`, `closeMenu` | `Open menu`, `Close menu`: the header's phone menu button |
| `menu` | `Menu`: the name of the phone menu's links |
| `submenu` | `{label} links`: the button beside a header link with children, `{label}` its label |
| `onThisPage` | `On this page`: the heading over a tree page's rail |
| `closeContents` | `Close`: the closed phone disclosure's control while it is open |

A key left out, or saved as anything but a word, keeps the English, so a half-filled map reads. A
build-time site passes `labels` to `defineConfig`. Nothing about a site's own content is here: a
collection's heading is its `label` and how its count reads is its `noun`.

**The colour slots, by role.** `Colors` sets any slot of the palette, one at a time. The slots are
`pageBg`, `surface`, `ink`, `proseInk`, `secondaryInk`, `muted`, `hairline`, `accent`, `accentHover`,
`accentInk`, `accentTint`, `accentTintBorder`, `accentBorderStrong`, `inverse`, `inverseChrome`,
`inverseInk`, `inverseAccent`, `code` and `success`. A role says where a colour goes rather than what
it looks like: `inverse` is the band that reverses the page, the footer and a code panel and an
inverse block, so a bakery with a cream footer sets `inverse` to cream and reads right doing it.

```json
{ "Colors": { "accent": "#17458F", "inverse": "#F4E3C1", "inverseInk": "#3B2A17" } }
```

Six slots shipped in 0.3.0 under barakocms.com's own names, and those still work: `darkPanel`,
`darkPanelChrome`, `darkPanelInk`, `darkPanelAccent`, `codeGreen` and `accentTintBorderStrong` are
read into `inverse`, `inverseChrome`, `inverseInk`, `inverseAccent`, `code` and `accentBorderStrong`.
Setting either name sets both, so a tenant saved before the rename keeps its site and a consumer's
own component reading `theme.colors.darkPanel` keeps compiling. The old names are deprecated and go
in 2.0.0. An `OptionStyles` or `OptionColors` entry naming an old slot resolves too.

Sizes work the same way. `Text` is the type scale by role, `meta`, `small`, `body`, `lead`,
`subheading`, `heading`, `title`, `display` and `pageTitle`, and `Space` is the spacing scale. The
blocks and the screens read those names, so a tenant that wants bigger headings sets `title` once
instead of asking for a release.

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
| `HeaderTone` | string | `page`, `surface`, `accent`, `inverse`, `gradient`, `wash`, or a name from `Tones`: the tone behind the header region. `page` when unset or not one of those |
| `FooterPath` | string | A site path such as `/site/footer`. The page served there is drawn in place of the footer |
| `FooterTone` | string | The same names, behind the footer region |

Set neither and nothing changes: `TopBar`, `HeaderLinks`, `FooterColumns`, `SocialLinks` and
`Copyright` draw the built-in chrome with the markup they always had, which is what keeps a site
whose own CSS keys off that markup rendering. A path with nothing served at it does the same, so
naming a page before writing it is safe, and so is a typo.

### The built-in header

With no `HeaderPath`, the header is the logo, the page menu, `HeaderLinks` and the feed link. Four
more settings shape it:

| Setting | What |
| --- | --- |
| `activeOn` on a link | Space separated site paths the link is current on. `/` is the home page alone; any other path covers itself and everything below it, so `/docs` is current on `/docs/intro`. A trailing slash is ignored. The current link gets `aria-current="page"` and the class `bp-current`. It can name a path the link does not point to: a chat server's link can be current on `/community` |
| `children` on a link | Links under this one, one level deep, each with its own `label`, `href`, `badge`, `external` and `activeOn`. Drawn as a dropdown that opens on hover and on keyboard focus and closes on Escape and when focus leaves, beside a button with `aria-expanded` that opens it too. A child's `activeOn` marks its parent current as well. The parent keeps its own `href` |
| `MenuLinks` | The rows of the phone menu, in the shape of `HeaderLinks`. Children are drawn as an indented group. Unset or empty, the phone menu shows `HeaderLinks` |
| `HeaderActions` | Up to four call to action links after the header links, each `{ label, href, variant }` with `badge` and `external` as on any link. `variant` is `primary` (filled with the accent), `secondary` (outlined) or `plain`; unset or unknown is `primary` |

Below 48rem, a site that uses any of these gets a menu button in place of the header links and the
actions, opening a sheet with the `MenuLinks` rows, the feed link and the actions. The button is a
`details` element and every link is in the server's HTML, so the menu and the dropdowns work
without JavaScript; the script adds Escape and keeps `aria-expanded` true to what is shown. The
words on the controls are `openMenu`, `closeMenu`, `menu` and `submenu` in `Labels` (`submenu` is
`{label} links`, with the parent's label in place of `{label}`).

A site that sets none of them gets the header it had before, byte for byte.

A region page is chrome rather than somewhere to go, so it is left out of the menu and the sitemap,
and it answers 404 at its own route: what it holds is already on every page. A collection's
`indexPage` is treated the same way.

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
`<cacheTag>:<tenant>`, and a narrower tag beside it: `<tenant tag>:entry:<type>:<slug>` on a read of
one entry, `<tenant tag>:type:<type>` on a list, a search, the settings and the page tree. The webhook
purges the tags of the tenant its host resolves to, so point each tenant's webhook at
`https://<that tenant's domain>/api/revalidate`, signed with that tenant's own key (see
[One key per tenant](#one-key-per-tenant)). A publish on one tenant leaves every other tenant's cached
reads in place.

**When the CMS is down.** Each successful read is also kept in the store, keyed by CMS, tenant and path.
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

Switching `Mode` is a publish: the webhook drops the tag the settings read carries and the next
request reads the new settings. No deploy.

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

Whether a request gets the holding page is decided by the proxy, from the cookie, once per request,
and the answer is a segment of the path the render is kept under. A render made for a visitor with a
session is never served to one without, or the reverse, because the two are different paths. A page
you write by hand must call `siteConfig(config, params)` before it reads or renders anything, which
is what keeps it behind the holding page and what gives it its tenant. A build-time site has no
settings entry and no holding mode.

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

**A theme that draws the page itself.** A deployment that ports an existing design registers its own
blocks under the built-in type names and ships its own stylesheet. Two things would still be the
engine's, and neither can be undone from a stylesheet because both are inline: the page frame
(`main`, its padding, the title and the breadcrumbs) and the gap between blocks. So:

```tsx
export default createPage(config, blocks, { bare: true });   // only the blocks
```

```css
body { --bp-gap: 0; }   /* every block list, at every level */
```

`bare` is also taken by `createHome` and `createViewerPage`. `--bp-gap` falls back to
`theme.space.lg`, so a site that sets neither renders as it did.

### Tokens and tones

The theme's slots are the engine's roles. A design has its own palette on top of them: a colour per
product, a tint for a badge, a length the design repeats. Those are `Tokens` and `Tones` in the site
settings, or `theme.tokens` and `theme.tones` in `defineConfig`. A tenant's entries merge over the
configured ones name by name.

```json
"Tokens": { "accent": "#E4572E", "cms-ink": "#1D3A8A", "cms-bg": "#E8EEFD", "gutter": "24px", "serif": "'Zilla Slab', Georgia, serif" },
"Tones":  { "cms": { "ink": "cms-ink", "bg": "cms-bg", "edge": "#B9C8F5" } }
```

A token is a name and one value: a colour (checked as `Colors` is), a length or a `clamp()` of three
(checked as `Text` is), or a font stack of plain or quoted family names. A name is a letter, then
letters, digits and hyphens, up to 40. Each token is emitted on the root as `--t-<name>` by
`createSiteLayout` (through `themeVariablesCss`), so a site's stylesheet and its blocks write
`var(--t-accent)` instead of a hex value. A name or a value that fails its check is dropped and the
rest are kept. Up to 200.

A tone is a name and three colours: `ink`, `bg` and `edge` (hairlines and borders). Each is a token
name, a `Colors` slot name, or a colour written out, looked up in that order when the tone is drawn,
so changing a token changes every tone that names it. Text of every kind on the tone is the `ink`,
and a filled accent is the `ink` with the `bg` as its text. A name is lower case letters, digits and
hyphens; a built-in name is refused, since those follow `Colors`. A tone with a colour that resolves
to nothing is dropped. Up to 40.

Every block field that picks a tone offers the site's tones after the built-in six, and a block
stores `"tone": "cms"` the way it stores `"tone": "accent"`. `HeaderTone` and `FooterTone` take them
too. `/api/blocks` lists them on every tone field: a build-time site's own, and on a request-time
site the requesting tenant's, when the route is mounted as `createBlockSchemaRoute(config, blocks)`.

A site that sets neither gets no `--t-` property and no new option anywhere, and renders byte for
byte as it did.

Read time is derived from the body at 200 words a minute, with fenced code blocks excluded, so there
is no field to fill in and nothing to keep in sync.

### Style recipes

A primitive draws itself from tokens, which keeps every page one design and also means a designed
section cannot be built from primitives: a card with its own padding, border, corner and shadow is
not something any token names. A recipe is that card, said once in the site settings as
`StyleRecipes` (or `theme.recipes` in `defineConfig`), and a block wears it with `recipe`.

```json
"StyleRecipes": {
  "card": {
    "class": "lift",
    "style": {
      "padding": "22px 24px",
      "background": "{colors.surface}",
      "border": "1px solid {colors.hairline}",
      "border-radius": "16px",
      "box-shadow": "0 1px 2px rgba(16,18,35,.04)",
      "display": "flex",
      "flex-direction": "column",
      "gap": "{space.sm}"
    }
  },
  "eyebrow": {
    "style": {
      "font-family": "{fonts.mono}",
      "font-size": "11px",
      "letter-spacing": ".16em",
      "text-transform": "uppercase",
      "color": "{colors.muted}"
    }
  }
}
```

```json
{ "type": "panel", "props": { "recipe": "card", "content": [[
  { "type": "text", "props": { "value": "01 Products", "recipe": "eyebrow" } }
]] } }
```

A recipe is a name and two keys, both optional but not both empty:

- `class`: class names, space separated, put on the element beside the style. A style attribute
  cannot say `:hover`, a focus ring or a media query, so those go in the site's own stylesheet under
  this class. Up to 8, each a letter or underscore, then letters, digits, `_` and `-`.
- `style`: CSS property names, written as a stylesheet writes them, to values. Up to 40.

A value is CSS text, and `{name}` in it stands for a theme value: `{accent}` is the token of that
name from `Tokens`, and `{colors.<slot>}`, `{space.<step>}`, `{radii.<name>}`, `{text.<role>}`,
`{fonts.<role>}` and `{layout.<name>}` are the theme's own. References are resolved when the block
draws, against the requesting tenant's theme, so changing a token changes every recipe that names
it. A declaration whose reference does not resolve is left out and the rest of the recipe draws.

The properties a recipe may set:

| Group | Properties |
| --- | --- |
| box | `display`, `position` (`static` or `relative` only), `box-sizing`, `width`, `min-width`, `max-width`, `height`, `min-height`, `max-height`, `aspect-ratio`, `overflow`, `overflow-x`, `overflow-y`, `vertical-align`, `opacity` |
| spacing | `margin`, `padding` and their four sides, `margin-block`, `margin-inline`, `padding-block`, `padding-inline`, `gap`, `row-gap`, `column-gap` |
| typography | `font-family`, `font-size`, `font-weight`, `font-style`, `font-variant-numeric`, `line-height`, `letter-spacing`, `text-align`, `text-transform`, `text-decoration`, `text-underline-offset`, `text-wrap`, `text-overflow`, `white-space`, `overflow-wrap`, `word-break` |
| colour | `color`, `background`, `background-color` |
| border | `border`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-color`, `border-style`, `border-width` |
| radius | `border-radius` |
| shadow | `box-shadow`, `text-shadow` |
| grid | `grid-template-columns`, `grid-template-rows`, `grid-auto-flow`, `grid-auto-rows`, `grid-column`, `grid-row`, `justify-items`, `place-items`, `place-content` |
| flex | `flex`, `flex-direction`, `flex-wrap`, `flex-grow`, `flex-shrink`, `flex-basis`, `align-items`, `align-content`, `align-self`, `justify-content`, `justify-self`, `order` |
| engine | `--bp-ink`, `--bp-ink-soft`, `--bp-muted`, `--bp-hairline`, `--bp-accent`, `--bp-on-accent` (the tone the blocks inside read), `--bp-gap`, `--bp-list` (a block list's gap and display), `--bp-code-ink`, `--bp-code-bg`, `--bp-code-size`, `--bp-code-pad`, `--bp-code-radius` (inline code in a text block) |

The list is also exported as `RECIPE_PROPERTY_GROUPS`, for an editor.

The values reach a style attribute, which React writes by joining `name:value;` with no CSS
escaping, so a value is held to a narrow shape rather than cleaned. It is letters, digits, spaces
and `# % . , ( ) / + * -`, up to 240 characters, with quotes only around a plain family name
(`'JetBrains Mono'`). Parentheses balance, and a function is one of `calc`, `min`, `max`, `clamp`,
`minmax`, `repeat`, `fit-content`, `var` (naming a custom property and nothing else), the colour
functions (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color-mix`) and the
gradients. So `;`, `:`, braces, angle brackets, a backslash, `!important`, `@`, a comment, `url()`,
`expression()`, `image-set()` and `attr()` are all refused: a recipe cannot load anything and
cannot leave its own declaration. A property off the list, or a value that fails, is dropped and
the rest of the recipe kept, the way `Colors` drops one bad colour. The check runs again when the
block draws, on the resolved value, so a theme built by hand gets it too. A name is lower case
letters, digits and hyphens, up to 40. Up to 400 recipes, merged over the configured ones name by
name: barakocms.com's pages are about three hundred looks, one per element its design styles.

What wearing one does to a block:

- The block is its own cell. Every block in a list sits in a wrapper, and under a recipe the wrapper
  is `display: contents`, as a transparent block's is, so the recipe's element is what its parent
  lays out: a lede that takes `flex: 1 1 420px` beside a claim, a card that is the grid's item. A
  name the site has no recipe for keeps the wrapper along with the block's own look.
- The recipe replaces the block's own inline look on its outer element outright. It is not merged
  over it: the card's own padding under a recipe that only set the corner is a look nobody drew.
  The block's token props for that element (`padding`, `radius`, `border` and so on) are not
  applied.
- What makes the block work stays: a `stickyBar` keeps `position: sticky`, a `flow` keeps its cells
  (`--bp-list: contents`), a `row` and a `tabGroup` stay wrapping rows, a `list` keeps its marker, a
  `comparisonTable` keeps its own horizontal scroll, an `embed` keeps its width, shape and no
  border, a `figure` keeps no margin, and a `rotatingText` keeps the box its words stack in.
- So does the layout the block's own props ask for: a `grid` or `flow` with `columns` keeps its
  grid and track list, and `align` and `justify` on a `stack`, `row` or `flow` are kept. A prop left
  unset leaves the recipe to say it, so a `flow` with no `columns` takes its grid from the recipe.
- A `tone` named beside a recipe still sets the tone the blocks inside read. Without one, a recipe
  that changes the background sets `--bp-ink` and its neighbours itself.
- A `tabPanel`'s recipe is its tab in the strip, and the open tab keeps its colours over it.
- `recipe` is a text field, so a preset passes its own prop through, and a bound name picks a look
  per row: `"recipe": "card-{{item.Product}}"`.
- A name the site has no recipe for draws the block's own look. A block that names none renders
  byte for byte as it did.

### Inline marks in a text block

`text` takes `format`, `plain` (the default) or `inline`. Inline, its value is one line with marks
in it: `` `code` ``, `*emphasis*`, `**strong**`, `[links](/docs)` and `==an accent==`, which is drawn
as `<span class="bp-accent">`. Accents do not nest: `==` inside one ends it. Nothing that makes a
block of its own is read, so a heading stays one element: `# x`, a list or a quote is the text it
is, and an image keeps only its alt text. A value longer than 2000 characters is read as plain text,
since emphasis parsing is quadratic at worst and the value may be bound from content.

It goes through the same safe renderer as a body (`renderInlineMarkdown` in `barakopress/markdown`):
raw HTML is escaped, a link must be a path, an anchor, http, https or mailto or it keeps its words
and loses the link, and every attribute is escaped. A path starting `//` or `/\` is another site
to a browser, so it is refused here and in a body alike.

The marks are styled under `:where(.bp-inline)`, so each rule weighs no more than the element it
names and a site's own `.lede code` wins. The accent and a link take the band's accent. Code is the
mono face, and reads `--bp-code-ink`, `--bp-code-bg`, `--bp-code-size`, `--bp-code-pad` and
`--bp-code-radius` first, so a recipe gives the code in one block a tint and a corner:

```json
"StyleRecipes": {
  "grabs-body": { "style": { "font-size": "14px", "--bp-code-bg": "#EEEBFD", "--bp-code-ink": "#4034A8", "--bp-code-pad": "1px 5px", "--bp-code-radius": "5px" } }
}
```

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

### What a publish drops

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

### Running more than one container

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

**The cache invalidation is configuration, not code.** In barakoBrew: a workflow on your post content
type, trigger `Published`, one Webhook action with the URL and a shared secret. Nothing is deployed
to change it.

### The render cache

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
[Plugin packages](#plugin-packages).

One thing to expect on a first release: the image prerenders during `docker build`, where the CMS is
not reachable, so the index, the feed and the sitemap are built empty and correct themselves one
revalidate window later. That is why the manifest's `verify` greps the page rather than reading the
status code, and why it waits long enough to see it happen.

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
