import type { PressConfig } from "../config.js";
import { collectionOf, getItem, listAllCollection, listCollection, names, type Item } from "../collections.js";
import type { Page } from "../cms.js";
import {
    BindingSource,
    bindText,
    bindValue,
    formatValue,
    hasBinding,
    walk,
    type BindingProblem,
    type BindingScopes,
    type BindingWhere,
} from "./bindings.js";
import {
    FILTER_BAR_BLOCK,
    MAX_FILTER_VALUES,
    MAX_SOURCES,
    MAX_ALL_ROWS,
    MAX_ROW_BLOCKS,
    MAX_SOURCE_ROWS,
    PAGER_BLOCK,
    REPEAT_BLOCK,
    SHOW_IF_BLOCK,
    SLOT_BLOCK,
    SOURCE_BLOCK,
    writePagerState,
} from "./data.js";
import { writeFilterState } from "./filter.js";
import {
    INVALID,
    MAX_BLOCKS,
    accepts,
    isBindable,
    itemField,
    readValue,
    type BlockField,
    type BlockProps,
    type BlockRegistry,
    type ResolvedBlock,
} from "./schema.js";

/*
 * Binding and expansion, the pass between resolving a stored page and rendering it.
 *
 * The control blocks are matched by the type name a page stores, which is the contract: a site that
 * registers its own `source` changes what an editor sees in the schema, not what a stored `source`
 * means here.
 *
 * `resolveBlocks` checks shape. This reads data, substitutes placeholders, expands a `source` into
 * the rows it loaded, a `repeat` into one subtree per row, a preset into the primitives it stands
 * for, and drops what a `showIf` says to drop. Everything here happens on the server, as the
 * request's tenant, before a single component is called. Nothing a binding does causes a browser to
 * call the API.
 *
 * It is a separate pass rather than work inside the components for two reasons. A block can
 * disappear or multiply, which a component cannot do to itself. And the blocks that render stay
 * synchronous, so a page is one await rather than an await per block.
 */

/** What `source` put in scope for the blocks inside it. */
interface Rows {
    items: Item[];
    pager?: { param: string; page: number; hasNext: boolean };
}

interface PresetSlot {
    blocks: ResolvedBlock[];
    /** The scope the slot's content was written in, which is the caller's, not the preset's. */
    source: BindingSource;
}

/** The filter a `source` holding a `filterBar` applies to its rows. */
interface Filter {
    id: string;
    field: string;
    separator: string;
    /** The values the bar offers, in its order, at most MAX_FILTER_VALUES. */
    values: string[];
    offered: Set<string>;
    hideEmptyGroups: boolean;
    /** Set once the bar has rendered, so a second bar in the same source draws nothing. */
    drawn: boolean;
    /** Inside one group of a grouped source, where the bar is not drawn again. */
    inGroup?: boolean;
}

interface Frame {
    source: BindingSource;
    rows?: Rows;
    slots?: Record<string, PresetSlot[]>;
    filter?: Filter;
    /** Inside a repeat's row, whose blocks spend the rows' budget rather than the page's. */
    inRow?: boolean;
}

export interface BindContext {
    config: PressConfig;
    registry: BlockRegistry;
    budget: { blocks: number; reads: number; rowBlocks: number };
    /** What `{{count.<collection>}}` resolves through, wherever on the page it is written. */
    count: (path: string) => Promise<number | undefined> | number | undefined;
    /** One read per collection per render, however many placeholders count it. */
    counts: Map<string, Promise<number | undefined>>;
    /** How many filters this bind has made, so two on one page get two ids. */
    filters: number;
    /** Which bind this is, from `BindPageOptions.scope`, so two binds on one page never share an id. */
    scope: string;
}

export interface BindPageOptions {
    config: PressConfig;
    registry: BlockRegistry;
    scopes: BindingScopes;
    onProblem?: (problem: BindingProblem) => void;
    /**
     * Which part of the page this bind draws: `body` when unset, or a region such as `header` or
     * `footer`. A page's regions and its body are bound apart, each counting its filters from one,
     * so the scope is what keeps two identical bars in them from sharing an id, and a click in one
     * from filtering both. It keeps the id the same on every render of a page, so the HTML is too.
     */
    scope?: string;
}

