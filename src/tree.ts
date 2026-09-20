import { TREE_LIMIT, type CollectionTree, type PressConfig, type TreeProduct } from "./config.js";
import { collectionOf, listAllCollection, type Item } from "./collections.js";
import { siteHref } from "./site.js";

/*
 * A collection read as a tree (#23).
 *
 * A manual is a list with four extra facts per page: which section it sits in, where it comes in the
 * order, what it hangs under, and which product it documents. Those are fields on the tenant's own
 * type, named in `tree`, so the shape of the manual is content and nothing here knows a section called
 * "Getting started" exists.
 *
 * What this replaces is a file like barakocms.com's `lib/docs-manifest.ts`: a hand-kept list of every
 * page, its title, its group and its reading order, which has to be edited in a site repository and
 * deployed before a new page appears. The same list read from the collection is edited in barakoBrew.
 */

/** How deep a parent chain is followed. Past this an item is drawn at the top of its section. */
export const TREE_MAX_DEPTH = 6;

export interface TreeNode {
    item: Item;
    /** Where the item is served, or undefined when its collection has no route. */
    href?: string;
    children: TreeNode[];
}

export interface TreeSection {
    /** The heading these nodes sit under. Undefined for the items with no section. */
    name?: string;
    nodes: TreeNode[];
}

export interface CollectionTreeResult {
    sections: TreeSection[];
    /** Reading order, parents before their children, which is what previous and next walk. */
    order: Item[];
    /** True when the collection holds more items than the tree was allowed to read. */
    truncated: boolean;
}

const EMPTY: CollectionTreeResult = { sections: [], order: [], truncated: false };

/**
 * Sorted by `order` and then by title, which is the rule for every level and every section.
 *
 * Items with no order come after those with one rather than at position zero, so adding the field to
 * one page does not push every other page below it. Ties break on the title so the answer does not
 * depend on the order rows came back in.
 */
function inOrder(items: Item[]): Item[] {
    return [...items].sort((a, b) => {
        const ao = a.order ?? Number.POSITIVE_INFINITY;
        const bo = b.order ?? Number.POSITIVE_INFINITY;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title);
    });
}

/**
 * The sections, in the order the tenant named, then any it did not in the order they came back in.
 *
 * A named order and not a derived one: every rule that works it out from the pages is wrong for
 * somebody, and the manual this replaces held the group order in a file for exactly that reason. A
 * name in the setting that no item uses draws nothing, so a section can be listed before it is
 * written.
 */
function sectionOrder(items: Item[], named: readonly string[] | undefined): (string | undefined)[] {
    const present = new Set<string | undefined>(items.map((i) => i.section));
    const names: (string | undefined)[] = (named ?? []).filter((n) => present.has(n));
    const seen = new Set<string | undefined>(names);
    for (const item of items) {
        if (seen.has(item.section)) continue;
        seen.add(item.section);
        names.push(item.section);
    }
    return names;
}

/*
 * Children hang off their parent, and a parent nobody has is not a reason to drop a page.
 *
 * An item naming a parent that was never published, or that the product filter left out, is drawn at
 * the top of its own section instead of disappearing. A cycle, which a tenant can write by pointing
 * two pages at each other, is broken by the depth bound rather than by looking for one: the same
 * answer, and no traversal that can run away.
 */
function nest(items: Item[], bySlug: Map<string, Item>): TreeNode[] {
    const children = new Map<string, Item[]>();
    const roots: Item[] = [];
    for (const item of items) {
        const parent = item.parent && item.parent !== item.slug ? bySlug.get(item.parent) : undefined;
        if (!parent) {
            roots.push(item);
            continue;
        }
        const kin = children.get(parent.slug);
        if (kin) kin.push(item);
        else children.set(parent.slug, [item]);
    }

    const build = (item: Item, depth: number, drawn: Set<string>): TreeNode => {
        drawn.add(item.slug);
        const kin = depth >= TREE_MAX_DEPTH ? [] : (children.get(item.slug) ?? []).filter((c) => !drawn.has(c.slug));
        return { item, children: inOrder(kin).map((c) => build(c, depth + 1, drawn)) };
    };

    const drawn = new Set<string>();
    const nodes = inOrder(roots).map((item) => build(item, 1, drawn));
    // A page whose parent chain never reached a root, which is what a cycle leaves behind.
    const orphans = inOrder(items.filter((i) => !drawn.has(i.slug)));
    return [...nodes, ...orphans.map((item) => build(item, 1, drawn))];
}

function withHrefs(nodes: TreeNode[], route: string | undefined): TreeNode[] {
    return nodes.map((node) => ({
        ...node,
        ...(route !== undefined && node.item.slug ? { href: `${route}/${node.item.slug}` } : {}),
        children: withHrefs(node.children, route),
    }));
}

