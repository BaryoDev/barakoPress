import Link from "next/link";
import type { CSSProperties } from "react";
import type { PressConfig } from "../config.js";
import { FilterButtons } from "./filter-bar.js";
import { FilterInputKeys } from "./filter-input.js";
import { FILTER_COUNT_ATTR, FILTER_EMPTY_ATTR, FILTER_INPUT_ATTR, readFilterState, textRule } from "./filter.js";
import { BINDING_FORMATS } from "./bindings.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import type { PressTheme } from "../theme.js";
import { recipeLook } from "../recipes.js";
import { spaceOf, toneOf } from "./tokens.js";

/*
 * Layer 4 of barakoPress #33: the blocks that load, repeat, choose and page.
 *
 * None of these draw anything of their own. `source` reads a collection and puts it in scope,
 * `repeat` renders its children once per row, `showIf` keeps or drops a subtree and `slot` marks
 * where a preset's own content goes. They are expanded in `bindBlocks` before anything renders,
 * because expanding a repeat is what produces the blocks the binder then binds, and because the
 * read has to happen on the server as the request's tenant.
 *
 * Their components are the no-binder fallback: a consumer rendering a `BlockList` directly, with no
 * binding pass, gets the content through for `showIf` and nothing for the blocks that need data. A
 * page rendered by `createPage` never takes that path.
 */

export const SOURCE_BLOCK = "source";
export const REPEAT_BLOCK = "repeat";
export const SHOW_IF_BLOCK = "showIf";
export const SLOT_BLOCK = "slot";
export const PAGER_BLOCK = "pager";
export const FILTER_BAR_BLOCK = "filterBar";
export const FILTER_INPUT_BLOCK = "filterInput";
export const DATA_TABLE_BLOCK = "dataTable";

/**
 * The most rows one `source` reads, and the most reads one page may make. Untrusted input, bounded.
 *
 * Past MAX_SOURCES a source, or a `{{count.<collection>}}`, is not read and draws nothing. That is a
 * warning in the server log, said once per message, not a failure: the page still renders and
 * answers 200, so a site already sitting past the limit starts logging and nothing else changes
 * (#210).
 */
export const MAX_SOURCE_ROWS = 50;
export const MAX_SOURCES = 8;
/*
 * A source with `mode: "all"` reads every row, a page of fifty at a time, up to this many: a document
 * that lists a whole collection, like a changelog, rather than a page of cards. It is one of the page's
 * reads however many pages of the API it takes.
 */
export const MAX_ALL_ROWS = 500;
/*
 * The API requests past the first that a page's `all` sources may make between them. Each source's
 * first page is one of the page's reads (MAX_SOURCES); the rest are drawn from this, and a source
 * whose rows it cannot cover reads what it can and says so. Without it eight such sources were eighty
 * requests a render, which a visitor could multiply with a filter bound to the query.
 */
export const MAX_ALL_REQUESTS = 16;
/*
 * What the rows of a `repeat` may draw between them. The page's own budget (MAX_BLOCKS) bounds what an
 * editor stored; this bounds what the data multiplies it into, so a long list neither eats the blocks
 * around it nor renders without end.
 */
export const MAX_ROW_BLOCKS = 10000;
/** The most values one `filterBar` offers. A field split on a separator can hold any number. */
export const MAX_FILTER_VALUES = 100;

/*
 * The collections a site offers an editor. A request-time site takes any name, because its
 * collections come from each tenant's settings and one registry serves all of them.
 */
function collectionField(config: PressConfig, label: string) {
    const options = Object.keys(config.collections);
    return config.sites
        ? ({ name: "collection", kind: "text", label, required: true } as const)
        : ({ name: "collection", kind: "select", label, required: true, options } as const);
}

type SourceProps = {
    collection: string;
    mode?: string;
    slug?: string;
    filterField?: string;
    filterValue?: string;
    pageSize?: number;
    pageParam?: string;
    groupBy?: string;
    groupOrder?: string;
};

