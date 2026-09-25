# Changelog

## 0.8.0 (unreleased)

- A `source` with `mode: "all"` reads every row of a collection, fifty to a request and up to 500,
  as one of the page's reads, for a page that is a whole collection such as a changelog. A `repeat`
  draws every row its source read unless `limit` names fewer, and the blocks its rows draw spend a
  budget of their own (10,000) rather than the page's 400, and so do a grouped source's groups. The
  requests past each source's first come at once, out of 16 a page's `all` sources share. A source
  that could not read everything it matched, a repeat or a grouped source cut short by the budget,
  says so in the server log, and `{{count}}` stays what the collection holds. A sum and a distinct
  count are worked out once per source. `MAX_ALL_ROWS`, `MAX_ALL_REQUESTS` and `MAX_ROW_BLOCKS` are
  exported. A source in `one` or `list` mode reads what it did.
- `{{distinct.<Field>}}` inside a `source` is how many different values a field holds among the
  rows read, each entry of a list counting on its own and an empty field adding nothing: the number
  of repositories a list of issues spans, beside `{{count}}` of the issues. A source that read part
  of what it matched has no distinct counts, so the fallback renders rather than a count of one page.
- The element a primitive draws, for a design rebuilt from primitives and recipes
  (arnelirobles/barakocms-site#46). A block wearing a recipe is its own cell: its list wrapper is
  `display: contents`, so the recipe's element is the flex or grid item its parent lays out, an
  inline one included: in a column list a link wearing `display: inline-block` is stretched to the
  column's width unless its recipe sets `align-self: flex-start` or `width: fit-content`. Such a
  wrapper carries `data-bp-contents`, and a hue flow turns the element inside it. `text`
  takes `tag` (`p`, `span`, `code`, `strong`, `em`, `h1` to `h4`), `decorative` (hidden from a
  screen reader) and `title`. `stack` and `panel` take `href`, which makes the whole container a
  link (an address off the site with `rel="noopener noreferrer"`), dropped when what the container
  holds renders a link or a control of its own, and `section`, `stack` and `panel` take `anchor`,
  drawn as the element's `id`. A `filterBar`
  takes `recipe`, `buttonRecipe` and `pressedRecipe` for its row and its buttons. A site may keep
  400 recipes, up from 100. A block that uses none of this renders as it did.
- The tree screens take a site's styling (#130). Every colour, gap, padding, radius and font size in the sidebar,
  the switcher, the search box, the pager and the edit link is read as
  `var(--t-tree-<name>, <today's value>)`, so a tenant's `Tokens` restyle one part at a time and a
  site that names none draws the same pixels as before. Each part carries a `bp-tree-*` class. A
  tree's `variant` picks the layouts a token cannot: `switcher` `tabs` or `list`, `sidebar` `plain`
  or `boxed`, `rail` for an "on this page" column of the item's headings, `pager` `wide` or `halves`;
  each component takes the same as a `variant` prop. A product takes a `note`. `searchIndex: true`
  draws the tree's titles and headings into the page and filters them as the reader types.
  `treeSearchIndex(tree)` builds that index once per tree read, and `itemHeadings` tokenises a body
  once however many pages list it. New exports: `TreeRail`, `TreeAside`, `treeVariant`,
  `treeSearchIndex`, `itemHeadings`, `markdownHeadings`. New label: `onThisPage`.
  Two more variants: `search: "compact"`, one well with a magnifier, the input named for a screen
  reader and a "/" key hint, its results floating; and `disclosure: "closed"`, the sidebar closed on a
  phone under a control naming the page, with no script. A tree's `icons` may point both glyphs at a
  site's own sprite. Every label paragraph carries `bp-label`, `searchEmpty` may say `{query}`, and
  there is a `closeContents` label. The index keeps every page's title past its 2000 entry limit and
  drops headings instead, saying so once; an entry is a plain link styled from one stylesheet; the
  results are put away when focus or a press goes elsewhere; and a box with no `searchPath` has no
  form, so Enter never reloads the page.

- A `filterBar` block inside a `source` (#129) draws one button per distinct value of a field among
  the source's rows, in the order first seen or as `order` says, after an "all" button. The buttons
  are toggles with `aria-pressed`, not a tablist. The rows stay server-rendered: the binder marks
  each with the bar's id and its values, and a click writes one rule that hides the rows without the
  value, escaped as a CSS string and winning over inline `display`. `separator` splits a text field
  holding several values, and `hideEmptyGroups` hides a group of a grouped source once none of its
  rows is left. A bar offers at most a hundred values, and a row of a nested source belongs to both
  bars. A site needs no hide rule of its own. A source with no bar renders as it did.
- Plugin packages (#25). A plugin is an npm package whose default export is
  `definePlugin({ name, blocks })`, its blocks written with `defineBlock` and checked at compile time
  the same as the built-ins. It reaches a deployment through a derived image: `npm pack` tarballs in a
  directory passed to the Dockerfile as the `plugins` build context, built from the engine's source at
  a pinned release tag (`examples/derived-image/compose.yml`). One image carries every plugin, and a
  tenant renders a plugin's blocks only when its `Plugins` site setting names it; a build-time site
  sets `plugins` in its config. Until then the blocks are not in `/api/blocks`, a page holding one
  renders without it, and a preset drawing one is left out. `/api/blocks` adds `plugins`, each
  installed plugin with whether the tenant enabled it, and `plugin` on each block a plugin added.
  `createBlockRegistry` takes `plugins`, and refuses a plugin block whose name is already taken. A
  plugin block is passed its props, slots and theme and not the config, but its code runs in the
  server with full access, so installing a plugin is trusting it with the deployment. Every plugin's
  code is loaded for every tenant the container serves, so tenants that must not share plugins need
  separate deployments. A plugin's dependencies must be bundled in its tarball, since the install
  runs offline, and a plugin named like a package the engine has is refused. An image built with no plugins renders exactly as before.
- Style recipes, and inline marks in text (#131). `StyleRecipes` in the site settings (or
  `theme.recipes`) holds named looks, each `{ class, style }`: classes put on the element, and CSS
  properties to values, where `{name}` in a value is a token and `{colors.accent}`, `{space.lg}` and
  the like are the theme's own. Every primitive takes `recipe`, and a recipe it names replaces its
  own inline look on its outer element, keeping only what the block needs to work. Properties are
  held to a list (box, spacing, typography, colour, border, radius, shadow, grid, flex and the
  engine's own custom properties), and a value to letters, digits, a few symbols, quoted family
  names and a short list of functions, so `url()`, `expression()`, `;`, braces and `!important` are
  refused. A bad property or value is dropped and the rest kept. `text` takes `format: "inline"`,
  which reads code, emphasis, strong, links and `==an accent==` through the safe renderer
  (`renderInlineMarkdown`), up to 2000 characters, past which the value is plain text. A block that
  names no recipe, and a text block left `plain`, render as they did.
- A markdown link or a `url` field starting `//` or `/\` is refused. A browser reads both as another
  site, and they were let through as paths.
- The tenant-aware `/api/blocks` handler takes its request as required, not optional. Next's route
  type check refuses a handler whose request may be absent, so a consumer built with webpack failed
  its type check on `app/api/blocks/route.ts`.
- Counts, sums and groups over a source (#128). `{{count.<collection>}}` is how many published
  entries a collection has, read as the delivery API's `totalItems` for a page of one row and cached
  like any read. Inside a `source`, `{{count}}` is how many rows its filter matched, and
  `{{sum.<Field>}}` adds a numeric field over the rows it read. A `source` with `groupBy` renders its
  content once per distinct value of that field, in the order first seen or as `groupOrder` says,
  with `{{group.key}}` and `{{group.count}}` in scope and `repeat` walking that group's rows. Each
  collection counted is one of the page's eight reads. A count that cannot be read renders its
  fallback and is reported. A filtered count is a `source` with `pageSize: 1` rather than a filter
  written into the placeholder, which stays paths, formats and fallbacks. `count`, `sum` and `group`
  are now scopes, so a page that had one of those words typed as a placeholder renders its fallback
  where it used to show the braces. A page that uses none of it renders as it did.
- `/api/blocks` answers with the requesting tenant's presets and tones (#134). Mount it as
  `createBlockSchemaRoute(config, blocks)` and a request-time site resolves the tenant as a page
  does, from the host through the CMS, `CMS_TENANT`, the named tenant header or
  `CMS_DEFAULT_TENANT`, and publishes that tenant's schema. Before, it was built once from the
  startup registry, so barakoBrew never offered a tenant its own presets or tones. A host with no
  tenant answers 404, a failed lookup 503. The settings read is cached under the tenant's tag, so a
  settings change shows after the next revalidate. A build-time site gets the same answer as before,
  and `createBlockSchemaRoute(blocks)` still works unchanged. CORS is unchanged; a site that names a
  tenant header adds it to `Vary`.
- The built-in header takes four more settings (#127). A header link's `activeOn` names the paths it
  is current on (`/` the home page alone, any other path and everything below it, a trailing slash
  and the `/_press/<site>` rewrite prefix ignored), marked with `aria-current="page"` and the class
  `bp-current`. A link's `children` draw a dropdown on desktop, opening on hover and on focus and
  closing on Escape and when focus leaves, and an indented group in the phone menu. `MenuLinks` are
  the phone menu's rows, falling back to `HeaderLinks`. `HeaderActions` are call to action links
  with a `primary`, `secondary` or `plain` variant. Below 48rem the header links and the actions
  give way to a menu button over a `details` element, so no link needs JavaScript. The controls take
  new `Labels`: `openMenu`, `closeMenu`, `menu` and `submenu`. A site that sets none of them renders
  the header it had, byte for byte. The package's second client component draws the parts that
  follow the path.
- A collection's index copy, an index page and a default byline are settings (#126).
  `Collections.<key>.index` may be `{ eyebrow, heading, lede, empty, unavailable }`, drawn by the
  collection index and the blog index in place of the label, the tagline and the `labels` notices.
  `indexPage` names a page whose blocks render above the list on the index route. `defaultAuthor` is
  the byline on a card and an `article` page when the entry names no author. A site that sets none
  of them renders as it did.
- A page that only holds data or chrome, a header or footer region page or a collection's
  `indexPage`, answers 404 at its own path and is left out of the menu and the sitemap. Region pages
  used to answer at their own path; they were already left out of the menu and the sitemap. The
  holding page is not affected.
- `pageBlocks` lives in its own module so the collection index can render an index page. It is still
  exported from the package, unchanged.
- An entry's own field is no longer hidden by a role its collection does not map (#121). Inside a
  `repeat` or a `source`, `{{item.Body}}`, `{{item.Date}}` and the other role names read the entry's
  own field of that name unless the collection's `fields` names the role, and a mapped role still
  wins. barakocms.com's changelog lost every date to this.
- A site can name its own palette (#125). `Tokens` in the site settings (or `theme.tokens`) holds
  named colours, lengths and font stacks, emitted on the root as `--t-<name>`. `Tones` (or
  `theme.tones`) holds named `{ ink, bg, edge }` tones, each colour a token name, a `Colors` slot or
  a colour written out. Every block tone field, and `HeaderTone` and `FooterTone`, take the site's
  tone names beside the built-in six. Values are checked as `Colors` and `Text` are, and one that
  fails is dropped with the rest kept. A site that sets neither renders as it did. The README said
  `HeaderTone` and `FooterTone` take four names; they take six, and now the site's own.
- Block fields can be a `list` (entries of `text`, `url`, `number` or `group`, with `min` and
  `max`) or a `group` (its own `fields`), so a block declares "a list of stages, each a label, a
  name and a body" instead of numbered fields or comma separated text, and an editor adds a fifth
  stage without a code change (#124). A whole-value binding such as `{{item.Tags}}` fills a list
  with the array itself, checked entry by entry and never rescanned; strings typed inside a list or
  a group bind like any string prop. Presets can declare both kinds. `rotatingText` takes a `words`
  list and still reads the comma separated `items` pages already store. The block schema stays
  version 2 and publishes `item` and `fields` as added keys: barakoBrew 1.4.0 edits a kind it does
  not know as JSON for that field alone, so its form editor keeps working for every other field.
- A look check pair can set its own capture `timeout`, or the defaults can. A page as tall as
  barakocms.com's changelog (over 100,000px at 390px) took longer than the fixed 30 seconds to
  screenshot and was reported as not captured, so it was never compared at all.
- `postFromItem` is exported, so a site's own post view (the `view` option of
  `createCollectionDetail`) maps an item to a post the way the engine does, draft preview included.
  Without it a theme had to read the post again with `getPost`, which returns the published
  version and so broke preview.
- A site link can carry a `badge` (up to 12 characters, drawn beside the label in the built-in
  header) and `external: true`, read from `HeaderLinks`, `TopBar` and `FooterColumns`. A value of
  the wrong kind is dropped and the link kept. barakocms.com's nav marks barakoBrew with "V1", and
  had no way to say so in its settings.
- A deployment's overlay can live outside this repository. The image build takes it as the `overlay`
  build context (`--build-context overlay=<dir>`, or `additional_contexts` in compose), and an
  overlay that ships its own `app/%5Fpress/` replaces the tenant tree instead of losing it, so a
  request-time site can bring its own layout and routes. `PRESS_TRAILING_SLASH=true` sets Next's
  `trailingSlash` at build time. Before this, a site theme had to be copied into `deploy/`, and a
  site whose URLs end in a slash had to ship its own `next.config.ts`.
- `progressBar` can draw from a count and what is remaining (`remaining`), filled to count over the
  two added, for a source like a GitHub milestone that answers closed and open issues and no total.
  `total` wins when both are set, so a page that passes it draws what it drew before (#114).
- A site theme can draw the page itself. `createPage`, `createHome` and `createViewerPage` take
  `{ bare: true }` and render only the blocks, with no `main`, page padding, title or breadcrumbs,
  and the gap between blocks reads `--bp-gap` before the theme's `space.lg`. Both were inline
  styles, so a deployment porting an existing design had no way to take them off: every page kept a
  40px strip either side and 24px between sections that the design does not have.
- A link and a heading could still lay a page out wider than the phone it was read on. #101 gave
  `code` somewhere to break and gave `a` nothing, so a changelog entry citing a wiki page by its URL
  laid a 390px viewport out 603px wide; and the `text` primitive set no wrapping rule at all, so a
  package id in a heading laid the same site out 403px wide. Both measured on barakocms.com's
  rebuild. `anywhere` rather than `break-word`, because only `anywhere` counts in the intrinsic
  minimum a flex or grid parent measures, which is what sizes the cell.
- The image workflow can publish a tag that already exists. v0.7.0 was tagged before the workflow
  was written, so nothing ever pushed an image for it, and dispatching against the tag does not work
  because a dispatch runs the workflow file as it exists at that ref. Dispatching from master with
  `tag: v0.7.0` checks that tag out and builds it. A backfill does not move `latest`.
- The site can be deployed on a host that already runs barakoCMS and already terminates TLS.
  `compose.site.yml` brings up the site container alone on a loopback port, joined to the edge
  network the existing stack created, and `baryovm.site.json` is the BaryoVM manifest that syncs the
  source, builds it there and composes it up. The bundled `compose.yml` brings its own Caddy, which
  on such a host fights the proxy for 80 and 443 and takes the other sites down with it.
- A deployment whose identity is written at build time keeps its config and its root routes under
  `deploy/<name>/`, and the build lays them over the reference app when given
  `--build-arg PRESS_DEPLOY=<name>`. The reference app resolves identity per request: every page
  lives under `app/%5Fpress/[site]`, which only the proxy's rewrite reaches, and the rewrite only
  fires when the config sets `sites`. A site with no tenant to resolve to therefore answered 404 on
  every page while its feed and sitemap still worked. `deploy/press.baryo.dev/` is the first one.
- A collection that could not be read logged nothing. The visitor got "This page could not be
  loaded" and the operator got an empty log, so a prerender that failed because the CMS was
  unreachable looked like a CMS with no posts in it. The reason is logged now.
- `baryovm.release.json` synced everything the image needs except `press.config.ts`, so a full stack
  release built the site from whatever config happened to be on the VM. It is in the sync list now.
- The README documented one `baryovm stack add`, the full stack's. A reader deploying the site alone
  who followed it got Caddy started on a host that already has a proxy, because `--file` decides
  which compose file BaryoVM brings up and the snippet had none. The site-only registration is
  written out now.
- A `Text` role can be a `clamp()` of three lengths, not only one fixed length, so a tenant's type
  scale can be fluid the way the engine's own default page title and prose `h2` already are.
  Anything else is still refused (#100).
- A page composed of blocks can stop `PageView` drawing its `title` a second time above a block
  that already opens with its own heading. The page's own data decides now, through a `HideTitle`
  field the blueprint maps by default, rather than only a `showTitle` prop the route file sets
  (#102).
- A long unbroken token in running text, or a `pre` nested in a `stack` cell, laid a page out wider
  than a 390px phone: inline `code` had no wrapping rule, and `pre` and `table` lost their own
  `overflow-x` scroller to a flex ancestor that defaults to `min-width: auto`. Both are fixed in the
  prose stylesheet, and a browser check at 390px now guards every page the look fixtures hold, the
  same shape the tab strip check already uses (#101).

- A collection declaring `index: false` no longer reserves its route from a page, only from an item
  below it, which item pages are served at either way. barakocms.com's `/modules` and `/changelog`
  pages needed exactly this: a collection with no index of its own, drawn by a hand-composed page at
  its route (#103).
- `cardGrid` can link a card through a named field on the entry, `href`, falling back to the item's
  own route when the collection has one. A collection filled by a sync usually carries the source's
  own URL and has no route on this site, which is the shape `cardGrid` could not draw before (#104).
- `progressList` and `progressBar` can draw from a count and a total (`progressCount`,
  `progressTotal`) as well as from a figure already worked out, for a source like a GitHub milestone
  that answers two counts and no percentage. `progress` wins when both are set (#105).
- Delivery reads now carry `CMS_RENDERER_KEY` alongside `X-Tenant`, from the same place both are
  built. barakoCMS's global rate limiter reads the key on every request, not only on share link
  redemption, and partitions a request that carries it into the renderer's own bucket instead of the
  one bucket a container's IP would otherwise share with every visitor of every site it renders
  (#106).

## 0.7.0 (2026-09-21)

- Four things the block library v4 look check said it could not draw yet, measured against the
  baryo.dev fixture (#83, #91). A `cardGrid` card can carry a colour of its own: `{{item.Color}}`,
  the same tone `OptionStyle` (#52) already resolves for an option, now reaches a badge behind the
  card's icon instead of only a word in the theme's accent, and `cardGrid` can also draw `card`s
  typed in place, with no `collection`, for a page author's own package list or feed. `section` and
  every block that takes a `tone` gained `wash`, a radial gradient from the theme's own page and
  accent tint colours, declared rather than hand-written. `codeTabs` draws a real strip of tabs
  now, `tabGroup` and `tabPanel`, a radio and its label standing in for the tab and a `:checked`
  selector standing in for the script, since a first version built on `<details>` broke past two
  tabs (see the pull request for what and why) and this one is measured at four. `disclosure` stays
  what `tabs` and `faq` use. Measured against the fixture: 48.863% different at 1280px and 59.434%
  at 390px before, 30.595% and 35.741% after. The mascot, the bio panel, the sticky translucent
  header and the richer "Four products" cards are not blocks yet; the gap that is left is written
  down in the pull request rather than closed by guessing at a shape nobody asked for.
- A page over its block budget says so, once, instead of rendering short with nothing said (#90).
  Raising the limit from a hundred to four hundred (#83) bought room; it did not make going over it
  visible, which is how baryo.dev's eighth band went missing with a 200 and no error. `resolveBlocks`
  still renders everything that fits, so a static export still builds, and warns once through the
  same `sayOnce` shape the sitemap and the font allow list already use.
- The blocks barakocms.com adds. `comparisonTable` draws a real table from rows typed as lines with
  `|` between the cells, headings on both the columns and the rows, so a cell is announced with the
  option it belongs to. `progressBar` is `role="progressbar"` with the three values that role needs,
  which is what a roadmap needs to be read and not only seen, and it reads its figure through a new
  `progress` field role so the tenant says which of its own fields holds the number. `stickyBar` is
  the announcement band, and `announcement` is the preset over it. `codeTabs` draws the snippet a
  quickstart is for and puts the other ways of running it in `codeTab`s sharing a group (a tab strip
  as of #91; disclosures until then). `progressList` and `changelogList` read a collection, and a
  changelog is grouped by kind with `filterField` and `filterValue`, one band per kind, because a
  block that grouped by itself would
  have to know which field holds the kind and that is the tenant's field name. `faq` and `faqItem`
  are questions that all open at once, which is the whole difference from `tabs`. A card grid's new
  `option` prop marks each card with the glyph and the word the site declared for that entry's
  option, which with a category filter is the module grid; it is off unless a grid asks for it, so
  every existing card grid draws what it drew. (#24)
- A site's approved design is a fixture now, and the look check compares against that rather than
  against whatever the live site deployed this morning. `npm run look:capture` reads a page with the
  same determinism the check uses and writes one self-contained file: stylesheets inlined, fonts and
  images as data URIs, every script and fetch hint taken out. `npm run look:site` serves the same
  page assembled from blocks, through the real renderer against a stand-in CMS holding the site's
  settings, and runs the pair list over the two. baryo.dev is the first site through it. Its capture
  matches the live site at 0.000% at both widths, and running the rebuild against it found a four
  column band that scrolled a phone sideways and a page that lost its last band without a word. Both
  are fixed below. What is left is a rebuild that differs by 48.9% at 1280px and 59.4% at 390px,
  which is the real state of it: the block library has no answer yet for the mascot, the package
  family grid, the feed or the terminal's tab strip. (#83)
- A flow wraps on a phone instead of scrolling it sideways. Its track list was fixed at the column
  count with the column floor under each track, and four floors and three gaps do not fit in 390px,
  so a four column stat band made a page 1144px wide. The tracks are a share of the row now, with
  the floor still under them, and as many fit as the row can hold: the column count on a desktop,
  fewer on a phone. (#83)
- A sticky bar sticks. `BlockList` wraps every block in a div that is exactly as tall as what it
  holds, and a `position: sticky` element can only move inside its own containing block, so the band
  scrolled away with the page: its top went from 0 to -400 after a 400px scroll, measured. A block
  definition may now ask for that wrapper to be `display: contents`, and `stickyBar` is the one that
  does. Nothing else in the library asks, so nothing else moves. (#24)
- A flow asked for no gap keeps its columns. `space.none` is "0", which is a number and not a
  length, so `100% - 2 * 0` was a type error that took the whole track list with it and left every
  cell in one column with nothing said. (#83)
- A page may hold four hundred blocks rather than a hundred. A band from the library is a preset
  that expands into eight or ten, and the binder spends the budget on everything it walks through as
  well as everything that comes out, so a page of eight bands ran out on the seventh and rendered as
  though that were the page. The reads a page may make and the length of a binding are bounded
  separately, so this buys more substitution over short strings and nothing else. Going over is still
  silent. (#83)
- Docs are a configured collection with a tree, not a Next app of their own. A collection's `tree`
  names four fields on the tenant's own type: the section a page sits under, where it comes in the
  order, the page it hangs under, and the product it documents. The section order and the products
  the switcher offers are settings beside them, so what used to be a hand-kept manifest in a site
  repository is content an editor changes in barakoBrew. An item page in such a collection draws the
  sidebar with the page being read marked, the product switcher, a search box, previous and next from
  the tree's reading order, and a link to wherever the page is written, built from `tree.editBase` and
  the item's own source path. The same three are blocks as well, `docsSidebar`, `docsSwitcher` and
  `search`, over one implementation, because a landing page needs them with no item and an item page
  needs them with no blocks. Search goes through barakoCMS's own `/api/public/{type}/search`, which
  matches only over the fields a type publishes, so a draft or a field held back from public delivery
  can never surface as a hit; `createCollectionIndex(config, key, { search: true })` answers `?q=` the
  same way. The box is drawn where `tree.searchPath` names a route that reads the query and nowhere
  else, since only the site knows which of its routes does and one pointing elsewhere is a control
  that looks like it works. The box is a form and the results are links, so a reader with no script
  gets a working search, and the keyboard handling on top of it is the package's first client component. Old paths
  move through the redirects feature the catch-all already asks. (#23)
- The generic item view renders an article, and the blog's post exports are wrappers over it. A
  reading column, a byline, a read time and a band of neighbours are what long-form content wants
  rather than what a blog wants, so a collection asks for them with `layout: "article"` and a law
  firm's briefings get the page the blog has always had. `PostView` produces every byte of that markup
  through the shared layout, and `test/blog-wrappers.golden.json` still passes byte for byte, which is
  the whole claim. `Post`, `PostView`, `createArchive`, `listPostsBy` and `listRelated` are
  `@deprecated` naming what to use instead and are removed no earlier than 1.0.0, since they shipped
  one release ago. What changed underneath is that `toPost`, `listPosts`, `getPost`, `getPostPreview`,
  `listPostsBy`, `getTerm` and `listTerms` read the post collection's own field map, so a tenant that
  replaced `post` in its settings gets its own names where it used to get the image's. What stays
  blog-shaped on purpose is the three composition slots on `PostView`, which exist for a consumer
  assembling its own post page. (#75)
- A block that reads the site is rebound to the config a request resolved as itself. Every one of them
  used to be replaced with a freshly built `collection` block, whatever it was, so a page holding a
  docs sidebar would have rendered a list of documents where the sidebar belonged. (#23)

- A collection with more entries than the API hands back in one page is in the sitemap whole. The
  route asked for `pageSizes.sitemap` entries, a thousand by default, and barakoCMS answers a public
  list with at most a hundred and no error, so everything past the hundredth was missing from a file
  that was valid XML served with a 200 and nothing anywhere said so. The collection is read a page at
  a time now, at the size the API answered with rather than one this side guessed, and
  `pageSizes.sitemap` reads as what it says: the most entries one collection puts in the file. The
  file itself stops at 50,000 URLs, which is the sitemap standard's limit for one file, because past
  that the standard's own answer is several files behind an index and building those belongs to the
  consumer's route file with Next's `generateSitemaps`. Both the clamp and the stop are said once in
  the log rather than absorbed, since a count a tenant set and a count the API permits disagreeing is
  a thing somebody fixes once. `listAllCollection` is the paging read, for a consumer that wants the
  same guarantee somewhere else. (#72)
- Related items, a read time and a photo are settings a collection carries, not things only posts
  get. `related: "semantic"` puts an agency's nearest case studies under a case study the way the
  post page has always had its band, `related: false` lists nothing, and unset still lists whatever
  references the collection, which is what every collection did before. `readingTime: true` shows a
  read time worked out from the body, so there is no field for an editor to keep in step with the
  prose. A `photo` field role draws a portrait on the item page, and `getTerm` reads name, body,
  website and photo through the collection's field map instead of the four names it had compiled in,
  so a school whose teachers keep their portrait in `Portrait` gets it. All three are a tenant's to
  set on `Collections`. A collection that sets none of them renders exactly as it did. (#45)
- An option of a choice field carries a style, not just a colour. `OptionStyles`, keyed by
  `type.field` and then by option, gives each one a tone, an icon and the word a visitor reads in
  place of the option's own value, so a clinic can put an icon on each department and a school a
  short badge on each grade level without another setting shaped exactly like the last one. The
  cards, the item pages and the collection block draw all three; the option's stored value stays on
  the element as `data-option`. `OptionColors` still works and means an option whose style is a tone
  and nothing else, so a tenant that saved colours keeps exactly the border it had. (#52)
- A tenant picks its home page. `HomePath` names a page, the way `HoldingPath` does, and
  `HomeCollection` names a collection whose index stands at the root; `createHome` serves whichever
  it is and the post index when it is neither, so a site that says nothing renders what it always
  did. Nothing served at the named path falls back to the index rather than 404ing the front page.
  The blog's `post`, `author` and `category` are ordinary `Collections` entries now, so a school
  whose news lives in `article` with a `Headline` replaces `post` in its settings and gets its list
  and its item pages from that entry; the post page reads the collection's own field map when a
  tenant has done that. The RSS link in the built-in header and the feed alternate in the metadata
  appear only when some collection has `feed` on, so a clinic with no posts stops advertising an
  empty feed. **A request-time site's root route becomes `createHome(config, blocks)` with
  `createHomeMetadata(config)`; `createBlogIndex` still mounts the post index for a site that wants
  exactly that.** (#44)
- The words a visitor reads are the tenant's. `Labels` on the site settings holds them, key by key:
  "min read", "by", "Related", "Featured", "Back", "Untitled", the RSS link, the preview banner, the
  two notices an index shows and the line the holding page shows after a share link that did not
  open. A school setting `Locale` to `fil-PH` got Filipino dates beside English copy, and a tenant
  that wanted "Read more" instead of "Back" had to fork the screen. A key left out keeps the English,
  so a tenant that sets nothing reads as it did, and a build-time site passes `labels` to
  `defineConfig`. A test reads the screens and fails on English written back into one. (#47)
- The theme's colour slots say what a colour is for. `inverse`, `inverseChrome`, `inverseInk`,
  `inverseAccent`, `code` and `accentBorderStrong` replace `darkPanel`, `darkPanelChrome`,
  `darkPanelInk`, `darkPanelAccent`, `codeGreen` and `accentTintBorderStrong`, which were
  barakocms.com's design read back as a palette: a bakery with a cream footer had to put cream in a
  slot called `darkPanel`, and a school with no code sample still set `codeGreen`. Both names work
  and stay equal, whichever one a tenant saved or a consumer's component reads, so nothing has to be
  re-saved; the old six are deprecated and go in 2.0.0. The blocks take their sizes from the theme
  too: a block heading is `Text.title` and a block's padding and gaps are names on the spacing scale,
  where they were 26px and 32px written into the block, so a tenant with a larger type scale gets
  larger block headings. A page title is `Text.pageTitle`. A tenant that sets nothing renders exactly
  as it did. (#49)
- The related band reads the post collection, not the blueprint's type. A tenant that replaced
  `post` in its settings still had its similarity search sent to `types.post`, so the band rendered,
  and rendered another collection's neighbours. Both reads go through the collection now, the search
  and the second read that fills in the date and the blurb, so the cards are the tenant's own entries
  under the names the tenant gave them. A site that did not replace `post` sends exactly the requests
  it sent before. (#78)
- An editor can see why a binding did not resolve. The three reasons were already worked out where
  a page binds, and they went to the server log, so the person who could read them was never the
  person who typed the binding: the page rendered with the placeholder left as typed, or the block
  quietly dropped, and nothing said why. `createBindingReportRoute(config, blocks)` answers for one
  page and one tenant, and each problem names the binding as typed, the reason, and the block and
  the field it came from, so barakoBrew marks the field rather than printing a list. It reports the
  page as rendered rather than as stored, which is what catches an `{{item.X}}` outside a repeat as
  well as a typo, and it takes the page route's own `query` option so a `{{query.X}}` is reported as
  unbound wherever the visitor's page leaves it unbound. A report names field paths, so it is never anonymous: the caller presents the
  tenant's own key, derived from `PRESS_SECRET` under its own purpose label and printed by
  `barakopress bindings-key <tenant>`, and the answer is never cached. (#63)
- Motion in the block library, and none of it in JavaScript. `reveal` lifts its content in as it
  scrolls into view, `rotatingText` turns a comma separated list of words one at a time,
  `typingTerminal` types its lines in sequence and holds and loops, `codeSample` shows a snippet with
  its language and one click to select the whole of it, `text` takes `motion: "countUp"` to count a
  plain figure up, and `flow` takes `hueRotate` to turn each cell's hue through the theme's own
  colours in a cycle of three, which is what a card grid of featured work wanted. `section` takes a
  `gradient` tone, the inverse band with the theme's three dark roles spread across it. Every one of
  them is drawn in its finished state first and the animation only takes it away and puts it back, so
  a page with JavaScript off renders the terminal typed out and the figure at its number, and every
  animation sits inside `prefers-reduced-motion: no-preference`, so a visitor who asked for less
  motion gets the same finished page. "When it comes into view" is `animation-timeline: view()`, and
  a browser without that shows the finished state too. What a block animates is presentation and
  never the only copy of what it says: the rotating stack and the covered figure are `aria-hidden`
  and each carries one plain copy off screen, so a reader is read one word and one number rather than
  every word at once or nothing at all. Two tests hold both rules, one stripping the motion guards
  out of every stylesheet these emit and one stripping every `aria-hidden` subtree out of the
  markup. (#22)
- A publish drops what changed, not the whole tenant. Every read carried one tag per tenant, so
  correcting one typo on a school with a thousand news posts re-rendered all thousand. A read carries
  a narrower tag beside the tenant's now: the entry's when it read one entry, the type's when it read
  a list, a search, the site settings or the page tree. barakoCMS names the content type and sends
  the entry's public data with every delivery, and the site's own config says which field of that
  type holds a slug, so a delivery drops that type's tag and that entry's tag and leaves every other
  entry of the type cached. A delivery that names no type, or one the site renders nothing of, drops
  the tenant's tag exactly as every delivery did before. A response barakoCMS marks
  `Cache-Control: no-store` is not cached either: the class is remembered against the path and every
  later read of it asks uncached, which is what lets a type that has to be fresh to the minute live
  beside pages cached for hours. A positive `max-age` is deliberately not read as a lifetime, since
  the API answers every public read with a flat sixty seconds today and taking that as a per-read
  class would cut every site's window to it. (#56)
- The state two containers have to agree on can be shared. The kept answers, the marker beside them,
  the host to tenant map and the webhook replay guard were each a map in one process, so an agency
  running two replicas served a corrected notice from one and the old one from the other for up to
  five minutes, and a replayed delivery was honoured once per container instead of once. They go
  through a `store` on the config now: three methods over whatever the deployment already runs, and
  in process and bounded when it sets none, which is what a single container always did. A purge one
  container receives reaches the rest because an honoured delivery writes a generation against each
  tag it dropped, and a read carries the newest generation of its tags in the URL it asks the CMS
  for, so a container that was never told is asking for something it has never cached. Next's own
  data cache stays per container; what crosses is the knowledge that it is out of date. (#57)
- The share page says the tenant's words. `createSharePage(config)` takes the config and resolves the
  site per request, so its title, its line for a visitor with no JavaScript and the line it shows
  while the link opens come from `Labels` like every other visitor-facing string, and the page is
  tagged with the tenant's own language. A Tagalog site that set every label it was offered was still
  showing three English lines to the visitor who follows a share link, which is the visitor most
  likely to be a client being shown their own site. A host that belongs to no tenant is a 404; a CMS
  that cannot be reached still opens the link, in the words the config file carries. The label scan
  test reads the share route the way it reads the screens. A consumer mounting this route passes
  its config now, so `app/_share/route.ts` changes from `createSharePage()` to
  `createSharePage(config)`, and the route resolves a tenant per request rather than being
  static. (#77)

## 0.4.0 (2026-09-20)

- Two build-time keys are a tenant's to set. `PageSizes` gives a site its own index, feed, sitemap
  and archive counts, so a bakery listing 50 products and an agency listing 9 case studies run the
  same image instead of one of them needing a build; a key the entry leaves out keeps the configured
  count, and a collection's own `pageSize` still wins. `ReservedSlugs` adds to the reserved first
  segments, which is how a tenant keeps a path its proxy answers out of the menu and the sitemap. It
  only ever adds: the configured list is the app's own routes, and a page freed onto one of those
  would sit behind a route file and render nowhere. The pages mount stays operator-only, because
  Next resolves the catch-all by where its file sits and no setting can move a file. A tenant that
  sets neither renders exactly as it did. (#53)
- A request-time site no longer renders every page for every visitor. Resolving the tenant meant
  reading the request host, reading a header makes a route dynamic, and Next never keeps a dynamic
  route, so one container serving many domains re-rendered every page on every view with every read
  under it already cached. A `proxy.ts` resolves the tenant and the share session once and rewrites
  to `/_press/<tenant>~<gate>~<host>/<path>`; the pages read all three out of that segment and read
  nothing from the request. The tenant is in the path and the path is the whole of Next's key, so two
  tenants cannot share an entry and a request carrying a share session cannot be answered from one
  made without it. A path that arrives under `/_press` from outside is a 404. `revalidateTag` drops a
  tenant's renders with its reads, so the webhook that purged one now purges both. Measured on the
  reference app against the stand-in CMS: 19ms a view before, 9ms after, with no CMS read either way.
  **A request-time site moves its page routes under `app/%5Fpress/[site]/` and adds `proxy.ts`; see
  the README.** A build-time site changes nothing. Routes that read `?preview=` or bind `{{query.X}}`
  stay dynamic on purpose, and which routes are kept is the consumer's call in the consumer's route
  file, the same as `revalidate`. (#55)
- `createPage` takes `{ query: true }` for a page that binds `{{query.X}}`. On a route Next keeps,
  the query is not handed to the blocks at all, so the binding is reported as an unbound scope and
  renders as nothing rather than failing the route. (#55)
- `registryFor` binds the blocks that read the site to the config the request resolved, and takes
  `{ holding: true }` for a holding page. The `collection` block used to resolve the request itself,
  once per block per view, which kept every page holding one out of the render cache. A site that
  registered its own `collection` keeps its own. A consumer rendering `PageView` with a registry that
  never went through `registryFor` now gets a loud error on a request-time site instead of a read
  that resolved itself. (#55)
- Fonts from somewhere other than Google Fonts. A `Fonts` entry may name the stylesheet that loads a
  face, `{ "family": "Zilla Slab", "url": "https://type.school.example/zilla.css" }`, which is how a
  school with a licensed face on its own host or a tenant that must not send visitor addresses to a
  third party gets its type. The URL is a tenant's setting on its way into a `<link>` in every
  visitor's page, so the deployment decides which origins may appear there: `PRESS_FONT_ORIGINS`,
  read per request, `https://fonts.googleapis.com` alone when unset. Anything else is refused, the
  role falls back to its family name, and the log says so once. An operator who leaves Google Fonts
  out of the list stops every link to it, the built-in one and its preconnects included, and no
  setting can put one back. A family name on its own renders the Google Fonts link it always did.
  (#54)
- An asset can be used exactly as supplied. `AssetsAsSupplied` lists the marks a site must not
  restyle, `LogoAsSupplied` says it of the logo and the footer logo, and each carries a minimum clear
  space from the spacing scale. A marked asset is drawn from the file with that space held around it,
  and no tint, border, corner, shadow, filter or crop reaches it: a block that asked for a frame draws
  the mark alone. It holds in the header, the footer, the holding page, a region, a page block, a
  preset, a post cover, a collection item and an image inside markdown, because every image the engine
  draws now goes through one component and a test walks all of them. An `image` block can mark its own
  file with `asSupplied` and `clearSpace`. A site that marks nothing renders exactly as it did. (#29)
- One reader for every environment value, `readEnv` in `src/env.ts`, called where the value is used.
  `CMS_URL` and `CMS_TENANT` were read inside `defineConfig`, which runs when a site's
  `press.config.ts` is first imported, while `CMS_DEFAULT_TENANT`, `CMS_RENDERER_KEY`,
  `PRESS_CONSOLE_ORIGINS` and the secrets were read per request. When a variable was read depended on
  which variable it was. Nothing outside `src/env.ts` names `process.env` now, and a test fails if
  that changes. Variable names, defaults and precedence are unchanged. (#51)
- Redeeming a share link is bounded by `cmsTimeoutMs`, like every other call to the CMS, instead of a
  fixed five seconds. An operator who lowers the timeout for a site on a slow network meant that call
  too. The default is still 5000ms, so a site that leaves `cmsTimeoutMs` alone behaves as it did.
  (#51)
- A block library every site gets: `hero`, `band`, `statBand`, `cardGrid`, `peopleGrid`, `timeline`,
  `steps`, `tiers`, `keyValueTable`, `tabs`, `map`, and the parts that go in their slots (`stat`,
  `timelineEntry`, `step`, `tier`, `person`, `keyValueRow`). Every one is a preset compiled from the
  primitives rather than code, so a tenant that wants one to look different saves its own under that
  name and that one wins. Three new primitives carry them: `flow` lays a single list out as cells
  instead of stacking it, which is what a `repeat` and a preset's slot produce, `panel` is a card
  with a tone and a frame, and `disclosure` is a labelled section that opens. (#21)
- A band's tone reaches the blocks inside it. A `section` or a `panel` publishes its ink, accent and
  hairline, and `text`, `icon`, `list`, `button` and `link` read those instead of the page's, so a
  heading on an inverse band is no longer dark ink on a dark panel. (#21, toward #49)
- A page may nest blocks eight lists deep instead of four. The hundred-block budget is what bounds
  the work, and four was not enough for a card grid: a band, a source, a flow, a repeat, a card and
  the stack inside it is six before any content. (#21)
- The header and the footer are block regions. `HeaderPath` and `FooterPath` name a page whose blocks
  are drawn there, `HeaderTone` and `FooterTone` the tone behind it, so a clinic gets a light footer
  with opening hours and a map and a school an enrolment banner with a button, with no barakoPress
  release. A site that sets neither renders the built-in header, top bar and footer from `TopBar`,
  `HeaderLinks`, `FooterColumns` and `SocialLinks`, with the markup it always had, and so does one
  whose region path has nothing served at it. A region page is chrome, so it is left out of the menu
  and the sitemap. (#48)
- Blocks in four layers: layout and content primitives that take theme tokens only, presets a tenant
  saves as data, and bindings. Any string prop can hold `{{site.Name}}`, `{{item.Fee | money}}` or
  `{{query.class ?? all}}`, resolved on the server as the request's tenant; `source`, `repeat`,
  `pager` and `showIf` load, list, page and choose. The five block types stored pages already hold
  render unchanged. The block schema `app/api/blocks` publishes is now version 2: it adds each
  block's layer, each field's `bindable`, and the scopes and formats a binding may name. (#33)
- The theme carries a spacing scale (`space`) and a type scale (`text`), settable per tenant through
  the `Space` and `Text` site settings, and `layout.columnMin` is where a row or a grid wraps. Block
  primitives read these instead of pixel values. (#33, toward #49)
- New site settings: `Presets` (a tenant's named blocks), `Currency` (what the `money` format uses)
  and `EmbedHosts` (which hosts an `embed` block may frame). A preset setting that is not read says
  why once in the server log, one line per reason: an entry that is not a preset, a type that is not
  a name or that an earlier preset already uses, fields that are not a list or are not fields, a name
  a registered block already has, and the ones past the block budget. (#33)
- A look check: a reusable Playwright job that screenshots a reference and the rebuilt page at 390px and 1280px, compares them against a per page threshold, and uploads the reference, the rebuilt screenshot and the diff on failure. The page list is data the site owns, not code here. `npm run look:selftest` runs it green and red, and CI runs that. (#27)
- One `PRESS_SECRET` keys every tenant's webhook key and every share session, with one rule of at least 32 characters. `REVALIDATE_SECRET` and `PRESS_PREVIEW_SECRET` are read only while it is unset, and every key derives byte for byte as before, so keys already in tenants' workflows keep verifying. A `REVALIDATE_SECRET` shorter than 32 characters logs a warning rather than refusing, until 1.0.0. (#50)
- A `HoldingMessage` site setting is the line the default holding page shows under the name and tagline, in place of the fixed "Coming soon.". Unset shows no line. (#46)
