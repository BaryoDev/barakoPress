import type { ReactNode } from "react";
import Link from "next/link";
import type { PressConfig } from "../config.js";
import type { Item } from "../collections.js";
import { collectionOf } from "../collections.js";
import { editHref, treeProducts, type CollectionTreeResult, type TreeNode } from "../tree.js";
import { SearchKeys, SEARCH_ROOT_ATTR } from "../blocks/search-keys.js";

/*
 * The chrome a documentation collection draws around its pages (#23): a sidebar of the tree, a
 * product switcher, a search box, previous and next, and a link to wherever the page is written.
 *
 * Each is a component and a block, over one implementation. The item page needs them without a page
 * of blocks behind it, since a collection item is not a page; a landing page needs them without an
 * item, since it is not one. Writing the sidebar twice is how the two drift.
 *
 * Styled inline from the theme for the reason the article layout is: `barakopress/styles.css` is
 * opt-in, and a sidebar whose look depends on an import the consumer might not make is a sidebar
 * that renders as a bare list for somebody.
 *
 * Nothing here is a client component except the key handling, which is an enhancement over markup
 * that already works: the search box is a form, the results are links, and a reader with no script
 * gets both.
 */

/** Marks the collapsed sidebar so its own summary can be hidden above the phone breakpoint. */
const SIDEBAR_CLASS = "bp-tree-nav";

/** The width the sidebar stops being a sidebar at, which is where a phone is. */
const PHONE = "48rem";

function sidebarCss(): string {
    return (
        `.${SIDEBAR_CLASS}>summary{list-style:none;cursor:pointer}` +
        `.${SIDEBAR_CLASS}>summary::-webkit-details-marker{display:none}` +
        `@media(min-width:${PHONE}){.${SIDEBAR_CLASS}>summary{display:none}}`
    );
}

export interface TreeSidebarProps {
    config: PressConfig;
    tree: CollectionTreeResult;
    /** The slug of the item being read, marked in the list and announced to a screen reader. */
    current?: string;
}

/**
 * The tree for one product, with the page being read marked.
 *
 * A `details` element rather than a button and a state, because a sidebar that collapses on a phone
 * is a disclosure and the browser already has one. It is open by default and the summary is hidden
 * above the phone breakpoint, so a wide screen sees the list and a narrow one sees a control.
 */
export function TreeSidebar({ config, tree, current }: TreeSidebarProps) {
    const t = config.theme;
    const c = t.colors;
    if (tree.sections.length === 0) return null;

    return (
        <details className={SIDEBAR_CLASS} open>
            <style dangerouslySetInnerHTML={{ __html: sidebarCss() }} />
            <summary
                style={{
                    padding: "10px 12px",
                    marginBottom: t.space.sm,
                    borderRadius: t.radii.control,
                    border: `1px solid ${c.hairline}`,
                    background: c.surface,
                    fontFamily: t.fonts.mono,
                    fontSize: t.text.meta,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: c.muted,
                }}
            >
                {config.labels.contents}
            </summary>
            <nav aria-label={config.labels.contents} style={{ display: "flex", flexDirection: "column", gap: t.space.md }}>
                {tree.sections.map((section, i) => (
                    <div key={section.name ?? `#${i}`}>
                        {section.name && (
                            <p
                                style={{
                                    margin: `0 0 ${t.space.xs}`,
                                    fontFamily: t.fonts.mono,
                                    fontSize: t.text.meta,
                                    letterSpacing: ".14em",
                                    textTransform: "uppercase",
                                    color: c.muted,
                                }}
                            >
                                {section.name}
                            </p>
                        )}
                        <Branch config={config} nodes={section.nodes} current={current} depth={0} />
                    </div>
                ))}
            </nav>
        </details>
    );
}

