# Changelog

## 0.6.0 (unreleased)

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
