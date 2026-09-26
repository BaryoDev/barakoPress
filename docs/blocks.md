# Presets, the block library and plugins

## Presets

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

## The block library

Every site gets these, compiled in from the primitives. None of them is code, so a site that wants
one to look different saves its own under the same name and that one wins.

| Block | What it is | Props |
| --- | --- | --- |
| `hero` | The band at the head of a page | heading, body, image, imageAlt, primaryLabel, primaryHref, secondaryLabel, secondaryHref, tone, columns, align, padding |
| `band` | Copy with one call to action | tone, heading, body, label, href, align, padding, width |
| `statBand` | A row of figures | heading, tone, columns, padding, items |
| `cardGrid` | Cards from a collection, typed in place, or both | heading, collection, filterField, filterValue, empty, tone, columns, padding, hueRotate, option, items |
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
| `card` | One card typed in place | title, tag, body, meta, icon, tint, linkLabel, href, image, imageAlt |

The blocks in the second half go in the first half's slots: stats in a `statBand`, entries in a
`timeline`, `disclosure` blocks in `tabs`, `codeTab` blocks in `codeTabs`, `faqItem` blocks in
`faq`, and `card` blocks in a `cardGrid`'s `items`, after any cards its collection draws. A
`card`'s `tint` is a colour written out, and it colours the icon. A card grid reads its entries
through `{{item.Title}}`, `{{item.Summary}}`,
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
the division. It needs a total: there is no field role for what is left, so a source that counts
closed and open issues, as a GitHub milestone does, needs a field holding the total before
`progressList` can draw it. Mapping the open count to `progressTotal` draws the wrong bar. A
`progressBar` placed on its own takes `remaining` in place of `total`. `changelogList` does not group by itself, because grouping means knowing which field holds
the kind and that is the tenant's field name. One band per kind with `filterField` and `filterValue`
is the grouping, and the chip on each entry is the option's own word.

## Plugin packages

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
and next to it the commit it points at, since a tag can be moved; building from `#<commit>` is the
strict form. `v0.8.0` is `db77cfafd126db575bd9f73b0584c99ba815b7c8`. The tags are annotated, so
`git ls-remote https://github.com/BaryoDev/barakoPress.git 'v0.8.0^{}'` is what prints the commit;
without the `^{}` it prints the tag object. Moving the pin is an engine upgrade, and a plugin should
be rebuilt and checked against it.

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
