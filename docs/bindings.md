# Bindings

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
rather than one, and are described with `source` below. `viewer` is the signed-in viewer on a `createViewerPage` route, described in pages.md. Formats are `text`, `date`, `datetime`, `time`, `money`, `number`, `upper` and
`lower`; `money` uses the tenant's `Currency` setting, or a plain amount when it has none.

Paths, formats and fallbacks only. There are no expressions and no JavaScript. Everything resolves
on the server as the request's tenant, before a component is called, so a binding never makes the
browser call the API. A placeholder that finds no value renders its fallback and is reported in the
server log, never a crash. What a binding resolves to is checked against the field again, so a link
whose stored field holds `javascript:` drops the block; and a resolved value is never rescanned, so
one field cannot reach another through its own contents.

A `query` value is typed by whoever sent the link, so where it lands in markdown (a `richText`'s
`markdown`, or a `text` block's `value` with `format: "inline"`) it is drawn as exactly the
characters that were sent, in running text, a code span or a code block alike:
`[x](https://elsewhere.example)` stays those words, not a link, and a value is never used as a
link's or an image's destination. Marks the editor wrote around the placeholder still apply. This
holds through a preset too: a value any of a preset's props carries into markdown inside it, as
`faqItem` does with its answer, is drawn the same way. A plain text field gets the value as it was
sent, since nothing there reads marks.

A file field or an inline image field (barakoCMS 4.6) is an object, so a placeholder names its
member: `{{item.Cover.url}}` and `{{item.Cover.alt}}`. An image block's `src`, and the `image` and
`photo` props of the presets that draw one, take an inline image's `data:image/...` URI; no other
url prop does. A reference field holding a list reads as the list of resolved entries, each with
`name` and `slug`, and `{{item.Image}}` and `{{item.ImageAlt}}` give the mapped image whichever
shape it was stored in.

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

A source or a `{{count.<collection>}}` past those eight reads is not read and draws nothing. The server
log says so once, naming the collection and the limit, and the page still renders. A source over a
collection the site does not have is logged the same way. Blocks nested more than ten levels deep
(`MAX_DEPTH`) are dropped, and the log says how many.

`mode: "all"` is for a page that is the whole of a collection rather than a page of it, a changelog
say: the source reads every row, fifty to a request, up to 500 (`MAX_ALL_ROWS`). Its first request
is one of the page's eight reads, and the rest are made at once, out of 16 more a page's `all`
sources share between them (`MAX_ALL_REQUESTS`). A source past 500 rows, or past what the requests
cover, reads what it can and says so in the server log, and `{{count}}` stays what the collection
holds. A `pager` inside it draws nothing, and sums, distinct counts, groups and a filter bar cover
every row it read. A `repeat` draws every row its source read unless its `limit` names fewer. What
the rows of a repeat and the groups of a grouped source draw spends a budget of its own, 10,000
blocks (`MAX_ROW_BLOCKS`), rather than the page's 400, so a long list neither takes the blocks after
it off the page nor renders without end; rows or groups past it are left out and the log says how
many were drawn.

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
`{{sum.Open ?? 0}}` where zero is the right answer. A sum covers the rows read: fifty at most in
`list` mode, where a source that pages sums the page it is on, and up to 500 in `all` mode.

`{{distinct.<Field>}}` is how many different values that field holds among the same rows: the
repositories a list of issues spans, "16 issues across 3 repositories". Values compare as the text a
placeholder prints, each entry of a list field counts on its own, and a row with nothing in the field
adds nothing, so a field no row holds renders its fallback. Inside a group it counts that group's rows.
It counts only what the source read, so a source that matched more rows than it read (a page of a
longer list) has no distinct counts and renders the fallback: `{{distinct.Repo ?? several}}`. It
reads a top-level field; a dotted path such as `Owner.Login` renders the fallback.

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

**Data table.** A `dataTable` draws one page of a public collection as a table, with no `source`
around it. `columns` is a list of `{ field, label, format }` (up to twelve; `format` is one of the
binding formats, and a list field prints its entries joined by commas). `pageSize` defaults to 20 and
is at most fifty. The page number comes from the URL parameter `pageParam` (`page` unless set), and
the block draws previous and next links, so a page two is a different URL and nothing in the browser
calls the API. `rowLink` is a site path such as `/students/{slug}`; `{slug}` and `{id}` are filled in
per row and the first cell becomes the link. A path that is not on this site is ignored. `empty` is
said when there are no rows. It is one of the page's eight reads, and a collection the site lacks
draws nothing and says so in the log.

It reads the delivery API, so it shows what the content type marks Public. Sorting and saved-query
sources are not part of this block yet. Search and filters are for `readAs: "viewer"` only (below).

Set `readAs: "viewer"` and it reads the CMS's authenticated list, `GET /api/contents?contentType=...`,
with the signed-in viewer's own token, so the rows are the ones that account may read. The token is
read on the server from the `__Host-press-viewer` cookie and goes to the CMS in an `Authorization`
header. It is not in the HTML, a prop or a response. The read carries the same `X-Tenant` as a
public one, is never cached, and never falls back to the public read. It needs `viewerSessions` and a
`createViewerPage` route. On `createPage`, or with no signed-in viewer, the table draws its `empty`
text and makes no read. References are not expanded and the order is the CMS's own. The authenticated list returns no slug,
so a `{slug}` in `rowLink` is filled with the row's id there.

```json
{ "type": "dataTable", "props": {
    "collection": "catering-request", "readAs": "viewer", "empty": "No requests",
    "columns": [ { "field": "Title", "label": "Request" } ]
} }
```

*Search and filters.* A viewer table can pass a search and a few filters to the core's list, which
takes `search` and `filter[field][op]=value` (see `Features/Content/List/Endpoint.cs` in barakoCMS).
The public delivery API has no such parameters, so a public table that sets any of these draws no
controls and logs a warning.

- `search: true` draws a search box. It is a plain GET form, so a search is a URL and works with no
  script. The value is read from the URL parameter `searchParam` (default `q`), stripped of control
  characters, cut to 200 characters and sent to the core as `search`. The core matches it, without
  regard to case, against the values of an entry. `searchLabel` names the box (default "Search").
- `filters` is a list of up to five groups `{ field, label, param, values }`. `field` is the core's
  field name, `values` is the list of choices (up to thirty, each at most 256 characters) and `param`
  is the URL parameter (default `f_<field>`). The block draws an "All" link and one link per value.
  A value in the URL that is not one of the listed values is ignored. A chosen value goes to the core
  as `filter[<field>][eq]=<value>`. The core refuses a field that is not readable for the content
  type, so a filter on a field the viewer may not read is a failed read. Any read the core refuses
  (a 400 for a filter, a 403 or 404) draws the search and filter controls and the `empty` text, so
  the viewer can change the search, and logs the status once.
- A new search or filter starts at page one, because the search form and the filter links carry no
  page. The previous and next links keep the active search and filters. A row link that starts with
  `?` keeps them and the table's own page, so coming back from a record lands where the viewer was.
- The core takes one value per field, so a second filter on the same field is dropped and logged.
- `pageParam`, `record` and `result` are taken, so a search or filter parameter that uses one of
  them is dropped and logged.

```json
{ "type": "dataTable", "props": {
    "collection": "requests", "readAs": "viewer", "empty": "No requests",
    "search": true, "searchLabel": "Search requests",
    "filters": [ { "field": "Service", "label": "Service", "param": "service", "values": ["Wedding", "Lunch", "Tasting"] } ],
    "rowLink": "?record={id}",
    "columns": [ { "field": "Title", "label": "Request" } ]
} }
```

```json
{ "type": "dataTable", "props": {
    "collection": "packages", "pageSize": 20, "rowLink": "/packages/{slug}",
    "columns": [ { "field": "Title", "label": "Package" }, { "field": "Category" } ]
} }
```

**Record panel and transition button.** A `recordPanel` shows one entry of a collection as the
signed-in viewer, and a `transitionButton` moves that entry through its workflow. Both need
`viewerSessions: true` and a `createViewerPage` route. A `dataTable` row link of `?record={id}` selects
the entry.

- `recordPanel` props: `collection`, `recordParam` (the URL parameter that holds the id, default
  `record`), `fields` (a list of `{ field, label, format }` to pick and order the rows, default every
  field the response carries), `statusLabel`, `empty` and `resultParam` (default `result`).
- The id must have the shape of a CMS entry id, or nothing is read. The entry is read with
  `GET /api/contents/{id}` using the viewer's own token and tenant. It is never cached, and there is
  no fallback to a public read. A field the account may not read is not in the response, so it has
  no row.
- With no viewer, no id, a 403 or 404, an entry of another content type, or a shared `createPage`
  route, the panel draws `empty` and reads nothing more.
- `transitionButton` props: `label`, `transition`, `requireReason`, `reasonLabel`, `reasonField`
  (default `Reason`, the PascalCase name the core requires), `collection`, `recordParam`, `resultParam` and `next` (the page to come back to,
  a path on this site). It draws only for a viewer with a valid id in the URL.
- The button posts a form to `/api/viewer/transition` (`createViewerTransitionRoute`, see
  [pages](pages.md)). The route refuses a request from another site, needs a viewer session, and
  refuses a missing reason when `requireReason` is set. It calls the core with the viewer's token,
  `PUT /api/contents/{id}/status` with `{ "transition": "...", "data": { "<reasonField>": "..." } }`,
  so the CMS decides whether that account may make the transition. The content type needs a
  lifecycle that declares it. The token never reaches the browser.
- The route redirects to `next` with `?record=<id>&result=<key>`. The key is one of `done`, `reason`,
  `forbidden`, `missing`, `conflict`, `invalid` or `unavailable`. The panel reads the entry again, shows
  its new status and draws the message for the key. Any other value in the URL draws nothing.

```json
{ "type": "recordPanel", "props": {
    "collection": "requests", "empty": "Pick a request",
    "fields": [{ "field": "Name", "label": "Event" }, { "field": "Guests", "label": "Guests" }]
} }
{ "type": "transitionButton", "props": {
    "collection": "requests", "label": "Decline", "transition": "Decline",
    "requireReason": true, "next": "/desk"
} }
```

**How is this built?** A `howBuilt` block draws a closed `<details>` that holds the page's own block
configuration as JSON, so a person using the page can see how it is made. `summary` sets the heading
(default "How is this built?"). It is a viewer block: it draws on `createViewerPage` and never on a
shared page. The listing is made from the blocks as they were written, before any binding, so a
`{{viewer.Username}}` shows as the text an editor typed and no value from the session, the URL or the
CMS is in it. It leaves out:

- the `state` a table, panel or pager has written into it by binding, which holds resolved data;
- any block whose `gate` this viewer does not pass, and a `showIf` that is not met for them;
- anything past 200 blocks, and any string past 1000 characters, which is cut.

Field names and values in block props show to anyone admitted to the page, so a block meant for one
role should use `gate`, which leaves it out for everyone else.

A token is never a block prop, so it is never in the listing. Do not put a secret in a block prop
and expect this block to hide it.

```json
{ "type": "howBuilt", "props": { "summary": "How is this built?" } }
```

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

The bar draws its buttons from the theme's colours. `recipe` names a style recipe for the row,
`buttonRecipe` one for each button and `pressedRecipe` one for the button that is pressed, each
replacing that look outright as a recipe does on a primitive; a button keeps `cursor: pointer`.

In a grouped source the bar is drawn once, ahead of the groups, and filters all of them. With
`hideEmptyGroups`, a group's own blocks carry every value its rows hold, so the same rule hides a
group that has no row left. Without it a group stays with its heading and no rows. Only the first bar
in a source counts. A grouped source honours only a bar at the top level of its content; one inside a
band there would repeat with every group, so it draws nothing and marks no row. The
values are those of the rows read, so a source that pages filters the page it is on.

**Text filter.** A `filterInput` inside a `source` is a labelled search box that shows only the rows
whose text holds every word typed, matched with the same `foldText` as the `search` block (lowercase,
accents removed, so `cafe` finds `Café`). Put it beside a `filterBar` and a row shows only when both
let it. A source holds one box, the first, and a grouped source draws it once, ahead of the groups.

```json
{ "type": "source", "props": {
    "collection": "packages", "mode": "list", "pageSize": 50,
    "content": [[
      { "type": "filterBar", "props": { "field": "Category" } },
      { "type": "filterInput", "props": { "label": "Filter packages" } },
      { "type": "repeat", "props": { "content": [[ { "type": "text", "props": { "value": "{{item.Title}}" } } ]] } }
    ]]
} }
```

It extends the bar's mechanism and adds no second one. The binder marks each row's blocks with the
same `data-bp-filter` id and, because a box is there, a row number in `data-bp-filter-row`
(`<id>:<n>`, the same on every block of one row, so a row of several blocks matches on all its text).
Typing sets `data-bp-filter-miss` on the blocks of the rows the words left out, and one rule the
server wrote, `[data-bp-filter-miss~="<id>"]{display:none!important}`, hides them. The bar's rule and
this one each hide, so the two combine by both having to pass. A row is matched on the text it shows,
so nothing is written into the page twice.

With no script every row shows and the box is not drawn: it is `hidden` in the server's markup and the
script shows it, so there is no field that does nothing. With script, `/` focuses the box when no
field has focus and Escape in the box clears it. Under the box are two polite live regions: the
count, written from `countLabel`, and the no-match line from `emptyLabel`. Neither says anything while
the list is untouched.

| Prop | What it does |
|---|---|
| `label` | The box's accessible name and placeholder. Default is the site's `filterInput` label (`Filter`) |
| `countLabel` | The live count. `{count}` is the rows showing, `{total}` all of them. Default is the `filterCount` label (`{count} shown`) |
| `emptyLabel` | The line when nothing matched. `{query}` is what was typed. Default is the `filterEmpty` label (`Nothing matches that.`) |
| `hideEmptyGroups` | In a grouped source, hide a group whose rows the typed words all left out. Off by default |
| `recipe`, `inputRecipe` | A style recipe for the whole box, and one for the text field, replacing the default look as a recipe does on a primitive |

In a grouped source (`groupBy`) a group whose rows are all missed keeps its heading by default. Set
`hideEmptyGroups` on the box to hide it. The binder then numbers each group in `data-bp-filter-group`
(`<id>:<n>`, the way it numbers a row), and the script sets `data-bp-filter-miss` on a group's blocks
when every row inside them is missed and clears it when one comes back. The live count ignores hidden
groups. The prop is the box's own: a box with no bar beside it can use it, and a bar's
`hideEmptyGroups` does not turn it on. With the prop off, or in a source with no `groupBy`, nothing
about the markup or the behaviour changes. The box is a client component, `src/blocks/filter-input.tsx`,
and holds only an id.
