# Changelog

## 0.4.0 (unreleased)

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
- One `PRESS_SECRET` keys every tenant's webhook key and every share session, with one rule of at least 32 characters. `REVALIDATE_SECRET` and `PRESS_PREVIEW_SECRET` are read only while it is unset, and every key derives byte for byte as before, so keys already in tenants' workflows keep verifying. A `REVALIDATE_SECRET` shorter than 32 characters logs a warning rather than refusing, until 1.0.0. (#50)
- A `HoldingMessage` site setting is the line the default holding page shows under the name and tagline, in place of the fixed "Coming soon.". Unset shows no line. (#46)
