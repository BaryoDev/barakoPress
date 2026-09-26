# Collections: any content type as a list and a detail page

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

A request-time site cannot add a route file per tenant, so the root catch-all from [Pages](pages.md)
also serves every collection with a route: its index at the route, and an item one segment below. A
route file wins where there is one. A collection's route, and every path below it, is reserved from
pages at the root. A route of one segment reserves that segment; a deeper one is matched segment by
segment, so a collection at `/docs/modules` leaves `/docs/guides/start` to a page. A collection with
`index: false` frees its route's own path for a page, the blog's `/blog` included, and keeps what
is below it. See [Reserved slugs](pages.md#pages-and-navigation-from-the-pages-module) for what is never freed.

A detail page lists the items of the first collection that references it, so `/departments/cardiology`
lists its doctors, the way an author's archive lists their posts. `listCollection(config, "doctors",
{ filter: { Department: "cardiology" } })` returns the same list. `listRelated`, which did this and
the semantic search below for posts, is `@deprecated` since 0.7.0.

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
exported too, with `getItemPreview(config, key, slug, token)` for a draft read uncached,
`listAllCollection(config, key, { limit })` for every item a page at a time up to `limit` (it says
whether it stopped short), and `toItem(config, key, entry)`, which maps a stored entry through the
collection's field map. `toPost`, `listPosts`, `getPost`, `getPostPreview` and `listPostsBy` are
`@deprecated` since 0.7.0 in favour of these.

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

An item links where the collection's `href` field says it is read, when the collection maps one and it
is a path on this site, and at its route and slug otherwise: the sidebar, previous and next, the
in-page index and the sitemap all follow it (`treeItemHref`). An absolute address is not followed. Slugs are unique across a tenant, so a manual whose products each have a
quickstart keeps `cms-quickstart` as the slug and names `/docs/cms/quickstart` in the field. The route
serving that path is the site's own. A site drawing the sidebar on a page the tree does not hold, an
index, gives `TreeAside` or `TreeSidebar` a `summary` (`{ line, title }`) for the closed control to say.

**Search.** `searchCollection(config, key, query)` goes through barakoCMS's `/api/public/{type}/search`,
which matches only over the fields a type publishes, so a draft or a field held back from public
delivery can never come back. `createCollectionIndex(config, key, { search: true })` answers `?q=` with
what matched instead of the index; that reads the query, so the route is dynamic and `output: "export"`
refuses it, which is why it is off unless asked for. The box is a `form`, the results are links, and
the keyboard handling on top ("/" to focus, the arrow keys to walk the results, escape to clear) is a
client component, one of three in the package with the filter bar and the header's menu. The root catch-all answers `?q=` on a collection index too, but
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

## Related posts, if the CMS has the AI module

`createBlogPost` asks `BarakoCMS.AI` for the posts closest to this one and renders a band of cards
with the similarity score on each, so a site using the factory gets it for nothing. Any collection
gets the same band with `related: "semantic"`, and `listRelatedItems(config, key, item)` returns the
list on its own. `listRelated`, the post-only call, is `@deprecated` since 0.7.0.

Nothing about it is required. A CMS without the module answers 404, a type that is not publicly
deliverable answers 404, a module installed but not enabled answers an empty list, and an
unreachable CMS throws. All four end the same way: an empty array, no band, no heading, no empty
state. The reader of a site without the module never learns the feature exists.

The post being read is its own closest match, so the fetch asks for more than it renders and drops
itself. A hit with no slug is dropped too, because there is nothing to link it to.

Turning it on is the CMS's job, not this package's: `dotnet add package BarakoCMS.AI`, point
`Ai:EmbeddingBaseUrl` at an Ollama instance, set `Ai:Enabled`, and index the type.
