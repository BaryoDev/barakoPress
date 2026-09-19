# Changelog

## 0.4.0 (unreleased)

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
  and `EmbedHosts` (which hosts an `embed` block may frame). (#33)
- One `PRESS_SECRET` keys every tenant's webhook key and every share session, with one rule of at least 32 characters. `REVALIDATE_SECRET` and `PRESS_PREVIEW_SECRET` are read only while it is unset, and every key derives byte for byte as before, so keys already in tenants' workflows keep verifying. A `REVALIDATE_SECRET` shorter than 32 characters logs a warning rather than refusing, until 1.0.0. (#50)
- A `HoldingMessage` site setting is the line the default holding page shows under the name and tagline, in place of the fixed "Coming soon.". Unset shows no line. (#46)
