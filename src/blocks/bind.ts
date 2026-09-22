import type { PressConfig } from "../config.js";
import { collectionOf, getItem, listCollection, type Item } from "../collections.js";
import type { Page } from "../cms.js";
import { BindingSource, bindText, hasBinding, type BindingProblem, type BindingScopes } from "./bindings.js";
import {
    MAX_SOURCES,
    MAX_SOURCE_ROWS,
    PAGER_BLOCK,
    REPEAT_BLOCK,
    SHOW_IF_BLOCK,
    SLOT_BLOCK,
    SOURCE_BLOCK,
    writePagerState,
} from "./data.js";
import {
    MAX_BLOCKS,
    accepts,
    isBindable,
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

interface Frame {
    source: BindingSource;
    rows?: Rows;
    slots?: Record<string, PresetSlot[]>;
}

export interface BindContext {
    config: PressConfig;
    registry: BlockRegistry;
    budget: { blocks: number; reads: number };
}

export interface BindPageOptions {
    config: PressConfig;
    registry: BlockRegistry;
    scopes: BindingScopes;
    onProblem?: (problem: BindingProblem) => void;
}

export async function bindBlocks(blocks: ResolvedBlock[], options: BindPageOptions): Promise<ResolvedBlock[]> {
    const source = new BindingSource(options.scopes, {
        locale: options.config.locale,
        currency: options.config.currency,
        onProblem: options.onProblem,
    });
    const ctx: BindContext = {
        config: options.config,
        registry: options.registry,
        budget: { blocks: MAX_BLOCKS, reads: MAX_SOURCES },
    };
    return bindList(blocks, { source }, ctx);
}

async function bindList(blocks: ResolvedBlock[], frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const out: ResolvedBlock[] = [];
    for (const block of blocks) {
        if (ctx.budget.blocks <= 0) break;
        ctx.budget.blocks--;
        out.push(...(await bindBlock(block, frame, ctx)));
    }
    return out;
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
    const props: BlockProps = { ...block.props };
    for (const field of fields) {
        const value = props[field.name];
        if (typeof value !== "string" || !isBindable(field) || !hasBinding(value)) continue;
        const { text } = await bindText(value, source, { block: block.definition.type, field: field.name });
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

async function bindRepeat(block: ResolvedBlock, frame: Frame, ctx: BindContext): Promise<ResolvedBlock[]> {
    const content = block.slots.content?.[0] ?? [];
    const items = frame.rows?.items ?? [];
    const limit = typeof block.props.limit === "number" ? block.props.limit : MAX_SOURCE_ROWS;

    if (items.length === 0) {
        const empty = await boundString(block, frame.source, "empty");
        return empty.trim() === "" ? [] : emptyText(ctx, empty);
    }

    const out: ResolvedBlock[] = [];
    for (const item of items.slice(0, limit)) {
        if (ctx.budget.blocks <= 0) break;
        const scope = itemScope(ctx.config, item);
        out.push(...(await bindList(content, { ...frame, source: frame.source.with({ item: () => scope }) }, ctx)));
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
        return bindList(
            content,
            { ...frame, source: frame.source.with({ item: () => scope }), rows: { items: [item] } },
            ctx,
        );
    }

    const field = (await boundString(block, frame.source, "filterField")).trim();
    const want = (await boundString(block, frame.source, "filterValue")).trim();
    // A filter whose value bound to nothing would silently list everything, which for "the
    // enrollments in this class" is every class. No value, no rows.
    if (field !== "" && want === "") return [];

    const param = typeof block.props.pageParam === "string" ? block.props.pageParam : "";
    const page = param === "" ? 1 : pageNumber(await frame.source.read("query"), param);
    const pageSize = typeof block.props.pageSize === "number" ? block.props.pageSize : 12;

    const loaded = await read(() =>
        listCollection(ctx.config, key, {
            page,
            pageSize: Math.min(pageSize, MAX_SOURCE_ROWS),
            filter: field !== "" ? { [field]: want } : undefined,
        }),
    );
    const rows: Rows = {
        items: loaded?.items ?? [],
        ...(param !== "" ? { pager: { param, page, hasNext: loaded?.hasNextPage ?? false } } : {}),
    };
    return bindList(content, { ...frame, rows }, ctx);
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
 */
export function itemScope(config: PressConfig, item: Item): Record<string, unknown> {
    const route = collectionOf(config, item.collection)?.route;
    return {
        ...item.content.data,
        Id: item.id,
        Title: item.title,
        Slug: item.slug,
        Summary: item.summary,
        Body: item.body,
        Date: item.date,
        Image: item.image,
        ImageAlt: item.imageAlt,
        Url: item.url,
        Tags: item.tags,
        Option: item.option,
        Color: item.color,
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