export async function bindBlocks(blocks: ResolvedBlock[], options: BindPageOptions): Promise<ResolvedBlock[]> {
    const ctx: BindContext = {
        config: options.config,
        registry: options.registry,
        budget: { blocks: MAX_BLOCKS, reads: MAX_SOURCES, rowBlocks: MAX_ROW_BLOCKS },
        count: (path) => collectionCount(ctx, path),
        counts: new Map(),
        filters: 0,
        scope: (options.scope ?? "body").replace(/[^A-Za-z0-9_-]/g, "") || "body",
    };
    if (options.scopes.count) ctx.count = options.scopes.count;
    const source = new BindingSource(
        { ...options.scopes, count: ctx.count },
        { locale: options.config.locale, currency: options.config.currency, onProblem: options.onProblem },
    );
    return unnestLinks(await bindList(blocks, { source }, ctx));
}

/*
 * A `stack` or `panel` given an `href` is a link as a whole, and a link inside a link is markup a
 * browser rewrites: it closes the outer anchor early, and the page it hydrates is not the page the
 * server drew. So a container whose content holds anything a reader can press keeps its content and
 * loses its `href`, and the server log says so once. Decided here, on the bound tree, because
 * whether an inline text holds a link or a container links at all can come from a binding.
 *
 * What counts is what the engine draws: a link, a button, a linked container, a text or rich text
 * holding a markdown link, and the blocks that are controls (a filter bar, a pager, a disclosure, a
 * tab, a search box, an embed, a video). A plugin's own controls are the plugin's to keep out.
 */
