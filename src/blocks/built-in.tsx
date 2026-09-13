import Link from "next/link";
import type { PressConfig } from "../config.js";
import { formatDate, listPosts, listTerms } from "../cms.js";
import { renderMarkdown } from "../markdown.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * The blocks every site gets: rich text, image, columns, call to action and a collection embed.
 *
 * Styled inline from the theme for the reason the post screen is (see post-view.tsx): a stylesheet
 * the consumer may not import is a look somebody does not get. Rich text is the exception, because
 * rendered markdown is a string inline styles cannot reach, so the page emits `proseCss` for it.
 */

/** The class the page's generated body stylesheet is scoped to. */
export const BLOCK_PROSE_CLASS = "bp-prose";

const richText = defineBlock<{ markdown: string }>({
    type: "richText",
    label: "Rich text",
    fields: [{ name: "markdown", kind: "markdown", label: "Text", required: true }],
    component: ({ props, theme }) => (
        <div
            className={BLOCK_PROSE_CLASS}
            style={{ maxWidth: theme.layout.prose }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(props.markdown) }}
        />
    ),
});

const image = defineBlock<{ src: string; alt?: string; caption?: string }>({
    type: "image",
    label: "Image",
    fields: [
        { name: "src", kind: "url", label: "Image URL", required: true },
        { name: "alt", kind: "text", label: "Alternative text" },
        { name: "caption", kind: "text", label: "Caption" },
    ],
    component: ({ props, theme }) => (
        <figure style={{ margin: 0 }}>
            <img
                src={props.src}
                alt={props.alt ?? ""}
                loading="lazy"
                style={{
                    display: "block",
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: theme.radii.panel,
                    border: `1px solid ${theme.colors.hairline}`,
                }}
            />
            {props.caption && (
                <figcaption
                    style={{
                        marginTop: "10px",
                        fontFamily: theme.fonts.mono,
                        fontSize: "12.5px",
                        color: theme.colors.muted,
                    }}
                >
                    {props.caption}
                </figcaption>
            )}
        </figure>
    ),
});

const columns = defineBlock<{}, "columns">({
    type: "columns",
    label: "Columns",
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

type CollectionName = "post" | "author" | "category";

export interface CollectionItem {
    href: string;
    title: string;
    date?: string;
    summary?: string;
}

/** The most a collection block lists. The API caps a page anyway; this keeps the schema honest. */
export const MAX_COLLECTION_ITEMS = 24;

/*
 * What a collection block lists. Never throws: a block is part of a page, and a page must not fail
 * because one embed could not reach the CMS.
 */
export async function collectionItems(
    config: PressConfig,
    which: CollectionName,
    limit: number,
): Promise<CollectionItem[]> {
    try {
        if (which === "post") {
            const { posts } = await listPosts(config, { pageSize: limit });
            return posts
                .filter((p) => p.slug)
                .map((p) => ({
                    href: `${config.routes.post}/${p.slug}`,
                    title: p.title,
                    date: p.publishedAt ? formatDate(config, p.publishedAt) : undefined,
                    summary: p.excerpt,
                }));
        }
        const route = config.routes[which];
        if (!route) return [];
        const terms = await listTerms(config, which, limit);
        return terms.filter((t) => t.slug).map((t) => ({ href: `${route}/${t.slug}`, title: t.name }));
    } catch {
        return [];
    }
}

/*
 * The collections offered are the ones this site has a type and a route for, so an editor cannot
 * pick one that renders nothing. The names are the config's keys, not content type names.
 */
function collection(config: PressConfig): BlockDefinition {
    const options: CollectionName[] = ["post"];
    if (config.types.author && config.routes.author) options.push("author");
    if (config.types.category && config.routes.category) options.push("category");

    return defineBlock<{ collection: CollectionName; limit?: number; heading?: string }>({
        type: "collection",
        label: "Collection",
        fields: [
            { name: "collection", kind: "select", label: "Collection", required: true, options },
            { name: "limit", kind: "number", label: "How many", min: 1, max: MAX_COLLECTION_ITEMS },
            { name: "heading", kind: "text", label: "Heading" },
        ],
        component: async ({ props, theme }) => {
            const items = await collectionItems(config, props.collection, props.limit ?? 6);
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
    return [richText, image, columns, callToAction, collection(config)];
}
