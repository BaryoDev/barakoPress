import Link from "next/link";
import type { PressConfig } from "../config.js";
import { formatDate } from "../cms.js";
import { collectionOf, listCollection } from "../collections.js";
import { PROSE_CLASS, primitiveBlocks } from "./primitives.js";
import { dataBlocks } from "./data.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * The blocks every site gets: the primitives and the data blocks of barakoPress #33, plus the named
 * blocks that shipped before them.
 *
 * `columns`, `callToAction` and `collection` are here rather than in primitives.tsx because each is
 * an arrangement or a behaviour rather than a part. `columns` is what `row` and `grid` do with
 * tokens, and it stays because pages store it. `callToAction` is the shape a preset will take in
 * 0.6.0. `collection` reads the CMS, which #33 keeps in code.
 *
 * Styled inline from the theme for the reason the post screen is (see post-view.tsx): a stylesheet
 * the consumer may not import is a look somebody does not get.
 */

/** The class the page's generated body stylesheet is scoped to. */
export const BLOCK_PROSE_CLASS = PROSE_CLASS;

const columns = defineBlock<{}, "columns">({
    type: "columns",
    label: "Columns",
    layer: "block",
    fields: [{ name: "columns", kind: "slots", label: "Columns", required: true, min: 1, max: 4 }],
    component: ({ slots, theme }) => (
        <div
            style={{
                display: "grid",
                // Stacks on a narrow screen instead of squeezing four columns into it.
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
                gap: theme.space.lg,
            }}
        >
            {(slots.columns ?? []).map((column, i) => (
                <div key={i}>{column}</div>
            ))}
        </div>
    ),
});

const callToAction = defineBlock<{ heading: string; text?: string; label: string; href: string }>({
    type: "callToAction",
    label: "Call to action",
    layer: "block",
    fields: [
        { name: "heading", kind: "text", label: "Heading", required: true },
        { name: "text", kind: "text", label: "Text" },
        { name: "label", kind: "text", label: "Button label", required: true },
        { name: "href", kind: "url", label: "Button link", required: true },
    ],
    component: ({ props, theme }) => {
        const c = theme.colors;
        const external = /^https?:/i.test(props.href.trim());
        return (
            <aside
                style={{
                    padding: theme.space.lg,
                    borderRadius: theme.radii.panel,
                    background: c.accentTint,
                    border: `1px solid ${c.accentTintBorder}`,
                }}
            >
                <h2
                    style={{
                        margin: 0,
                        fontFamily: theme.fonts.heading,
                        fontWeight: 600,
                        fontSize: theme.text.title,
                        letterSpacing: "-.03em",
                        color: c.ink,
                    }}
                >
                    {props.heading}
                </h2>
                {props.text && (
                    <p style={{ margin: "12px 0 0", color: c.secondaryInk, lineHeight: 1.6 }}>
                        {props.text}
                    </p>
                )}
                <a
                    href={props.href.trim()}
                    rel={external ? "noopener noreferrer" : undefined}
                    style={{
                        display: "inline-block",
                        marginTop: theme.space.md,
                        padding: "11px 20px",
                        borderRadius: theme.radii.control,
                        background: c.accent,
                        color: c.surface,
                        fontWeight: 600,
                        textDecoration: "none",
                    }}
                >
                    {props.label}
                </a>
            </aside>
        );
    },
});

export interface CollectionItem {
    href: string;
    title: string;
    date?: string;
    summary?: string;
    /** From the collection's `colorBy` option, when the site maps that option to a colour. */
    color?: string;
}

/** The most a collection block lists. The API caps a page anyway; this keeps the schema honest. */
export const MAX_COLLECTION_ITEMS = 24;

/*
 * What a collection block lists: the items of a collection with a route, filtered by a field when the
 * block names one. Never throws: a block is part of a page, and a page must not fail because one embed
 * could not reach the CMS.
 */
export async function collectionItems(
    config: PressConfig,
    which: string,
    limit: number,
    filter?: Record<string, string>,
): Promise<CollectionItem[]> {
    try {
        const route = collectionOf(config, which)?.route;
        if (route === undefined) return [];
        const { items } = await listCollection(config, which, { pageSize: limit, filter });
        return items
            .filter((item) => item.slug)
            .map((item) => ({
                href: `${route}/${item.slug}`,
                title: item.title,
                date: item.date ? formatDate(config, item.date) : undefined,
                summary: item.summary,
                ...(item.color ? { color: item.color } : {}),
            }));
    } catch {
        return [];
    }
}

type CollectionBlockProps = {
    collection: string;
    limit?: number;
    heading?: string;
    filterField?: string;
    filterValue?: string;
};