const CONTROLS = new Set([
    "link",
    "button",
    "filterBar",
    "pager",
    "disclosure",
    "tabGroup",
    "tabPanel",
    "search",
    "embed",
    "video",
    "codeSample",
    "docsSidebar",
    "docsSwitcher",
]);
const LINKING = new Set(["stack", "panel"]);
const MARKDOWN_LINK = /\]\(|<https?:|https?:\/\//i;
const unnestSaid = new Set<string>();

function linksAsAWhole(block: ResolvedBlock): boolean {
    return LINKING.has(block.definition.type) && typeof block.props.href === "string" && block.props.href.trim() !== "";
}

function pressable(block: ResolvedBlock): boolean {
    const type = block.definition.type;
    if (CONTROLS.has(type) || linksAsAWhole(block)) return true;
    if (type === "text" && block.props.format === "inline") return MARKDOWN_LINK.test(String(block.props.value ?? ""));
    if (type === "richText") return MARKDOWN_LINK.test(String(block.props.markdown ?? ""));
    return Object.values(block.slots).some((lists) => lists.some((list) => list.some(pressable)));
}

function unnestLinks(blocks: ResolvedBlock[]): ResolvedBlock[] {
    return blocks.map((block) => {
        const slots = Object.fromEntries(
            Object.entries(block.slots).map(([name, lists]) => [name, lists.map((list) => unnestLinks(list))]),
        );
        const inner = Object.values(slots).some((lists) => lists.some((list) => list.some(pressable)));
        if (!linksAsAWhole(block) || !inner) return { ...block, slots };
        const message = `blocks: a ${block.definition.type} linking to ${String(block.props.href)} holds a link or a control of its own, so it is drawn without its href`;
        if (!unnestSaid.has(message)) {
            if (unnestSaid.size >= 200) unnestSaid.clear();
            unnestSaid.add(message);
            console.warn(message);
        }
        const { href: _dropped, ...props } = block.props;
        return { ...block, props, slots };
    });
}

async function bindList(blocks: ResolvedBlock[], frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const out: ResolvedBlock[] = [];
    const counter = frame.inRow ? "rowBlocks" : "blocks";
    for (const block of blocks) {
        if (ctx.budget[counter] <= 0) {
            if (frame.inRow) sayRowsOver();
            break;
        }
        ctx.budget[counter]--;
        out.push(...(await bindBlock(block, frame, ctx)));
    }
    return out;
}

let rowsOverSaid = false;
function sayRowsOver(): void {
    if (rowsOverSaid) return;
    rowsOverSaid = true;
    console.warn(`blocks: a page's rows drew more than ${MAX_ROW_BLOCKS} blocks between them, so the rest were left out`);
}

async function bindBlock(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    switch (block.definition.type) {
        case SHOW_IF_BLOCK:
            return bindShowIf(block, frame, ctx);
        case SOURCE_BLOCK:
            return bindSource(block, frame, ctx);
        case REPEAT_BLOCK:
            return bindRepeat(block, frame, ctx);
        case SLOT_BLOCK:
            return bindSlot(block, frame, ctx);
        case PAGER_BLOCK:
            return bindPager(block, frame);
        case FILTER_BAR_BLOCK:
            return bindFilterBar(block, frame);
    }

    const bound = await bindProps(block, frame.source, {});
    if (!bound) return [];
    if (block.definition.preset) return expandPreset(block, bound, frame, ctx);
    return [{ ...block, props: bound, slots: await bindSlots(block, frame, ctx) }];
}

async function bindSlots(
    block: ResolvedBlock,
    frame: Frame,
    ctx: BindContext,
): Promise<Record<string, ResolvedBlock[][]>> {
    const slots: Record<string, ResolvedBlock[][]> = {};
    for (const [name, lists] of Object.entries(block.slots)) {
        slots[name] = [];
        for (const list of lists) slots[name].push(await bindList(list, frame, ctx));
    }
    return slots;
}

/* ------------------------------------------------------------------ props */

interface BindPropsOptions {
    /** Keep a prop whose bound value is empty, instead of treating it as absent. */
    allowEmpty?: boolean;
}

/**
 * A block's props with every placeholder resolved, or null when the block must not render.
 *
 * A bound value goes through the field that accepted the template, so a `url` field whose binding
 * resolves to `javascript:` drops the block exactly as a stored one would. That second check is the
 * point: the first ran against the placeholder, which says nothing about what it stands for.
 */
async function bindProps(
    block: ResolvedBlock,
    source: BindingSource,
    options: BindPropsOptions,
): Promise<BlockProps | null> {
    const fields = block.definition.fields as BlockField[];
    return bindRecord(fields, block.props, source, block.definition.type, "", options);
}

/*
 * A record of props through its fields: a block's own, or a group's. `path` is where the record sits
 * inside the block, so a problem inside a list of stages names `stages.1.name` and not just `name`.
 */
async function bindRecord(
    fields: BlockField[],
    record: Record<string, unknown>,
    source: BindingSource,
    block: string,
    path: string,
    options: BindPropsOptions,
): Promise<BlockProps | null> {
    const props: BlockProps = { ...record };
    for (const field of fields) {
        const value = props[field.name];
        const where = { block, field: path + field.name };
        if (field.kind === "list" || field.kind === "group") {
            if (value === undefined) continue;
            const bound = await bindStructured(field, value, source, where);
            if (bound === INVALID) return null;
            if (bound === undefined) {
                if (field.required) return null;
                delete props[field.name];
                continue;
            }
            props[field.name] = bound;
            continue;
        }
        if (typeof value !== "string" || !isBindable(field) || !hasBinding(value)) continue;
        const { text } = await bindText(value, source, where);
        if (text === "") {
            if (options.allowEmpty) {
                props[field.name] = "";
                continue;
            }
            if (field.required) return null;
            delete props[field.name];
            continue;
        }
        if (!accepts(field, text)) return null;
        props[field.name] = text;
    }
    return props;
}

/**
 * A list or a group with its placeholders resolved: undefined when it came out empty, INVALID when
 * the block must not render.
 *
 * A whole-value binding is read as data and checked by `readValue` in data mode, so nothing it
 * resolved to is scanned again. A stored list or group binds each string inside it like any string
 * prop, and an entry of a list whose text binds to nothing is left out rather than kept empty.
 */
async function bindStructured(
    field: BlockField,
    value: unknown,
    source: BindingSource,
    where: BindingWhere,
): Promise<unknown> {
    if (typeof value === "string") {
        const resolved = await bindValue(value, source, where);
        if (resolved === undefined) return undefined;
        const read = readValue(field, resolved, "data");
        return Array.isArray(read) && read.length === 0 ? undefined : read;
    }
    if (field.kind === "group") return bindGroup(field, value, source, where);

    const entry = itemField(field);
    const out: unknown[] = [];
    const items = value as unknown[];
    for (let i = 0; i < items.length; i++) {
        const at = { block: where.block, field: `${where.field}.${i}` };
        const bound = await bindEntry(entry, items[i], source, at);
        if (bound === INVALID) return INVALID;
        if (bound !== undefined) out.push(bound);
    }
    if (out.length === 0) return undefined;
    return field.min === undefined || out.length >= field.min ? out : INVALID;
}

async function bindGroup(field: BlockField, value: unknown, source: BindingSource, where: BindingWhere) {
    const record = value as Record<string, unknown>;
    const bound = await bindRecord(field.fields ?? [], record, source, where.block, `${where.field}.`, {});
    return bound ?? INVALID;
}

async function bindEntry(
    entry: BlockField,
    value: unknown,
    source: BindingSource,
    where: BindingWhere,
): Promise<unknown> {
    if (entry.kind === "group") return bindGroup(entry, value, source, where);
    if (typeof value !== "string" || !isBindable(entry) || !hasBinding(value)) return value;
    const { text } = await bindText(value, source, where);
    if (text === "") return undefined;
    return readValue(entry, text, "data");
}

/** One prop bound on its own, for a control block that acts on the value rather than rendering it. */
async function boundString(block: ResolvedBlock, source: BindingSource, name: string): Promise<string> {
    const value = block.props[name];
    if (typeof value !== "string") return "";
    if (!hasBinding(value)) return value;
    return (await bindText(value, source, { block: block.definition.type, field: name })).text;
}

/* ------------------------------------------------------------- control blocks */

async function bindShowIf(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const value = (await boundString(block, frame.source, "value")).trim();
    const equals = (await boundString(block, frame.source, "equals")).trim();
    const met = equals === "" ? value !== "" : value === equals;
    const show = block.props.unless === true ? !met : met;
    if (!show) return [];
    return bindList(block.slots.content?.[0] ?? [], frame, ctx);
}

async function bindSlot(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const name = typeof block.props.name === "string" ? block.props.name : "";
    const filled = frame.slots?.[name];
    if (!filled) return [];
    const out: ResolvedBlock[] = [];
    // Each list binds in the scope it was written in, which is the one outside the preset. A block
    // an editor dropped into a preset's slot reads the page, not the preset's props.
    for (const list of filled) out.push(...(await bindList(list.blocks, { source: list.source }, ctx)));
    return out;
}

function bindPager(block: ResolvedBlock, frame: Frame): ResolvedBlock[] {
    const pager = frame.rows?.pager;
    if (!pager) return [];
    return [{ ...block, props: { ...block.props, state: writePagerState(pager) }, slots: {} }];
}

async function bindFilterBar(block: ResolvedBlock, frame: Frame): Promise<ResolvedBlock[]> {
    const filter = frame.filter;
    if (!filter || filter.drawn || filter.inGroup) return [];
    filter.drawn = true;
    const props = await bindProps(block, frame.source, {});
    if (!props) return [];
    const state = writeFilterState({ id: filter.id, values: filter.values });
    return [{ ...block, props: { ...props, state }, slots: {} }];
}

async function bindRepeat(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const content = block.slots.content?.[0] ?? [];
    const items = frame.rows?.items ?? [];
    // Every row the source read unless the repeat names fewer: the source is what bounds the rows.
    const limit = typeof block.props.limit === "number" ? block.props.limit : items.length;

    if (items.length === 0) {
        const empty = await boundString(block, frame.source, "empty");
        return empty.trim() === "" ? [] : emptyText(ctx, empty);
    }

    const out: ResolvedBlock[] = [];
    const filter = frame.filter;
    for (const item of items.slice(0, limit)) {
        if (ctx.budget.rowBlocks <= 0) break;
        const scope = itemScope(ctx.config, item);
        // A row's own blocks carry its values; what is inside them is hidden with them, so the row's
        // frame carries no filter and a repeat nested in a row marks nothing.
        const rowFrame = { ...frame, source: frame.source.with({ item: () => scope }), filter: undefined, inRow: true };
        const row = await bindList(content, rowFrame, ctx);
        if (filter) {
            const values = offeredValues(ctx.config, item, filter);
            for (const bound of row) mark(bound, filter.id, values);
        }
        out.push(...row);
    }
    return out;
}

/*
 * "Nothing here" goes through the site's own `text` block rather than markup of its own, so it
 * takes the site's typography and a site that replaced `text` sees its own. A repeat with no rows
 * and no line renders nothing, which is right for a band that is simply not filled in yet.
 */
function emptyText(ctx: BindContext, value: string): ResolvedBlock[] {
    const definition = ctx.registry.get("text");
    return definition ? [{ definition, props: { value }, slots: {} }] : [];
}

/* ------------------------------------------------------------------ source */

async function bindSource(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const content = block.slots.content?.[0] ?? [];
    if (ctx.budget.reads <= 0) return [];
    ctx.budget.reads--;

    const key = await boundString(block, frame.source, "collection");
    if (!collectionOf(ctx.config, key)) return [];

    const slug = (await boundString(block, frame.source, "slug")).trim();
    const one = block.props.mode === "one" || (block.props.mode === undefined && slug !== "");

    if (one) {
        // A page whose slug comes from the URL and matches nothing renders the blocks around the
        // source, not a 404. Only a route decides what a missing page means.
        const item = slug === "" ? null : await read(() => getItem(ctx.config, key, slug));
        if (!item) return [];
        const scope = itemScope(ctx.config, item);
        const inner = rowScopes(ctx, [item], 1);
        return bindList(
            content,
            {
                ...frame,
                source: frame.source.with({ ...inner, item: () => scope }),
                rows: { items: [item] },
                filter: undefined,
            },
            ctx,
        );
    }

    const field = (await boundString(block, frame.source, "filterField")).trim();
    const want = (await boundString(block, frame.source, "filterValue")).trim();
    // A filter whose value bound to nothing would silently list everything, which for "the
    // enrollments in this class" is every class. No value, no rows.
    if (field !== "" && want === "") return [];

    const all = block.props.mode === "all";
    const param = all || typeof block.props.pageParam !== "string" ? "" : block.props.pageParam;
    const page = param === "" ? 1 : pageNumber(await frame.source.read("query"), param);
    const pageSize = typeof block.props.pageSize === "number" ? block.props.pageSize : 12;
    const narrowed = field !== "" ? { [field]: want } : undefined;

    // Every row, a page at a time, as one of the page's reads; or the one page the source asks for.
    const loaded = all
        ? await read(async () => {
              const run = await listAllCollection(ctx.config, key, { limit: MAX_ALL_ROWS, pageSize: MAX_SOURCE_ROWS, filter: narrowed });
              return { items: run.items, total: run.items.length, hasNextPage: false };
          })
        : await read(() => listCollection(ctx.config, key, { page, pageSize: Math.min(pageSize, MAX_SOURCE_ROWS), filter: narrowed }));
    const items = loaded?.items ?? [];
    const total = typeof loaded?.total === "number" ? loaded.total : undefined;

    const groupBy = (await boundString(block, frame.source, "groupBy")).trim();
    const filter = await filterOf(content, frame, ctx, items, groupBy !== "");
    if (groupBy !== "") {
        const order = (await boundString(block, frame.source, "groupOrder")).split(",");
        return bindGroups(content, { ...frame, filter }, ctx, groupRows(ctx.config, items, groupBy, order), total);
    }

    const rows: Rows = {
        items,
        ...(param !== "" ? { pager: { param, page, hasNext: loaded?.hasNextPage ?? false } } : {}),
    };
    return bindList(content, { ...frame, source: frame.source.with(rowScopes(ctx, items, total)), rows, filter }, ctx);
}

/*
 * The filter for a source whose content holds a `filterBar`, or undefined. The first bar found, in
 * the order the page is written and not inside a nested source, is the one whose field counts. In a
 * grouped source only a bar at the top level of its content counts, since that is the bar drawn
 * once ahead of the groups; one inside a band would repeat with every group.
 *
 * The values come from the rows this source read, so a source that pages filters the page it is on.
 */
async function filterOf(
    content: ResolvedBlock[],
    frame: Frame,
    ctx: BindContext,
    items: Item[],
    grouped: boolean,
): Promise<Filter | undefined> {
    const bar = grouped ? content.find((block) => block.definition.type === FILTER_BAR_BLOCK) : findFilterBar(content);
    if (!bar) return undefined;
    const field = (await boundString(bar, frame.source, "field")).trim();
    if (field === "") return undefined;
    const separator = await boundString(bar, frame.source, "separator");
    const order = (await boundString(bar, frame.source, "order")).split(",");

    const seen = new Set<string>();
    for (const item of items) for (const value of rowValues(ctx.config, item, field, separator)) seen.add(value);
    const values = ordered([...seen], order).slice(0, MAX_FILTER_VALUES);
    ctx.filters++;
    return {
        id: `f${ctx.filters}-${ctx.scope}`,
        field,
        separator,
        values,
        offered: new Set(values),
        hideEmptyGroups: bar.props.hideEmptyGroups === true,
        drawn: false,
    };
}

function findFilterBar(blocks: ResolvedBlock[]): ResolvedBlock | undefined {
    for (const block of blocks) {
        const type = block.definition.type;
        if (type === FILTER_BAR_BLOCK) return block;
        if (type === SOURCE_BLOCK) continue;
        for (const lists of Object.values(block.slots)) {
            for (const list of lists) {
                const found = findFilterBar(list);
                if (found) return found;
            }
        }
    }
    return undefined;
}

/**
 * The values one row's field holds: each entry of a list, or the text split on `separator` when
 * one is set, trimmed, with the empty ones and repeats left out.
 */
function rowValues(config: PressConfig, item: Item, field: string, separator: string): string[] {
    const value = walk(itemScope(config, item), field);
    const parts: string[] = [];
    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === "string" || typeof entry === "number") parts.push(String(entry));
        }
    } else {
        const text = formatValue(value, "text", { locale: config.locale }) ?? "";
        parts.push(...(separator === "" ? [text] : text.split(separator)));
    }
    return [...new Set(parts.map((part) => part.trim()).filter((part) => part !== ""))];
}

