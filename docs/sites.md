# Sites and the header

## One build, many sites

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
path, and what is cached and what is not, is [The render cache](caching.md#the-render-cache). A build-time
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
`Radii`, `Layout`, `Space` and `Text` (the spacing and type scales), `Tokens` and `Tones` (see [Tokens and tones](look.md#tokens-and-tones)), `StyleRecipes` (see [Style recipes](look.md#style-recipes)), `TopBar`, `HeaderLinks`, `MenuLinks`, `HeaderActions`, `FooterColumns`, `SocialLinks`, `HeaderPath`,
`HeaderTone`, `FooterPath`, `FooterTone`, `AssetsAsSupplied`, `LogoAsSupplied`, `LogoClearSpace`,
`PageSizes`, `ReservedSlugs`, `Labels`, `HomePath`, `HomeCollection`, `Currency`, `EmbedHosts`,
`Presets`, `Plugins` (see [Plugin packages](blocks.md#plugin-packages)), and `Mode`, `HoldingPath` and
`HoldingMessage` (see Holding mode below). `Collections`, `OptionStyles` and `OptionColors` are read as [Collections](collections.md)
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
| `shareTitle` | `Opening a share link`: the title of the page a share link lands on |
| `shareNoScript` | What that page says to a browser that runs no script |
| `shareOpening` | `Opening the site.`: what it shows while the link is redeemed |
| `search` | `Search`: the label and placeholder on the search box |
| `searchEmpty` | `Nothing matches that.`: a search that matched nothing. A tree's search box puts what was typed in place of `{query}` |
| `previous`, `next` | `Previous`, `Next`: a tree page's links along the reading order |
| `editPage` | `Edit this page`: the link to where a tree page is written |
| `contents` | `Contents`: the collapsed tree sidebar on a phone |
| `products` | `Products`: the label on a tree's product switcher |
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

## The built-in header

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
[One key per tenant](caching.md#one-key-per-tenant)). A publish on one tenant leaves every other tenant's cached
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
| `PRESS_SECRET` | The HMAC key, at least 32 characters, for example `openssl rand -base64 48`. Read per request. Unset or shorter, no session is issued or accepted and everyone gets the holding page. Every instance behind one domain needs the same value. `PRESS_PREVIEW_SECRET` is read in its place when `PRESS_SECRET` is unset. See [One secret](caching.md#one-secret) |
| `CMS_RENDERER_KEY` | Optional. Sent to barakoCMS as `X-Barako-Renderer-Key` when a link is redeemed, and on every delivery read when the CMS URL is https or loopback, and must match the renderer key barakoCMS is configured with. Read per request and never logged. Unset, no key header is sent |

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