/** Definitions this package built, so `boundToSite` rebinds only its own. Held by identity. */
const readsTheSite = new WeakSet<BlockDefinition>();

/*
 * The collections offered are the ones this site has a route for, so an editor cannot pick one that
 * renders nothing. The names are the config's keys, not content type names. A request-time site takes
 * any name instead: each tenant's collections come from its own settings, a registry is built once for
 * all of them, and a name the tenant does not have renders nothing.
 */
function collection(config: PressConfig, holding = false): BlockDefinition {
    const options = Object.entries(config.collections)
        .filter(([, c]) => c.route !== undefined)
        .map(([key]) => key);

    const definition = defineBlock<CollectionBlockProps>({
        type: "collection",
        label: "Collection",
        layer: "block",
        fields: [
            config.sites
                ? { name: "collection", kind: "text", label: "Collection", required: true }
                : { name: "collection", kind: "select", label: "Collection", required: true, options },
            { name: "limit", kind: "number", label: "How many", min: 1, max: MAX_COLLECTION_ITEMS },
            { name: "heading", kind: "text", label: "Heading" },
            { name: "filterField", kind: "text", label: "Only items whose field" },
            { name: "filterValue", kind: "text", label: "Holds the value" },
        ],
        component: async ({ props, theme }) => {
            // A holding page lists nothing from the site behind it, and the holding document says so
            // rather than this asking again: a block that resolved the request itself would read a
            // header, and the page holding it would lose its place in the render cache (#55).
            if (holding) return null;
            const filter =
                props.filterField && props.filterValue ? { [props.filterField]: props.filterValue } : undefined;
            const items = await collectionItems(config, props.collection, props.limit ?? 6, filter);
            if (items.length === 0) return null;
            const c = theme.colors;
            return (
                <section>
                    {props.heading && (
                        <h2
                            style={{
                                margin: `0 0 ${theme.space.md}`,
                                fontFamily: theme.fonts.heading,
                                fontWeight: 600,
                                fontSize: theme.text.title,
                                letterSpacing: "-.03em",
                                color: c.ink,
                            }}
                        >
                            {props.heading}
                        </h2>
                    )}
                    <ul
                        style={{
                            listStyle: "none",
                            margin: 0,
                            padding: 0,
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
                            gap: "16px",
                        }}
                    >
                        {items.map((item) => (
                            <li
                                key={item.href}
                                style={{
                                    padding: theme.space.md,
                                    borderRadius: theme.radii.panel,
                                    background: c.surface,
                                    border: `1px solid ${c.hairline}`,
                                    ...(item.color ? { borderLeft: `4px solid ${item.color}` } : {}),
                                }}
                            >
                                <Link
                                    href={item.href}
                                    style={{ color: c.ink, fontWeight: 600, textDecoration: "none" }}
                                >
                                    {item.title}
                                </Link>
                                {item.date && (
                                    <p
                                        style={{
                                            margin: "8px 0 0",
                                            fontFamily: theme.fonts.mono,
                                            fontSize: theme.text.meta,
                                            color: c.muted,
                                        }}
                                    >
                                        {item.date}
                                    </p>
                                )}
                                {item.summary && (
                                    <p style={{ margin: "8px 0 0", color: c.secondaryInk, lineHeight: 1.6 }}>
                                        {item.summary}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            );
        },
    });

    readsTheSite.add(definition);
    return definition;
}

export function builtInBlocks(config: PressConfig): BlockDefinition[] {
    return [...primitiveBlocks(config), ...dataBlocks(config), columns, callToAction, collection(config)];
}

/*
 * Blocks that read the site rather than only their props, rebound to the config a request resolved
 * (barakoPress #55).
 *
 * A registry is built once, at module scope, from the site's own config. On a request-time site
 * that config names no tenant, so a block that reads the CMS used to resolve the tenant itself,
 * out of the request headers, once per block per view. That read is what kept every page holding
 * one off the render cache. The request resolves the site once now, and `registryFor` hands the
 * resolved config to the blocks that need it.
 *
 * Only blocks this package built are rebound. A site that registered its own `collection` keeps
 * its own: the definitions are held by identity, so nothing is matched by name.
 */
export function boundToSite(
    registry: ReadonlyMap<string, BlockDefinition>,
    config: PressConfig,
    holding: boolean,
): ReadonlyMap<string, BlockDefinition> {
    let bound: Map<string, BlockDefinition> | undefined;
    for (const [type, definition] of registry) {
        if (!readsTheSite.has(definition)) continue;
        bound ??= new Map(registry);
        bound.set(type, collection(config, holding));
    }
    return bound ?? registry;
}