function source(config: PressConfig): BlockDefinition {
    return defineBlock<SourceProps, "content">({
        type: SOURCE_BLOCK,
        label: "Load content",
        layer: "data",
        fields: [
            collectionField(config, "Collection"),
            { name: "mode", kind: "select", label: "How much", options: ["one", "list", "all"] },
            { name: "slug", kind: "text", label: "Which one, by slug" },
            { name: "filterField", kind: "text", label: "Only rows whose field" },
            { name: "filterValue", kind: "text", label: "Holds the value" },
            { name: "pageSize", kind: "number", label: "Rows a page", min: 1, max: MAX_SOURCE_ROWS },
            { name: "pageParam", kind: "text", label: "URL parameter holding the page number", bindable: false },
            { name: "groupBy", kind: "text", label: "Repeat once per value of the field" },
            { name: "groupOrder", kind: "text", label: "Groups first, in this order, comma separated" },
            { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
        ],
        // Nothing to put in scope without the binder, so nothing renders. Rendering the children
        // anyway would show a row of fallbacks that look like real, empty content.
        component: () => null,
    });
}

const repeat = defineBlock<{ limit?: number; empty?: string }, "content">({
    type: REPEAT_BLOCK,
    label: "Repeat per item",
    layer: "data",
    fields: [
        { name: "limit", kind: "number", label: "At most", min: 1, max: MAX_SOURCE_ROWS },
        { name: "empty", kind: "text", label: "Say this when there is nothing" },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: () => null,
});

type ShowIfProps = { value: string; equals?: string; unless?: boolean };

const showIf = defineBlock<ShowIfProps, "content">({
    type: SHOW_IF_BLOCK,
    label: "Show only when",
    layer: "data",
    fields: [
        { name: "value", kind: "text", label: "This value", required: true },
        { name: "equals", kind: "text", label: "Equals" },
        { name: "unless", kind: "boolean", label: "Show when it does not" },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ slots }) => slots.content?.[0] ?? null,
});

const slot = defineBlock<{ name: string }>({
    type: SLOT_BLOCK,
    label: "Preset content",
    layer: "data",
    fields: [{ name: "name", kind: "text", label: "Slot name", required: true, bindable: false }],
    component: () => null,
});

/*
 * Prev and next for the `source` around it, as links that change one URL parameter. Links and not
 * buttons: paging is a different URL, and a page that needs JavaScript to reach page two is a page
 * a crawler never reaches. The binder fills in the numbers; standing alone there is no page to be on.
 */
type PagerProps = { previousLabel?: string; nextLabel?: string; align?: string };

export interface PagerState {
    param: string;
    page: number;
    hasNext: boolean;
}

const pager = defineBlock<PagerProps & { state?: string }>({
    type: PAGER_BLOCK,
    label: "Pager",
    layer: "data",
    fields: [
        { name: "previousLabel", kind: "text", label: "Previous label" },
        { name: "nextLabel", kind: "text", label: "Next label" },
        { name: "align", kind: "select", label: "Align", options: ["start", "center", "end"] },
        // Written by the binder from the source it sits inside, never by an editor. It is a field
        // so that it travels with the block through the same validation as everything else.
        { name: "state", kind: "text", label: "Paging state", bindable: false },
    ],
    component: ({ props, theme }) => {
        const state = readPagerState(props.state);
        if (!state) return null;
        return pagerLinks(state, theme, props.previousLabel, props.nextLabel, props.align);
    },
});

function pagerLinks(state: PagerState, theme: PressTheme, previousLabel?: string, nextLabel?: string, align?: string) {
    const href = (page: number) => `?${encodeURIComponent(state.param)}=${page}`;
    const tone = toneOf(theme, undefined);
    const style = { color: tone.accent, fontWeight: 600, textDecoration: "none" } as const;
    return (
        <nav
            style={{
                display: "flex",
                gap: spaceOf(theme, "md"),
                justifyContent: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
                fontSize: theme.text.small,
            }}
        >
            {state.page > 1 && (
                <Link href={href(state.page - 1)} rel="prev" style={style}>
                    {previousLabel ?? "Previous"}
                </Link>
            )}
            {state.hasNext && (
                <Link href={href(state.page + 1)} rel="next" style={style}>
                    {nextLabel ?? "Next"}
                </Link>
            )}
        </nav>
    );
}

/** `param:page:hasNext`, so the state is a plain string field rather than a second prop shape. */
export function writePagerState(state: PagerState): string {
    return `${state.param}:${state.page}:${state.hasNext ? "1" : "0"}`;
}

export function readPagerState(value: string | undefined): PagerState | null {
    if (!value) return null;
    const parts = value.split(":");
    if (parts.length !== 3) return null;
    const page = Number(parts[1]);
    if (!parts[0] || !Number.isInteger(page) || page < 1) return null;
    return { param: parts[0], page, hasNext: parts[2] === "1" };
}

/*
 * Buttons that show only the rows of the `source` around it holding one value of a field (#129).
 * The binder reads the values from the rows the source loaded and writes them into `state`, and
 * marks each row with its own; the buttons hide the others in the browser, with no second read.
 *
 * Fewer than two values is no choice, so the bar draws nothing. The buttons are drawn from the
 * theme, and carry `aria-pressed` for a stylesheet to key off as well as for a screen reader.
 */
type FilterBarProps = {
    field: string;
    order?: string;
    separator?: string;
    allLabel?: string;
    label?: string;
    hideEmptyGroups?: boolean;
    recipe?: string;
    buttonRecipe?: string;
    pressedRecipe?: string;
    state?: string;
};

const filterBar = defineBlock<FilterBarProps>({
    type: FILTER_BAR_BLOCK,
    label: "Filter buttons",
    layer: "data",
    fields: [
        { name: "field", kind: "text", label: "Filter on the field", required: true },
        { name: "order", kind: "text", label: "Buttons first, in this order, comma separated" },
        { name: "separator", kind: "text", label: "One field holds several values, separated by" },
        { name: "allLabel", kind: "text", label: "The button that shows everything" },
        { name: "label", kind: "text", label: "What the buttons filter, for a screen reader" },
        { name: "hideEmptyGroups", kind: "boolean", label: "Hide a group left with no rows" },
        // The row, a button, and the button that is pressed, each a style recipe like a primitive's.
        { name: "recipe", kind: "text", label: "Style recipe, the row" },
        { name: "buttonRecipe", kind: "text", label: "Style recipe, a button" },
        { name: "pressedRecipe", kind: "text", label: "Style recipe, the pressed button" },
        // Written by the binder, like the pager's.
        { name: "state", kind: "text", label: "Filter state", bindable: false },
    ],
    component: ({ props, theme }) => {
        const state = readFilterState(props.state);
        if (!state || state.values.length < 2) return null;
        const c = theme.colors;
        const base: CSSProperties = {
            padding: "8px 15px",
            borderRadius: theme.radii.pill,
            fontFamily: "inherit",
            fontSize: "13px",
            cursor: "pointer",
        };
        // A recipe replaces the default look outright, as on a primitive; a button stays a pointer.
        const drawn = (name: string | undefined, fallback: CSSProperties, keep: CSSProperties = {}) => {
            const found = recipeLook(theme, name);
            return found ? { style: { ...found.style, ...keep }, className: found.className } : { style: fallback };
        };
        const pointer = { cursor: "pointer" } as const;
        return (
            <FilterButtons
                id={state.id}
                values={state.values}
                allLabel={props.allLabel ?? "All"}
                label={props.label}
                on={drawn(props.pressedRecipe, { ...base, background: c.ink, border: `1px solid ${c.ink}`, color: c.surface, fontWeight: 700 }, pointer)}
                off={drawn(props.buttonRecipe, { ...base, background: c.surface, border: `1px solid ${c.hairline}`, color: c.secondaryInk, fontWeight: 600 }, pointer)}
                row={drawn(props.recipe, { display: "flex", flexWrap: "wrap", gap: spaceOf(theme, "xs") })}
            />
        );
    },
});

/*
 * A text box that shows only the rows of the `source` around it whose text holds every word typed
 * (#254). The binder numbers each row and writes the box's id and labels into `state` and its props;
 * the rows stay server-rendered and the script marks the ones to hide, under one rule the engine
 * writes. It works with a `filterBar` in the same source: a row shows when both let it.
 *
 * The root is `hidden` in the server's markup and the script shows it, so a reader with no script
 * sees every row and no box that does nothing. The count and the no-match line are its own live
 * regions, written from the label attributes, so no label is serialised to the client.
 */
type FilterInputProps = {
    label?: string;
    countLabel?: string;
    emptyLabel?: string;
    recipe?: string;
    inputRecipe?: string;
    state?: string;
};

const filterInput = defineBlock<FilterInputProps>({
    type: FILTER_INPUT_BLOCK,
    label: "Filter text box",
    layer: "data",
    fields: [
        { name: "label", kind: "text", label: "The box's label and placeholder" },
        { name: "countLabel", kind: "text", label: "The live count, with {count} and {total}" },
        { name: "emptyLabel", kind: "text", label: "When nothing matched, with {query}" },
        { name: "recipe", kind: "text", label: "Style recipe, the whole box" },
        { name: "inputRecipe", kind: "text", label: "Style recipe, the text field" },
        // Written by the binder, like the filter bar's.
        { name: "state", kind: "text", label: "Filter state", bindable: false },
    ],
    component: ({ props, theme }) => {
        const state = readFilterState(props.state);
        if (!state) return null;
        const c = theme.colors;
        const own = recipeLook(theme, props.recipe);
        const field = recipeLook(theme, props.inputRecipe);
        const label = props.label ?? "";
        const note: CSSProperties = { margin: 0, fontSize: theme.text.small, color: c.secondaryInk };
        return (
            // `hidden` on a plain outer element: a recipe may set `display`, which would beat it.
            <div {...{ [FILTER_INPUT_ATTR]: state.id }} hidden>
                <div
                    // The gap goes onto a note only while it holds text, which the script does, so an empty
                    // live region leaves no space under the box.
                    style={{ ...(own ? own.style : {}), ["--bp-fi-gap" as string]: spaceOf(theme, "xs") }}
                    className={own?.className || undefined}
                >
                    <input
                        type="search"
                        aria-label={label}
                        placeholder={label}
                        autoComplete="off"
                        style={
                            field
                                ? { display: "block", ...field.style }
                                : {
                                      display: "block",
                                      width: "100%",
                                      boxSizing: "border-box",
                                      padding: "9px 12px",
                                      borderRadius: theme.radii.control,
                                      border: `1px solid ${c.hairline}`,
                                      background: c.surface,
                                      color: c.ink,
                                      font: "inherit",
                                      fontSize: theme.text.small,
                                  }
                        }
                        className={field?.className || undefined}
                    />
                    <p role="status" aria-live="polite" {...{ [FILTER_COUNT_ATTR]: props.countLabel ?? "" }} style={note} />
                    <p role="status" aria-live="polite" {...{ [FILTER_EMPTY_ATTR]: props.emptyLabel ?? "" }} style={note} />
                    <style dangerouslySetInnerHTML={{ __html: textRule(state.id) }} />
                    <FilterInputKeys id={state.id} />
                </div>
            </div>
        );
    },
});

/*
 * A table over a public collection (barakoPress #26). The binder reads one page of the collection on
 * the server and writes it into `state`; the block draws a table and prev and next links, so paging
 * is a different URL and nothing in the browser calls the API. It reads what the delivery API
 * serves, so it shows only the fields the content type marks Public.
 */
export const MAX_TABLE_COLUMNS = 12;

type DataTableProps = {
    collection: string;
    columns: { field: string; label?: string; format?: string }[];
    pageSize?: number;
    pageParam?: string;
    rowLink?: string;
    empty?: string;
    caption?: string;
    previousLabel?: string;
    nextLabel?: string;
    state?: string;
};

export interface DataTableState {
    heads: string[];
    rows: { cells: string[]; href?: string }[];
    pager: PagerState;
}

export function writeTableState(state: DataTableState): string {
    return JSON.stringify(state);
}

export function readTableState(value: string | undefined): DataTableState | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<DataTableState>;
        if (!Array.isArray(parsed.heads) || !Array.isArray(parsed.rows) || !parsed.pager) return null;
        return parsed as DataTableState;
    } catch {
        return null;
    }
}