function Branch({
    config,
    nodes,
    current,
    depth,
}: {
    config: PressConfig;
    nodes: TreeNode[];
    current?: string;
    depth: number;
}) {
    const t = config.theme;
    const c = t.colors;
    return (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, paddingLeft: depth === 0 ? 0 : t.space.md }}>
            {nodes.map((node) => {
                const here = Boolean(current) && node.item.slug === current;
                const style = {
                    display: "block",
                    padding: "6px 10px",
                    borderRadius: t.radii.control,
                    fontSize: t.text.small,
                    lineHeight: 1.45,
                    ...(here
                        ? { background: c.accentTint, color: c.accentInk, fontWeight: 600 }
                        : { color: c.secondaryInk }),
                } as const;
                return (
                    <li key={node.item.id || node.item.slug}>
                        {node.href && !here ? (
                            <Link href={node.href} style={style}>
                                {node.item.title}
                            </Link>
                        ) : (
                            <span style={style} aria-current={here ? "page" : undefined}>
                                {node.item.title}
                            </span>
                        )}
                        {node.children.length > 0 && (
                            <Branch config={config} nodes={node.children} current={current} depth={depth + 1} />
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

export interface TreeSwitcherProps {
    config: PressConfig;
    collection: string;
    /** The product key being read. The switcher marks it and does not link it. */
    current?: string;
}

/** The products a tree offers, from the tenant's settings. Nothing at all when it offers none. */
export function TreeSwitcher({ config, collection, current }: TreeSwitcherProps) {
    const t = config.theme;
    const c = t.colors;
    const products = treeProducts(config, collection, current);
    if (products.length === 0) return null;

    return (
        <nav aria-label={config.labels.products} style={{ display: "flex", flexWrap: "wrap", gap: t.space.xs }}>
            {products.map((p) => {
                const style = {
                    padding: "6px 12px",
                    borderRadius: t.radii.pill,
                    fontSize: t.text.small,
                    fontWeight: 600,
                    ...(p.current
                        ? { background: c.accent, color: c.inverseInk }
                        : { background: c.surface, border: `1px solid ${c.hairline}`, color: c.secondaryInk }),
                } as const;
                return p.current ? (
                    <span key={p.key} style={style} aria-current="true">
                        {p.label}
                    </span>
                ) : (
                    <Link key={p.key} href={p.href} style={style}>
                        {p.label}
                    </Link>
                );
            })}
        </nav>
    );
}

export interface TreePagerProps {
    config: PressConfig;
    collection: string;
    previous?: Item;
    next?: Item;
}

/** Previous and next in reading order. Nothing when the item is alone, or the collection has no route. */
export function TreePager({ config, collection, previous, next }: TreePagerProps) {
    const t = config.theme;
    const c = t.colors;
    const route = collectionOf(config, collection)?.route;
    if (route === undefined || (!previous && !next)) return null;

    const box = {
        flex: "1 1 220px",
        minWidth: 0,
        padding: "16px 18px",
        borderRadius: t.radii.panel,
        border: `1px solid ${c.hairline}`,
        background: c.surface,
    } as const;
    const label = { margin: 0, fontFamily: t.fonts.mono, fontSize: t.text.meta, color: c.muted } as const;
    const title = { margin: `${t.space.xs} 0 0`, fontSize: t.text.small, fontWeight: 600, color: c.ink } as const;

    return (
        <nav
            aria-label={`${config.labels.previous} / ${config.labels.next}`}
            style={{ marginTop: t.space.lg, display: "flex", flexWrap: "wrap", gap: t.space.sm }}
        >
            {previous && (
                <Link href={`${route}/${previous.slug}`} rel="prev" style={box}>
                    <p style={label}>{config.labels.previous}</p>
                    <p style={title}>{previous.title}</p>
                </Link>
            )}
            {next && (
                <Link href={`${route}/${next.slug}`} rel="next" style={{ ...box, textAlign: "right" }}>
                    <p style={label}>{config.labels.next}</p>
                    <p style={title}>{next.title}</p>
                </Link>
            )}
        </nav>
    );
}

/** Where the page being read is written. Nothing unless the collection's tree names a base. */
export function EditLink({ config, item }: { config: PressConfig; item: Item }) {
    const href = editHref(config, item);
    if (!href) return null;
    const t = config.theme;
    return (
        <p style={{ marginTop: t.space.md, fontFamily: t.fonts.mono, fontSize: t.text.meta }}>
            <a href={href} rel="noopener noreferrer" style={{ color: t.colors.muted }}>
                {config.labels.editPage}
            </a>
        </p>
    );
}

export interface SearchBoxProps {
    config: PressConfig;
    /** Where the form submits. The collection's index unless the caller names somewhere else. */
    action: string;
    /** The name of the URL parameter the query travels in. */
    param: string;
    /** What the reader typed, echoed back into the box. */
    query?: string;
    /** What matched, already read. Undefined means no search was run, which is not the same as none. */
    results?: { href?: string; title: string; summary?: string }[];
    /** A stable id, so the key handling finds this box and not another one on the same page. */
    id: string;
}

/**
 * A search box over a collection, as a form.
 *
 * The query is a URL parameter and the results are server rendered, so a result is a link somebody can
 * copy, open in a tab or reach with no script at all. `SearchKeys` adds what a form cannot do on its
 * own: focus on "/", the arrow keys walking the results, and escape clearing the box. It is the only
 * client code in the package, it is handed an id and nothing else, and without it everything here
 * still works.
 */
export function SearchBox({ config, action, param, query, results, id }: SearchBoxProps) {
    const t = config.theme;
    const c = t.colors;
    const typed = (query ?? "").trim();

    return (
        <div {...{ [SEARCH_ROOT_ATTR]: id }}>
            <form role="search" method="get" action={action}>
                <label
                    htmlFor={id}
                    style={{
                        display: "block",
                        marginBottom: t.space.xs,
                        fontFamily: t.fonts.mono,
                        fontSize: t.text.meta,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: c.muted,
                    }}
                >
                    {config.labels.search}
                </label>
                <input
                    id={id}
                    type="search"
                    name={param}
                    defaultValue={query}
                    placeholder={config.labels.search}
                    autoComplete="off"
                    style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "9px 12px",
                        borderRadius: t.radii.control,
                        border: `1px solid ${c.hairline}`,
                        background: c.surface,
                        color: c.ink,
                        font: "inherit",
                        fontSize: t.text.small,
                    }}
                />
            </form>

            {results !== undefined && typed !== "" && (
                <div aria-live="polite" style={{ marginTop: t.space.sm }}>
                    {results.length === 0 ? (
                        <p style={{ margin: 0, fontSize: t.text.small, color: c.muted }}>{config.labels.searchEmpty}</p>
                    ) : (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
                            {results.map((hit, i) => (
                                <li key={hit.href ?? `${i}-${hit.title}`}>
                                    {hit.href ? (
                                        <Link
                                            href={hit.href}
                                            style={{
                                                display: "block",
                                                padding: "7px 10px",
                                                borderRadius: t.radii.control,
                                                fontSize: t.text.small,
                                                color: c.ink,
                                            }}
                                        >
                                            {hit.title}
                                        </Link>
                                    ) : (
                                        <span style={{ display: "block", padding: "7px 10px", fontSize: t.text.small }}>
                                            {hit.title}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <SearchKeys id={id} />
        </div>
    );
}

/**
 * A page with a sidebar: the chrome on the left, the page on the right, stacked on a phone.
 *
 * Flex with a wrapping basis rather than a grid with media queries, so the same markup is a column on
 * a narrow screen and two columns on a wide one with nothing to keep in step.
 */
export function TreeShell({
    config,
    aside,
    children,
}: {
    config: PressConfig;
    aside: ReactNode;
    children: ReactNode;
}) {
    const t = config.theme;
    return (
        <div
            style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: t.space.lg,
                maxWidth: t.layout.wide,
                margin: "0 auto",
                padding: `${t.space.lg} ${t.layout.gutter}`,
            }}
        >
            <aside style={{ flex: "1 1 240px", minWidth: 0, maxWidth: "280px", display: "flex", flexDirection: "column", gap: t.space.md }}>
                {aside}
            </aside>
            <div style={{ flex: "999 1 520px", minWidth: 0 }}>{children}</div>
        </div>
    );
}