/** A row's values that the bar offers. One it does not offer could never be chosen. */
function offeredValues(config: PressConfig, item: Item, filter: Filter): string[] {
    return rowValues(config, item, filter.field, filter.separator).filter((value) => filter.offered.has(value));
}

/** Marks a block as belonging to bar `id`, unless it already does. */
function mark(block: ResolvedBlock, id: string, values: string[]): void {
    if (block.filters?.some((mark) => mark.id === id)) return;
    block.filters = [...(block.filters ?? []), { id, values }];
}

/** Keys in the order first seen, with the ones `order` names moved to the front in that order. */
function ordered(keys: string[], order: string[]): string[] {
    const first = order.map((key) => key.trim()).filter((key) => key !== "" && keys.includes(key));
    const front = [...new Set(first)];
    return [...front, ...keys.filter((key) => !front.includes(key))];
}


/*
 * A grouped source renders its content once per group, and inside each the group is the rows: a
 * `repeat` walks that group's rows and `{{sum.X}}` adds them. `{{count}}` stays what the source
 * matched, and `{{group.count}}` is how many of the rows it read fell in this group.
 *
 * No pager inside a group. The groups are made from one page of rows, so a pager in each would page
 * every group at once, and the groups on page two are not the groups on page one.
 */
async function bindGroups(
    content: ResolvedBlock[],
    frame: Frame,
    ctx: BindContext,
    groups: { key: string; items: Item[] }[],
    total: number | undefined,
): Promise<ResolvedBlock[]> {
    const out: ResolvedBlock[] = [];
    const filter = frame.filter;
    // The bar filters every group at once, so it is drawn once, ahead of them, and not per group.
    const bars = content.filter((block) => block.definition.type === FILTER_BAR_BLOCK);
    if (filter && bars.length > 0) {
        const all = groups.flatMap((group) => group.items);
        out.push(...(await bindList(bars, { ...frame, source: frame.source.with(rowScopes(ctx, all, total)) }, ctx)));
    }
    const body = bars.length > 0 ? content.filter((block) => !bars.includes(block)) : content;
    const inGroup = filter ? { ...filter, inGroup: true } : undefined;
    for (const group of groups) {
        if (ctx.budget.blocks <= 0) break;
        const scope = { key: group.key, count: group.items.length };
        const source = frame.source.with({ ...rowScopes(ctx, group.items, total), group: () => scope });
        const bound = await bindList(body, { ...frame, source, rows: { items: group.items }, filter: inGroup }, ctx);
        // A group's own blocks carry every value its rows hold, so the rule that hides a row hides
        // a group none of whose rows is left. A block that is a row already keeps its own.
        if (filter?.hideEmptyGroups) {
            const values = [...new Set(group.items.flatMap((item) => offeredValues(ctx.config, item, filter)))];
            for (const block of bound) mark(block, filter.id, values);
        }
        out.push(...bound);
    }
    return out;
}