function dataTable(config: PressConfig): BlockDefinition {
    return defineBlock<DataTableProps>({
        type: DATA_TABLE_BLOCK,
        label: "Data table",
        layer: "data",
        fields: [
            collectionField(config, "Collection"),
            {
                name: "columns",
                kind: "list",
                label: "Columns",
                required: true,
                min: 1,
                max: MAX_TABLE_COLUMNS,
                item: {
                    kind: "group",
                    label: "Column",
                    fields: [
                        { name: "field", kind: "text", label: "Field", required: true, bindable: false },
                        { name: "label", kind: "text", label: "Heading" },
                        { name: "format", kind: "select", label: "Show as", options: [...BINDING_FORMATS] },
                    ],
                },
            },
            { name: "pageSize", kind: "number", label: "Rows a page", min: 1, max: MAX_SOURCE_ROWS },
            { name: "pageParam", kind: "text", label: "URL parameter holding the page number", bindable: false },
            { name: "rowLink", kind: "text", label: "Row link, a site path with {slug} or {id}", bindable: false },
            { name: "empty", kind: "text", label: "Say this when there are no rows" },
            { name: "caption", kind: "text", label: "Caption, for a screen reader" },
            { name: "previousLabel", kind: "text", label: "Previous label" },
            { name: "nextLabel", kind: "text", label: "Next label" },
            // Written by the binder, never by an editor.
            { name: "state", kind: "text", label: "Table state", bindable: false },
        ],
        component: ({ props, theme }) => {
            const state = readTableState(props.state);
            if (!state) return null;
            const c = theme.colors;
            const cell: CSSProperties = {
                padding: "8px 12px",
                textAlign: "left",
                borderBottom: `1px solid ${c.hairline}`,
                fontSize: theme.text.small,
            };
            const link = { color: c.ink, fontWeight: 600 } as const;
            return (
                <div style={{ display: "grid", gap: spaceOf(theme, "md"), overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        {props.caption ? <caption style={{ ...cell, fontWeight: 700 }}>{props.caption}</caption> : null}
                        <thead>
                            <tr>
                                {state.heads.map((head, i) => (
                                    <th key={i} scope="col" style={{ ...cell, color: c.secondaryInk }}>
                                        {head}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {state.rows.map((row, r) => (
                                <tr key={r}>
                                    {row.cells.map((text, i) => (
                                        <td key={i} style={cell}>
                                            {row.href && i === 0 ? (
                                                <Link href={row.href} style={link}>
                                                    {text}
                                                </Link>
                                            ) : (
                                                text
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {state.rows.length === 0 && props.empty ? <p style={{ fontSize: theme.text.small }}>{props.empty}</p> : null}
                    {pagerLinks(state.pager, theme, props.previousLabel, props.nextLabel)}
                </div>
            );
        },
    });
}

export function dataBlocks(config: PressConfig): BlockDefinition[] {
    return [source(config), repeat, showIf, slot, pager, filterBar, filterInput, dataTable(config)];
}
