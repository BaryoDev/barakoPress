# The look

## The look is configuration too

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

Each group merges over the defaults on its own, so setting one colour keeps the other eighteen. The
groups are `colors` (19 role slots, plus six older names kept in step with them until 2.0.0), `fonts`
(`heading`, `body`, `mono`), `radii` (`panel`, `control`, `pill`), `layout` (`prose`, `wide`,
`gutter`, `columnMin`), `space` and `text`. The theme also carries `fontSources`, `asSupplied`,
`tokens`, `tones` and `recipes`, covered below. `DEFAULT_THEME` is exported if you want to read the
values or build a palette from them.

Loading the faces is the site's job, not the engine's. The default theme names Sora, Manrope and
JetBrains Mono with real fallback stacks, and a `<link>` in your root layout is what makes them
arrive. `createSiteLayout` writes that link for you: a family name from Google Fonts, or the
stylesheet named in `theme.fontSources` when the face is not loaded from there, held to
`PRESS_FONT_ORIGINS` either way.

**Three slots**, for what belongs to the site rather than the engine:

```tsx
// headerBackdrop: decoration behind the header band
// beforeBody: a wide band under the header
// afterBody: the foot of the reading column
<PostView
  config={config}
  post={post}
  headerBackdrop={<Bean />}
  beforeBody={<RoleStrip />}
  afterBody={<Newsletter />}
/>
```

They are not a way to compose a post out of arbitrary sections. Anything that has to sit between two
paragraphs belongs in blocks (see [Pages built from blocks](pages.md#pages-built-from-blocks)), because only
the body knows where it goes. `PostView` is `@deprecated` since 0.7.0. `ArticleView`, what `ItemView`
draws for a collection with `layout: "article"`, takes the same three slots.

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

## Tokens and tones

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

## Style recipes

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
  That holds for an inline element too. A `link` or a `span` text wearing `display: inline-block`
  in a list, which is a column, is that column's flex item and is stretched to its width like any
  other; without a recipe it sits inside a block wrapper at its own width. A recipe that wants its
  own width says so: `align-self: flex-start`, or `width: fit-content`.
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

## Inline marks in a text block

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

## Assets used exactly as supplied

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