/**
 * Rows by the text of one field, in the order first seen, with the keys `order` names moved to the
 * front in that order. A row with nothing in the field is kept, under an empty key, so grouping
 * never hides a row the source read; `{{group.key ?? Other}}` names it.
 */
function groupRows(config: PressConfig, items: Item[], field: string, order: string[]) {
    const groups = new Map<string, Item[]>();
    for (const item of items) {
        const value = walk(itemScope(config, item), field);
        const key = formatValue(value, "text", { locale: config.locale }) ?? "";
        const rows = groups.get(key);
        if (rows) rows.push(item);
        else groups.set(key, [item]);
    }
    return ordered([...groups.keys()], order).map((key) => ({ key, items: groups.get(key) ?? [] }));
}

/** `count`, `sum` and `distinct` for the blocks inside a source, over the rows it read. */
function rowScopes(ctx: BindContext, items: Item[], total: number | undefined): BindingScopes {
    return {
        count: (path) => (path === "" ? total : ctx.count(path)),
        sum: () => sums(ctx.config, items),
        distinct: () => distincts(ctx.config, items),
    };
}

/**
 * How many different values each field holds among the rows read: the repositories a list of issues
 * spans, which is the number of groups a `groupBy` on that field would draw. Compared as the text a
 * placeholder would print, and each entry of a list counts on its own, as a filter bar reads one. A row
 * with nothing in the field adds nothing.
 *
 * Over the rows the source read, which is at most fifty, like a sum.
 */