/** Parents before their children, section by section: the order previous and next walk. */
export function flattenTree(sections: TreeSection[]): Item[] {
    const walk = (nodes: TreeNode[]): Item[] => nodes.flatMap((n) => [n.item, ...walk(n.children)]);
    return sections.flatMap((s) => walk(s.nodes));
}

export interface CollectionTreeOptions {
    /** Only the items whose product field holds this key. Every item when unset. */
    product?: string;
    /** Only the items holding these values, as `listCollection` takes them. */
    filter?: Record<string, string>;
}

/**
 * A collection as sections of nested items.
 *
 * Empty for a collection that is not configured as a tree, and empty rather than thrown for a read
 * that failed: a sidebar is chrome, and a manual whose CMS is unreachable should lose its sidebar
 * rather than its page.
 */
export async function collectionTree(
    config: PressConfig,
    key: string,
    options: CollectionTreeOptions = {},
): Promise<CollectionTreeResult> {
    const col = collectionOf(config, key);
    const tree = col?.tree;
    if (!col || !tree) return EMPTY;

    const product = options.product?.trim();
    const filter = { ...options.filter };
    // Asked of the API rather than filtered here, so the limit is spent on the product being read.
    if (product && tree.product) filter[tree.product] = product;

    let items: Item[];
    let truncated: boolean;
    try {
        ({ items, truncated } = await listAllCollection(config, key, {
            limit: limitOf(tree),
            pageSize: 100,
            ...(Object.keys(filter).length > 0 ? { filter } : {}),
        }));
    } catch {
        return EMPTY;
    }

    const wanted = product ? items.filter((i) => i.product === undefined || i.product === product) : items;
    const bySlug = new Map(wanted.filter((i) => i.slug).map((i) => [i.slug, i]));

    const sections = sectionOrder(wanted, tree.sections).map((name) => ({
        ...(name === undefined ? {} : { name }),
        nodes: withHrefs(
            nest(
                wanted.filter((i) => i.section === name),
                bySlug,
            ),
            col.route,
        ),
    }));

    return { sections, order: flattenTree(sections), truncated };
}

/*
 * `TREE_LIMIT` is the ceiling and not only the default. A tenant's number is already held to it in
 * site.ts, and a build-time config passing `collections` straight in was not: a typo there is an
 * unbounded run of reads against the CMS on every render of every page in the collection.
 */
function limitOf(tree: CollectionTree): number {
    const asked = tree.limit;
    return typeof asked === "number" && Number.isInteger(asked) && asked >= 1 ? Math.min(asked, TREE_LIMIT) : TREE_LIMIT;
}

export interface TreeNeighbours {
    previous?: Item;
    next?: Item;
}

/** The items either side of a slug in reading order. Both undefined for a slug the tree does not hold. */
export function treeNeighbours(order: readonly Item[], slug: string): TreeNeighbours {
    const at = order.findIndex((i) => i.slug === slug);
    if (at < 0) return {};
    return {
        ...(at > 0 ? { previous: order[at - 1] } : {}),
        ...(at < order.length - 1 ? { next: order[at + 1] } : {}),
    };
}

/**
 * The products a tree offers, with the one being read marked.
 *
 * A destination that is neither a site path nor an http or https URL is dropped rather than rendered,
 * the same rule every other configured link goes through, since these come from a tenant's settings.
 */
export function treeProducts(
    config: PressConfig,
    key: string,
    current?: string,
): (TreeProduct & { current: boolean })[] {
    const products = collectionOf(config, key)?.tree?.products ?? [];
    return products.flatMap((p) => {
        const href = siteHref(p.href);
        if (!p.key || !p.label || !href) return [];
        return [{ key: p.key, label: p.label, href, current: p.key === current }];
    });
}

/*
 * Trimmed without a regular expression, the same as site.ts does it: CodeQL reads `\/+$` on input
 * somebody else writes as a slow scan on a long run of slashes.
 */
function trimSlashes(value: string): string {
    let start = 0;
    let end = value.length;
    while (start < end && value.charCodeAt(start) === 47) start++;
    while (end > start && value.charCodeAt(end - 1) === 47) end--;
    return value.slice(start, end);
}

/** Where an item is written, from the tree's `editBase` and the item's own path. Undefined without both. */
export function editHref(config: PressConfig, item: Pick<Item, "collection" | "slug" | "editPath">): string | undefined {
    const base = collectionOf(config, item.collection)?.tree?.editBase;
    const tail = item.editPath || item.slug;
    if (!base || !tail) return undefined;
    let end = base.length;
    while (end > 0 && base.charCodeAt(end - 1) === 47) end--;
    return siteHref(`${base.slice(0, end)}/${trimSlashes(tail)}`);
}
