# Changelog

## 0.4.0 (unreleased)

- One reader for every environment value, `readEnv` in `src/env.ts`, called where the value is used.
  `CMS_URL` and `CMS_TENANT` were read inside `defineConfig`, which runs when a site's
  `press.config.ts` is first imported, while `CMS_DEFAULT_TENANT`, `CMS_RENDERER_KEY`,
  `PRESS_CONSOLE_ORIGINS` and the secrets were read per request. When a variable was read depended on
  which variable it was. Nothing outside `src/env.ts` names `process.env` now, and a test fails if
  that changes. Variable names, defaults and precedence are unchanged, and `cmsUrlFor(config)` and
  `pinnedTenant(config)` are exported so a middleware or a hand-written route can ask where the CMS
  is and which tenant the process is pinned to without reading a variable itself. (#51)
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