function distincts(config: PressConfig, items: Item[]): Record<string, number> {
    const seen = new Map<string, Set<string>>();
    for (const item of items) {
        for (const [field, value] of Object.entries(itemScope(config, item))) {
            for (const one of Array.isArray(value) ? value : [value]) {
                if (one === undefined || one === null || typeof one === "object") continue;
                const text = formatValue(one, "text", { locale: config.locale }) ?? "";
                if (text === "") continue;
                const values = seen.get(field) ?? new Set<string>();
                values.add(text);
                seen.set(field, values);
            }
        }
    }
    return Object.fromEntries([...seen].map(([field, values]) => [field, values.size]));
}

/**
 * Each field that holds a number in every row that has it, added up. A number stored as text counts,
 * the way `| number` reads one; a field with a word in any row is not a sum and is left out, so it
 * renders its fallback rather than a total of the rows that happened to be numbers.
 *
 * Over the rows the source read, which is at most fifty. A source that pages sums the page.
 */
function sums(config: PressConfig, items: Item[]): Record<string, number> {
    const totals: Record<string, number> = {};
    const refused = new Set<string>();
    for (const item of items) {
        for (const [field, value] of Object.entries(itemScope(config, item))) {
            if (value === undefined || value === null || value === "" || refused.has(field)) continue;
            const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
            if (!Number.isFinite(n)) {
                refused.add(field);
                delete totals[field];
                continue;
            }
            totals[field] = (totals[field] ?? 0) + n;
        }
    }
    return totals;
}

