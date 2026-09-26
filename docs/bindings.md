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
rather than one, and are described with `source` below. `viewer` arrives with #7. Formats are `text`, `date`, `datetime`, `time`, `money`, `number`, `upper` and
`lower`; `money` uses the tenant's `Currency` setting, or a plain amount when it has none.

Paths, formats and fallbacks only. There are no expressions and no JavaScript. Everything resolves
on the server as the request's tenant, before a component is called, so a binding never makes the
browser call the API. A placeholder that finds no value renders its fallback and is reported in the
server log, never a crash. What a binding resolves to is checked against the field again, so a link
whose stored field holds `javascript:` drops the block; and a resolved value is never rescanned, so
one field cannot reach another through its own contents.

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
