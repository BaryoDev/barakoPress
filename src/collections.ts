import { REFERENCE_FIELDS, type CollectionConfig, type FieldNames, type OptionStyle, type PressConfig } from "./config.js";
import { bySlug, bySlugPreview, list, search, type PublicContent, type Seo } from "./delivery.js";
import type { Ref } from "./cms.js";
import { siteHref } from "./site.js";

/*
 * Collections: any content type rendered as a list and a detail page, from configuration.
 *
 * A hospital's Departments and Doctors, a law firm's Practice areas and People, and the blog's own
 * posts, authors and categories are the same shape: a type, a route, a field map, references to other
 * collections and a sort. So they are one abstraction. Every name comes from `config.collections`,
 * which a request-time site reads from the tenant's settings, and every read goes through the same
 * tagged, cached, per tenant `list` and `bySlug` as the rest of the site.
 */

export interface Item {
    id: string;
    /** The key of the collection it was read as. */
    collection: string;
    slug: string;
    title: string;
    summary?: string;
    /** Markdown. */
    body: string;
    date?: string;
    image?: string;
    imageAlt?: string;
    /** A checked http or https link, or a site path. */
    url?: string;
    /** A portrait, from the collection's `photo` field role. */
    photo?: string;
    /** How far along, from the collection's `progress` field role. Text, because a binding is text. */
    progress?: string;
    featured: boolean;
    tags: string[];
    /** Resolved references, by field name. Undefined for one that did not come back resolved. */
    refs: Record<string, Ref | undefined>;
    /** The heading this item is grouped under, from the collection's `tree.section`. */
    section?: string;
    /** Where it comes in its section, from `tree.order`. Items with no order sort after those with one. */
    order?: number;
    /** The slug of the item it hangs under, from `tree.parent`. */
    parent?: string;
    /** The product it documents, from `tree.product`. */
    product?: string;
    /** Its path in whatever repository it is written in, from `tree.editPath`. */
    editPath?: string;
    /** The option the `colorBy` field holds. */
    option?: string;
    /** How the site shows that option: its tone, its icon and the word it goes by (#52). */
    style?: OptionStyle;
    /** The tone of that style, which is what `OptionColors` used to be on its own. */
    color?: string;
    seo?: Seo;
    /** The entry as the API returned it, for a site's own component. */
    content: PublicContent;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A configured collection by key. Own keys only, so a name taken from input cannot reach the prototype. */
export function collectionOf(config: PressConfig, key: string): CollectionConfig | undefined {
    return Object.hasOwn(config.collections, key) ? config.collections[key] : undefined;
}

function names(n: FieldNames | undefined): string[] {
    if (n === undefined) return [];
    return Array.isArray(n) ? n : [n];
}

function read(c: PublicContent, name: string): unknown {
    if (name === "@createdAt") return c.createdAt;
    if (name === "@updatedAt") return c.updatedAt;
    return Object.hasOwn(c.data, name) ? c.data[name] : undefined;
}

/** The first of the names holding a non-empty string, or "". */
function text(c: PublicContent, n: FieldNames | undefined): string {
    for (const name of names(n)) {
        const v = str(read(c, name));
        if (v) return v;
    }
    return "";
}

/** The first of the names holding any value. */
function value(c: PublicContent, n: FieldNames | undefined): unknown {
    for (const name of names(n)) {
        const v = read(c, name);
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
}

/*
 * A resolved reference. `include` gives back the whole target entry, so this handles that and a bare
 * object, and gives up rather than inventing a label when neither a name nor a slug is there. The
 * target's own field map says where its name and slug are.
 */
function toRef(config: PressConfig, target: string, v: unknown): Ref | undefined {
    if (!v || typeof v !== "object") return undefined;
    const d = v as Record<string, unknown>;
    const data = (d.data && typeof d.data === "object" ? d.data : d) as Record<string, unknown>;
    const entry: PublicContent = { id: str(d.id), data };
    const fields = collectionOf(config, target)?.fields;
    const name = text(entry, fields?.title ?? REFERENCE_FIELDS.title);
    const slug = str(d.slug) || text(entry, fields?.slug ?? REFERENCE_FIELDS.slug);
    if (!name && !slug) return undefined;
    return { id: str(d.id), slug, name: name || slug };
}

/*
 * Where an item sits in a tree, read only when the collection is one.
 *
 * A parent may be stored as a slug or as a reference to the sibling entry, because barakoCMS lets a
 * type hold either and a manual written by hand usually holds the slug. Both end as a slug, which is
 * what the tree links and nests by.
 */
function treePlace(config: PressConfig, key: string, c: PublicContent, col: CollectionConfig): Partial<Item> {
    const t = col.tree;
    if (!t) return {};
    const parent = value(c, t.parent);
    const parentSlug =
        typeof parent === "string" ? parent : toRef(config, key, parent)?.slug || undefined;
    return {
        section: text(c, t.section) || undefined,
        order: order(value(c, t.order)),
        parent: parentSlug || undefined,
        product: text(c, t.product) || undefined,
        editPath: text(c, t.editPath) || undefined,
    };
}

/** A position, from a number field or from a string field holding one. Undefined for anything else. */
function order(v: unknown): number | undefined {
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
    if (typeof v !== "string" || !v.trim()) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function optionOf(c: PublicContent, col: CollectionConfig): string | undefined {
    if (!col.colorBy) return undefined;
    const v = read(c, col.colorBy);
    if (typeof v === "string") return v || undefined;
    if (Array.isArray(v)) return v.find((x): x is string => typeof x === "string" && x.length > 0);
    return undefined;
}

function styleOf(config: PressConfig, col: CollectionConfig, option: string | undefined): OptionStyle | undefined {
    if (!option || !col.colorBy) return undefined;
    const byOption = config.optionStyles[`${col.type}.${col.colorBy}`];
    return byOption && Object.hasOwn(byOption, option) ? byOption[option] : undefined;
}

export function toItem(config: PressConfig, key: string, c: PublicContent): Item {
    const col = collectionOf(config, key);
    if (!col) throw new Error(`no collection "${key}" is configured`);
    const f = col.fields;
    const tags = value(c, f.tags);
    const option = optionOf(c, col);
    const style = styleOf(config, col, option);
    const refs: Record<string, Ref | undefined> = {};
    for (const [field, ref] of Object.entries(col.references ?? {})) {
        refs[field] = toRef(config, ref.collection, read(c, field));
    }
    return {
        id: c.id,
        collection: key,
        slug: c.slug ?? text(c, f.slug),
        title: text(c, f.title) || config.labels.untitled,
        summary: text(c, f.summary) || undefined,
        body: text(c, f.body),
        date: text(c, f.date) || undefined,
        image: text(c, f.image) || undefined,
        imageAlt: text(c, f.imageAlt) || undefined,
        url: siteHref(text(c, f.url)),
        photo: text(c, f.photo) || undefined,
        progress: text(c, f.progress) || undefined,
        ...treePlace(config, key, c, col),
        featured: value(c, f.featured) === true,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
        refs,
        option,
        ...(style ? { style } : {}),
        ...(style?.tone ? { color: style.tone } : {}),
        seo: c.seo ?? undefined,
        content: c,
    };
}

/*
 * The reference fields worth resolving in the same request: those pointing into a collection this
 * site has. The API caps `include` at five and answers 400 for a field the type does not have.
 */
function includesOf(config: PressConfig, col: CollectionConfig): string[] {
    return Object.entries(col.references ?? {})
        .filter(([, ref]) => collectionOf(config, ref.collection))
        .map(([field]) => field)
        .slice(0, 5);
}

export interface ListCollectionOptions {
    page?: number;
    pageSize?: number;
    /**
     * Field name to the value it must hold. A reference field takes the target's slug; any other
     * field, a choice field included, is matched exactly. The API takes at most five.
     */
    filter?: Record<string, string>;
}

export interface CollectionPage {
    items: Item[];
    total: number;
    /** How many rows a page holds, as the API answered. Never larger than what was asked for. */
    pageSize: number;
    hasNextPage: boolean;
}

const MAX_FILTERS = 5;

type Triple = [string, string, string];

/*
 * Ordering is asked of the API, not done here, for the reason posts are: sorting the page that came
 * back only orders those rows.
 */
async function listWith(
    config: PressConfig,
    key: string,
    col: CollectionConfig,
    opts: { page?: number; pageSize?: number; filter: Triple[] },
): Promise<CollectionPage> {
    const res = await list(config, col.type, {
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? col.pageSize ?? config.pageSizes.index,
        include: includesOf(config, col),
        filter: opts.filter.length > 0 ? opts.filter : undefined,
        sort: col.sort,
    });
    return {
        items: res.items.map((c) => toItem(config, key, c)),
        total: res.totalItems,
        pageSize: res.pageSize,
        hasNextPage: res.hasNextPage,
    };
}

export async function listCollection(
    config: PressConfig,
    key: string,
    opts: ListCollectionOptions = {},
): Promise<CollectionPage> {
    const col = collectionOf(config, key);
    if (!col) return { items: [], total: 0, pageSize: 0, hasNextPage: false };

    const wanted = Object.entries(opts.filter ?? {});
    if (wanted.length > MAX_FILTERS) throw new Error(`a list takes at most ${MAX_FILTERS} filters, got ${wanted.length}`);

    const filter: Triple[] = [];
    for (const [field, want] of wanted) {
        const ref = col.references && Object.hasOwn(col.references, field) ? col.references[field] : undefined;
        const target = ref ? collectionOf(config, ref.collection) : undefined;
        if (!target) {
            filter.push([field, "eq", want]);
            continue;
        }
        // A reference is filtered by the target's id, and a slug nobody has matches nothing.
        const found = await bySlug(config, target.type, want);
        if (!found) return { items: [], total: 0, pageSize: 0, hasNextPage: false };
        filter.push([field, "eq", found.id]);
    }
    return listWith(config, key, col, { page: opts.page, pageSize: opts.pageSize, filter });
}

/*
 * A page size is asked for, never assumed.
 *
 * barakoCMS clamps a public list with Math.Min, so asking for a thousand rows is answered with its
 * own hundred and no error at all. Everything a caller does not fetch a second time is then missing
 * with nothing saying so, which is how the sitemap lost every entry past the hundredth (#72). The
 * answer carries the size the API allowed, so the next page asks for that number instead of the one
 * this side guessed, and the run ends on `hasNextPage` rather than on an assumption.
 *
 * The mismatch is said once rather than absorbed. A count a tenant set and a count the API permits
 * disagreeing is a thing somebody fixes once, so the shape here is the one fonts.ts and presets.ts
 * use: a bounded set, emptied rather than trimmed when it fills, so the messages come back.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

/** For tests: say every message again. */
export function forgetCollectionWarnings(): void {
    said.clear();
}

export interface CollectionRun {
    items: Item[];
    /** True when the collection holds more than `limit` items, so the rest were never read. */
    truncated: boolean;
}

/**
 * Every item of a collection, a page at a time, up to `limit`.
 *
 * `limit` is the caller's bound on the whole run, because paging with no bound turns one request
 * into as many requests as the collection is long. `pageSize` is only where the first page starts;
 * what the API answers with decides the rest.
 */
export async function listAllCollection(
    config: PressConfig,
    key: string,
    opts: { limit: number; pageSize?: number; filter?: Record<string, string> },
): Promise<CollectionRun> {
    const limit = Math.max(0, Math.trunc(opts.limit));
    if (limit === 0) return { items: [], truncated: true };

    const items: Item[] = [];
    let asking = Math.max(1, Math.min(Math.trunc(opts.pageSize ?? limit), limit));

    for (let page = 1; ; page++) {
        const batch = await listCollection(config, key, { page, pageSize: asking, filter: opts.filter });
        if (batch.pageSize >= 1 && batch.pageSize < asking) {
            sayOnce(
                `collections: "${key}" was asked for ${asking} entries a page and the API allows ${batch.pageSize}, so the rest are read a page at a time`,
            );
            asking = batch.pageSize;
        }
        items.push(...batch.items);
        if (items.length >= limit) return { items: items.slice(0, limit), truncated: batch.hasNextPage || items.length > limit };
        if (!batch.hasNextPage || batch.items.length === 0) return { items, truncated: false };
    }
}

export async function getItem(config: PressConfig, key: string, slug: string): Promise<Item | null> {
    const col = collectionOf(config, key);
    if (!col) return null;
    const c = await bySlug(config, col.type, slug);
    return c ? toItem(config, key, c) : null;
}

/** A draft, read uncached with a preview token, as `bySlugPreview` does for any type. */
export async function getItemPreview(config: PressConfig, key: string, slug: string, token: string): Promise<Item | null> {
    const col = collectionOf(config, key);
    if (!col) return null;
    const c = await bySlugPreview(config, col.type, slug, token);
    return c ? toItem(config, key, c) : null;
}

/** Items of `key` whose reference field `via` points at the entry `id`. `pageSizes.archive` of them unless told. */
export async function listReferencing(
    config: PressConfig,
    key: string,
    id: string,
    via: string,
    pageSize?: number,
): Promise<Item[]> {
    const col = collectionOf(config, key);
    if (!col || !id) return [];
    const { items } = await listWith(config, key, col, {
        pageSize: pageSize ?? config.pageSizes.archive,
        filter: [[via, "eq", id]],
    });
    return items;
}

/** The first collection with a reference into `key`, and the field it uses: what a detail page lists. */
export function referencedBy(config: PressConfig, key: string): { collection: string; via: string } | undefined {
    for (const [other, col] of Object.entries(config.collections)) {
        for (const [field, ref] of Object.entries(col.references ?? {})) {
            if (ref.collection === key) return { collection: other, via: field };
        }
    }
    return undefined;
}

/**
 * Which collection a site path is: its index at the route, or an item one segment below. The longest
 * matching route wins, so a collection at /blog/featured is not read as a post slugged "featured". A
 * collection whose `index` is false answers only for its items.
 */
export function collectionAt(config: PressConfig, path: string): { key: string; slug?: string } | null {
    const parts = path.split("/").filter(Boolean);
    const routes = Object.entries(config.collections)
        .map(([key, col]) => ({ key, col, route: col.route?.split("/").filter(Boolean) ?? [] }))
        .filter((r) => r.route.length > 0)
        .sort((a, b) => b.route.length - a.route.length);
    for (const { key, col, route } of routes) {
        if (parts.length < route.length || parts.length > route.length + 1) continue;
        if (!route.every((segment, i) => segment.toLowerCase() === parts[i].toLowerCase())) continue;
        if (parts.length === route.length) {
            if (col.index === false) continue;
            return { key };
        }
        return { key, slug: parts[route.length] };
    }
    return null;
}

/**
 * The items of a collection matching a query, through the API's own search.
 *
 * Matching runs over the fields the type publishes, so a draft or a field held back from public
 * delivery can never surface. Empty for a collection this site has no configuration for, and empty
 * rather than thrown for a read that failed, since a search box sits on a page that must still render.
 */
export async function searchCollection(config: PressConfig, key: string, query: string, limit = 8): Promise<Item[]> {
    const col = collectionOf(config, key);
    if (!col) return [];
    const found = await search(config, col.type, query, limit);
    return found.map((c) => toItem(config, key, c));
}
