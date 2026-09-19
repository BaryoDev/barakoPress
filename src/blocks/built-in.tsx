import Link from "next/link";
import type { PressConfig } from "../config.js";
import { showsHoldingPage, siteConfigOrNull } from "../site.js";
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
    component: ({ slots }) => (
        <div
            style={{
                display: "grid",
                // Stacks on a narrow screen instead of squeezing four columns into it.
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
                gap: "32px",
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
                    padding: "32px",
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
                        fontSize: "26px",
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
                        marginTop: "20px",
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

/*
 * The collections offered are the ones this site has a route for, so an editor cannot pick one that
 * renders nothing. The names are the config's keys, not content type names. A request-time site takes
 * any name instead: each tenant's collections come from its own settings, a registry is built once for
 * all of them, and a name the tenant does not have renders nothing.
 */
function collection(config: PressConfig): BlockDefinition {
    const options = Object.entries(config.collections)
        .filter(([, c]) => c.route !== undefined)
        .map(([key]) => key);

    return defineBlock<CollectionBlockProps>({
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
            // The registry is built once at module scope, so the tenant is resolved here, per request.
            // Not siteConfig: its notFound() while holding would replace a holding page that contains
            // this block with a 404. A holding page lists nothing from the site behind it.
            const site = await siteConfigOrNull(config);
            if (!site || (await showsHoldingPage(site))) return null;
            const filter =
                props.filterField && props.filterValue ? { [props.filterField]: props.filterValue } : undefined;
            const items = await collectionItems(site, props.collection, props.limit ?? 6, filter);
            if (items.length === 0) return null;
            const c = theme.colors;
            return (
                <section>
                    {props.heading && (
                        <h2
                            style={{
                                margin: "0 0 20px",
                                fontFamily: theme.fonts.heading,
                                fontWeight: 600,
                                fontSize: "26px",
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
                                    padding: "20px",
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
                                            fontSize: "12.5px",
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
}

export function builtInBlocks(config: PressConfig): BlockDefinition[] {
    return [...primitiveBlocks(config), ...dataBlocks(config), columns, callToAction, collection(config)];
}