/**
 * How many published entries a collection has: the delivery API's `totalItems` for a page of one.
 * The public API lists published entries only, so this is the number of rows the page could list.
 *
 * Each collection counted is one of the page's reads, spent the first time it is named. Past the
 * budget, and for a key that is no collection, it is a count that could not be had and renders the
 * fallback. The empty path is `{{count}}` outside any source, which counts nothing.
 */
function collectionCount(ctx: BindContext, path: string): Promise<number | undefined> | undefined {
    if (path === "" || !collectionOf(ctx.config, path)) return undefined;
    const known = ctx.counts.get(path);
    if (known) return known;
    if (ctx.budget.reads <= 0) return undefined;
    ctx.budget.reads--;
    const counted = read(() => listCollection(ctx.config, path, { pageSize: 1 })).then((page) =>
        typeof page?.total === "number" ? page.total : undefined,
    );
    ctx.counts.set(path, counted);
    return counted;
}

/** A page's read must not take the page down, which is the rule the feed and the sitemap follow. */
async function read<T>(load: () => Promise<T>): Promise<T | null> {
    try {
        return await load();
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        return null;
    }
}

function pageNumber(query: Record<string, unknown> | null, param: string): number {
    const raw = query && Object.hasOwn(query, param) ? query[param] : undefined;
    const n = Number(typeof raw === "string" || typeof raw === "number" ? raw : NaN);
    return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/* ------------------------------------------------------------------ presets */

async function expandPreset(
    block: ResolvedBlock,
    props: BlockProps,
    frame: Frame,
    ctx: BindContext,
): Promise<ResolvedBlock[]> {
    const slots: Record<string, PresetSlot[]> = {};
    for (const [name, lists] of Object.entries(block.slots)) {
        slots[name] = lists.map((blocks) => ({ blocks, source: frame.source }));
    }
    const inner: Frame = {
        ...frame,
        source: frame.source.with({ props: () => props }),
        slots,
    };
    return bindList(block.definition.preset ?? [], inner, ctx);
}

/* ------------------------------------------------------------------- scopes */

/**
 * What `{{item.X}}` reads.
 *
 * The entry's own fields come first under the names the tenant gave them, because a client's model
 * is its own and `{{item.Headline}}` has to work. The engine's names are laid over them, so
 * `{{item.Title}}` means the title whatever the field is called.
 *
 * A role is laid over only when the collection maps it (#121). An unmapped role has nothing to say,
 * and laying its empty value over the entry's own `Body` or `Date` took the field away.
 */
export function itemScope(config: PressConfig, item: Item): Record<string, unknown> {
    const col = collectionOf(config, item.collection);
    const route = col?.route;
    const mapped = (role: keyof NonNullable<typeof col>["fields"]) => names(col?.fields[role]).length > 0;
    const role = <T>(name: string, on: boolean, value: T) => (on ? { [name]: value } : {});
    return {
        ...item.content.data,
        Id: item.id,
        Title: item.title,
        Slug: item.slug,
        ...role("Summary", mapped("summary"), item.summary),
        ...role("Body", mapped("body"), item.body),
        ...role("Date", mapped("date"), item.date),
        ...role("Image", mapped("image"), item.image),
        ...role("ImageAlt", mapped("imageAlt"), item.imageAlt),
        ...role("Url", mapped("url"), item.url),
        ...role("Tags", mapped("tags"), item.tags),
        ...role("Option", col?.colorBy !== undefined, item.option),
        ...role("Color", col?.colorBy !== undefined, item.color),
        /*
         * The progress figure and the option's style, so a bar and a card can draw what the site
         * declared (#52) without a block naming either.
         *
         * Spread in only when there is something in them, the way `Href` already is. `walk` reads a
         * path with `Object.hasOwn`, so a key set to `undefined` is a hit rather than a miss, and
         * laying one over a tenant's own field of that name would take the field away. `Icon` is a
         * plausible name for a field on exactly the collections this is for.
         */
        ...(item.progress !== undefined ? { Progress: item.progress } : {}),
        ...(item.progressCount !== undefined ? { ProgressCount: item.progressCount } : {}),
        ...(item.progressTotal !== undefined ? { ProgressTotal: item.progressTotal } : {}),
        ...(item.style?.icon !== undefined ? { Icon: item.style.icon } : {}),
        ...(item.style?.label ?? item.option) !== undefined
            ? { Word: item.style?.label ?? item.option }
            : {},
        /*
         * A card's link (#104): the collection's own `href` field first, since that is what a synced
         * entry carries when it points somewhere this site does not host. The item's own route is the
         * fallback, not the default, because a collection with a route still wants it when no field
         * says otherwise.
         */
        ...(item.href !== undefined
            ? { Href: item.href }
            : route !== undefined && item.slug
              ? { Href: `${route}/${item.slug}` }
              : {}),
        ...Object.fromEntries(Object.entries(item.refs).map(([field, ref]) => [field, ref ? { ...ref } : undefined])),
    };
}

/** What `{{page.X}}` reads, the same way round: the entry's fields, then the engine's names. */
export function pageScope(page: Page): Record<string, unknown> {
    return {
        ...(page.content?.data ?? {}),
        Id: page.id,
        Title: page.title,
        Slug: page.slug,
        Summary: page.summary,
        Body: page.body,
    };
}

/**
 * What `{{site.X}}` reads: the tenant's site settings, with the identity the engine resolved laid
 * over them. A build-time site has no settings entry and still answers `{{site.Name}}`, because the
 * identity is where its name lives.
 */
export function siteScope(config: PressConfig, globals: Record<string, unknown>): Record<string, unknown> {
    const s = config.site;
    return {
        ...globals,
        Name: s.name,
        Tagline: s.tagline,
        Url: s.url,
        Logo: s.logo,
        Copyright: s.copyright,
    };
}

/** What `{{query.X}}` reads. Strings only, and one value per name: the first the URL carries. */
export function queryScope(params: Record<string, string | string[] | undefined> | URLSearchParams): Record<string, string> {
    const out: Record<string, string> = {};
    if (params instanceof URLSearchParams) {
        for (const [name, value] of params) if (!(name in out)) out[name] = value;
        return out;
    }
    for (const [name, value] of Object.entries(params)) {
        const first = Array.isArray(value) ? value[0] : value;
        if (typeof first === "string") out[name] = first;
    }
    return out;
}
