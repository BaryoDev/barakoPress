import Link from "next/link";
import type { PressConfig } from "../config.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
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

/** The most rows one `source` reads, and the most reads one page may make. Untrusted input, bounded. */
export const MAX_SOURCE_ROWS = 50;
export const MAX_SOURCES = 8;

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
            { name: "mode", kind: "select", label: "How much", options: ["one", "list"] },
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
        const href = (page: number) => `?${encodeURIComponent(state.param)}=${page}`;
        const tone = toneOf(theme, undefined);
        const style = { color: tone.accent, fontWeight: 600, textDecoration: "none" } as const;
        return (
            <nav
                style={{
                    display: "flex",
                    gap: spaceOf(theme, "md"),
                    justifyContent:
                        props.align === "center" ? "center" : props.align === "end" ? "flex-end" : "flex-start",
                    fontSize: theme.text.small,
                }}
            >
                {state.page > 1 && (
                    <Link href={href(state.page - 1)} rel="prev" style={style}>
                        {props.previousLabel ?? "Previous"}
                    </Link>
                )}
                {state.hasNext && (
                    <Link href={href(state.page + 1)} rel="next" style={style}>
                        {props.nextLabel ?? "Next"}
                    </Link>
                )}
            </nav>
        );
    },
});

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

export function dataBlocks(config: PressConfig): BlockDefinition[] {
    return [source(config), repeat, showIf, slot, pager];
}
