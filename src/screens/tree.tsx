import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { PressConfig, TreeVariant } from "../config.js";
import type { Item } from "../collections.js";
import { collectionOf } from "../collections.js";
import type { MarkdownHeading } from "../markdown.js";
import {
    editHref,
    treeProducts,
    type CollectionTreeResult,
    type TreeNode,
    type TreeSearchEntry,
} from "../tree.js";
import {
    SearchKeys,
    SEARCH_EMPTY_ATTR,
    SEARCH_INDEX_ATTR,
    SEARCH_ROOT_ATTR,
    SEARCH_TEXT_ATTR,
} from "../blocks/search-keys.js";

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
 * Every colour, gap, radius and size is read through `var(--t-tree-<name>, <the theme's value>)`
 * (#130). A site that sets none of them draws exactly what it drew before; a site that names a
 * token, in its `Tokens` setting or in its own stylesheet, restyles that one thing. Each part also
 * carries a `bp-tree-*` class, so a stylesheet can reach what a token does not, a hover for one.
 * The layouts a token cannot express are the `variant` props.
 *
 * Nothing here is a client component except the key handling, which is an enhancement over markup
 * that already works: the search box is a form, the results are links, and a reader with no script
 * gets both.
 */

/*
 * A tree token, with the value the part has always had as its fallback.
 *
 * `--t-` because that is where a tenant's `Tokens` land (#125), so a token named `tree-link-ink` in
 * the settings restyles the sidebar's links with no stylesheet. A stylesheet can set the same names
 * with any value CSS takes, which is how a weight or a unitless line height is set, since a token in
 * the settings is held to a colour, a length or a font stack.
 */
function tok(name: string, fallback: string): string {
    return `var(--t-tree-${name}, ${fallback})`;
}

/** A value from the theme going into a generated stylesheet, stripped of what could end a rule. */
function cssValue(value: string): string {
    return value.replace(/[<>{};]/g, "");
}

/** Marks the collapsed sidebar so its own summary can be hidden above the phone breakpoint. */
const SIDEBAR_CLASS = "bp-tree-nav";

/** The width the sidebar stops being a sidebar at, which is where a phone is. */
const PHONE = "48rem";

/** The width the rail gives its room back to the page at. */
const RAIL_MIN = "64rem";

function sidebarCss(): string {
    return (
        `.${SIDEBAR_CLASS}>summary{list-style:none;cursor:pointer}` +
        `.${SIDEBAR_CLASS}>summary::-webkit-details-marker{display:none}` +
        `@media(min-width:${PHONE}){.${SIDEBAR_CLASS}>summary{display:none}}`
    );
}

/** A section label, the switcher's label in a list and the rail's heading: one look for all three. */
function labelStyle(config: PressConfig): CSSProperties {
    const t = config.theme;
    return {
        fontFamily: t.fonts.mono,
        fontSize: tok("label-size", t.text.meta),
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: tok("label-ink", t.colors.muted),
    };
}

/** A row in the sidebar: a page of the tree, or a product in the list switcher. */
function linkStyle(config: PressConfig, here: boolean): CSSProperties {
    const t = config.theme;
    const c = t.colors;
    return {
        display: "block",
        padding: `${tok("link-pad-y", "6px")} ${tok("link-pad-x", "10px")}`,
        borderRadius: tok("link-radius", t.radii.control),
        fontSize: tok("link-size", t.text.small),
        lineHeight: tok("link-leading", "1.45"),
        ...(here
            ? {
                  background: tok("link-current-bg", c.accentTint),
                  color: tok("link-current-ink", c.accentInk),
                  fontWeight: tok("link-current-weight", "600"),
              }
            : { color: tok("link-ink", c.secondaryInk), fontWeight: tok("link-weight", "inherit") }),
    };
}

function linkClass(here: boolean, extra?: string): string {
    return ["bp-tree-link", here ? "bp-tree-link-current" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface TreeSidebarProps {
    config: PressConfig;
    tree: CollectionTreeResult;
    /** The slug of the item being read, marked in the list and announced to a screen reader. */
    current?: string;
    /**
     * Drawn inside the sidebar above the sections, and collapsed with them on a phone. The list
     * switcher goes here, so on a phone the products fold away with the pages.
     */
    switcher?: ReactNode;
}

/**
 * The tree for one product, with the page being read marked.
 *
 * A `details` element rather than a button and a state, because a sidebar that collapses on a phone
 * is a disclosure and the browser already has one. It is open by default and the summary is hidden
 * above the phone breakpoint, so a wide screen sees the list and a narrow one sees a control.
 */
export function TreeSidebar({ config, tree, current, switcher }: TreeSidebarProps) {
    const t = config.theme;
    const c = t.colors;
    if (tree.sections.length === 0 && !switcher) return null;

    const nav = tree.sections.length > 0 && (
        <nav
            aria-label={config.labels.contents}
            className="bp-tree-sections"
            style={{ display: "flex", flexDirection: "column", gap: tok("section-gap", t.space.md) }}
        >
            {tree.sections.map((section, i) => (
                <div key={section.name ?? `#${i}`} className="bp-tree-section">
                    {section.name && (
                        <p
                            className="bp-tree-section-label"
                            style={{ margin: `0 0 ${tok("label-gap", t.space.xs)}`, ...labelStyle(config) }}
                        >
                            {section.name}
                        </p>
                    )}
                    <Branch config={config} nodes={section.nodes} current={current} depth={0} />
                </div>
            ))}
        </nav>
    );

    return (
        <details className={`bp-tree-sidebar ${SIDEBAR_CLASS}`} open>
            <style dangerouslySetInnerHTML={{ __html: sidebarCss() }} />
            <summary
                className="bp-tree-summary"
                style={{
                    padding: "10px 12px",
                    marginBottom: t.space.sm,
                    borderRadius: tok("summary-radius", t.radii.control),
                    border: `1px solid ${tok("summary-edge", c.hairline)}`,
                    background: tok("summary-bg", c.surface),
                    fontFamily: t.fonts.mono,
                    fontSize: tok("label-size", t.text.meta),
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: tok("summary-ink", c.muted),
                }}
            >
                {config.labels.contents}
            </summary>
            {switcher ? (
                <div
                    className="bp-tree-sidebar-body"
                    style={{ display: "flex", flexDirection: "column", gap: tok("section-gap", t.space.md) }}
                >
                    {switcher}
                    {nav}
                </div>
            ) : (
                nav
            )}
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
    return (
        <ul
            className="bp-tree-list"
            style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                paddingLeft: depth === 0 ? 0 : tok("indent", t.space.md),
                display: "flex",
                flexDirection: "column",
                gap: tok("link-gap", "0px"),
            }}
        >
            {nodes.map((node) => {
                const here = Boolean(current) && node.item.slug === current;
                const style = linkStyle(config, here);
                return (
                    <li key={node.item.id || node.item.slug} className="bp-tree-item">
                        {node.href && !here ? (
                            <Link href={node.href} className={linkClass(here)} style={style}>
                                {node.item.title}
                            </Link>
                        ) : (
                            <span className={linkClass(here)} style={style} aria-current={here ? "page" : undefined}>
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
    /** `tabs`, a row of pills, unless the collection's tree or this prop says `list`. */
    variant?: TreeVariant["switcher"];
}

/** The products a tree offers, from the tenant's settings. Nothing at all when it offers none. */
export function TreeSwitcher({ config, collection, current, variant }: TreeSwitcherProps) {
    const t = config.theme;
    const c = t.colors;
    const products = treeProducts(config, collection, current);
    if (products.length === 0) return null;

    if ((variant ?? treeVariant(config, collection).switcher) === "list") {
        return (
            <nav aria-label={config.labels.products} className="bp-tree-switcher bp-tree-switcher-list">
                <p className="bp-tree-switcher-label" style={{ margin: `0 0 ${tok("label-gap", t.space.xs)}`, ...labelStyle(config) }}>
                    {config.labels.products}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: tok("link-gap", "0px") }}>
                    {products.map((p) => {
                        const style = linkStyle(config, p.current);
                        const className = linkClass(p.current, "bp-tree-product");
                        const note = p.note && (
                            <span
                                className="bp-tree-product-note"
                                style={{
                                    marginLeft: tok("note-gap", "6px"),
                                    fontSize: tok("note-size", t.text.meta),
                                    fontWeight: tok("note-weight", "inherit"),
                                    color: tok("note-ink", c.muted),
                                }}
                            >
                                {p.note}
                            </span>
                        );
                        return p.current ? (
                            <span key={p.key} className={className} style={style} aria-current="true">
                                {p.label}
                                {note}
                            </span>
                        ) : (
                            <Link key={p.key} href={p.href} className={className} style={style}>
                                {p.label}
                                {note}
                            </Link>
                        );
                    })}
                </div>
            </nav>
        );
    }

    return (
        <nav
            aria-label={config.labels.products}
            className="bp-tree-switcher bp-tree-switcher-tabs"
            style={{ display: "flex", flexWrap: "wrap", gap: tok("tab-gap", t.space.xs) }}
        >
            {products.map((p) => {
                const style = {
                    padding: `${tok("tab-pad-y", "6px")} ${tok("tab-pad-x", "12px")}`,
                    borderRadius: tok("tab-radius", t.radii.pill),
                    fontSize: tok("tab-size", t.text.small),
                    fontWeight: tok("tab-weight", "600"),
                    ...(p.current
                        ? { background: tok("tab-current-bg", c.accent), color: tok("tab-current-ink", c.inverseInk) }
                        : {
                              background: tok("tab-bg", c.surface),
                              border: `1px solid ${tok("tab-edge", c.hairline)}`,
                              color: tok("tab-ink", c.secondaryInk),
                          }),
                } as const;
                return p.current ? (
                    <span key={p.key} className="bp-tree-tab bp-tree-tab-current" style={style} aria-current="true">
                        {p.label}
                    </span>
                ) : (
                    <Link key={p.key} href={p.href} className="bp-tree-tab" style={style}>
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
    /** `wide` unless the collection's tree or this prop says `halves`. */
    variant?: TreeVariant["pager"];
}

/** Previous and next in reading order. Nothing when the item is alone, or the collection has no route. */
export function TreePager({ config, collection, previous, next, variant }: TreePagerProps) {
    const t = config.theme;
    const c = t.colors;
    const route = collectionOf(config, collection)?.route;
    if (route === undefined || (!previous && !next)) return null;
    const halves = (variant ?? treeVariant(config, collection).pager) === "halves";

    const box = {
        flex: halves ? "1 1 0%" : "1 1 220px",
        minWidth: 0,
        padding: `${tok("pager-pad-y", "16px")} ${tok("pager-pad-x", "18px")}`,
        borderRadius: tok("pager-radius", t.radii.panel),
        border: `1px solid ${tok("pager-edge", c.hairline)}`,
        background: tok("pager-bg", c.surface),
    } as const;
    const label = {
        margin: 0,
        fontFamily: t.fonts.mono,
        fontSize: tok("pager-label-size", t.text.meta),
        color: tok("pager-label-ink", c.muted),
    } as const;
    const title = {
        margin: `${tok("pager-title-gap", t.space.xs)} 0 0`,
        fontSize: tok("pager-title-size", t.text.small),
        fontWeight: tok("pager-title-weight", "600"),
        color: tok("pager-title-ink", c.ink),
    } as const;
    // Holds the missing half, so next stays on the right when there is no previous.
    const empty = halves && <div className="bp-tree-pager-empty" aria-hidden="true" style={{ flex: "1 1 0%" }} />;

    return (
        <nav
            aria-label={`${config.labels.previous} / ${config.labels.next}`}
            className="bp-tree-pager"
            style={{
                marginTop: tok("pager-top", t.space.lg),
                display: "flex",
                flexWrap: halves ? "nowrap" : "wrap",
                gap: tok("pager-gap", t.space.sm),
            }}
        >
            {previous ? (
                <Link href={`${route}/${previous.slug}`} rel="prev" className="bp-tree-pager-link bp-tree-pager-prev" style={box}>
                    <p className="bp-tree-pager-label" style={label}>
                        {config.labels.previous}
                    </p>
                    <p className="bp-tree-pager-title" style={title}>
                        {previous.title}
                    </p>
                </Link>
            ) : (
                empty
            )}
            {next ? (
                <Link
                    href={`${route}/${next.slug}`}
                    rel="next"
                    className="bp-tree-pager-link bp-tree-pager-next"
                    style={{ ...box, textAlign: "right" }}
                >
                    <p className="bp-tree-pager-label" style={label}>
                        {config.labels.next}
                    </p>
                    <p className="bp-tree-pager-title" style={title}>
                        {next.title}
                    </p>
                </Link>
            ) : (
                empty
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
        <p className="bp-tree-edit" style={{ marginTop: tok("edit-top", t.space.md), fontFamily: t.fonts.mono, fontSize: t.text.meta }}>
            <a href={href} rel="noopener noreferrer" style={{ color: tok("edit-ink", t.colors.muted) }}>
                {config.labels.editPage}
            </a>
        </p>
    );
}

export interface SearchBoxProps {
    config: PressConfig;
    /**
     * Where the form submits. Unset only beside an `index`: the box then filters in the page, and a
     * reader with no script submits to the page they are on.
     */
    action?: string;
    /** The name of the URL parameter the query travels in. */
    param: string;
    /** What the reader typed, echoed back into the box. */
    query?: string;
    /** What matched, already read. Undefined means no search was run, which is not the same as none. */
    results?: { href?: string; title: string; summary?: string }[];
    /**
     * The tree's titles and headings, from `treeSearchIndex`. Drawn into the page hidden, and filtered
     * as the reader types by the same client code that handles the keys.
     */
    index?: readonly TreeSearchEntry[];
    /** A stable id, so the key handling finds this box and not another one on the same page. */
    id: string;
}

/** The most index entries shown at once while the reader types. */
const INDEX_SHOWN = 8;

/**
 * A search box over a collection, as a form.
 *
 * The query is a URL parameter and the results are server rendered, so a result is a link somebody can
 * copy, open in a tab or reach with no script at all. `SearchKeys` adds what a form cannot do on its
 * own: focus on "/", the arrow keys walking the results, escape clearing the box, and filtering an
 * index as the reader types. It is handed an id and nothing
 * else, and without it everything but the in-page filter still works.
 *
 * The index is markup, not props: a client component's props are serialised into the page, so handing
 * it the entries would ship each one twice.
 */
export function SearchBox({ config, action, param, query, results, index, id }: SearchBoxProps) {
    const t = config.theme;
    const c = t.colors;
    const typed = (query ?? "").trim();
    const hitStyle = {
        display: "block",
        padding: "7px 10px",
        borderRadius: tok("search-hit-radius", t.radii.control),
        fontSize: tok("search-size", t.text.small),
        color: tok("search-hit-ink", c.ink),
    } as const;
    const listStyle = {
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: tok("search-hit-gap", "2px"),
    } as const;
    const emptyStyle = { margin: 0, fontSize: tok("search-size", t.text.small), color: tok("search-empty-ink", c.muted) };

    return (
        <div className="bp-tree-search" {...{ [SEARCH_ROOT_ATTR]: id }}>
            <form role="search" method="get" action={action}>
                <label
                    htmlFor={id}
                    className="bp-tree-search-label"
                    style={{
                        display: "block",
                        marginBottom: tok("search-label-gap", t.space.xs),
                        fontFamily: t.fonts.mono,
                        fontSize: tok("label-size", t.text.meta),
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: tok("search-label-ink", c.muted),
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
                    className="bp-tree-search-input"
                    style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: `${tok("search-pad-y", "9px")} ${tok("search-pad-x", "12px")}`,
                        borderRadius: tok("search-radius", t.radii.control),
                        border: `1px solid ${tok("search-edge", c.hairline)}`,
                        background: tok("search-bg", c.surface),
                        color: tok("search-ink", c.ink),
                        font: "inherit",
                        fontSize: tok("search-size", t.text.small),
                    }}
                />
            </form>

            {results !== undefined && typed !== "" && (
                <div aria-live="polite" className="bp-tree-search-results" style={{ marginTop: tok("search-results-gap", t.space.sm) }}>
                    {results.length === 0 ? (
                        <p className="bp-tree-search-empty" style={emptyStyle}>
                            {config.labels.searchEmpty}
                        </p>
                    ) : (
                        <ul style={listStyle}>
                            {results.map((hit, i) => (
                                <li key={hit.href ?? `${i}-${hit.title}`}>
                                    {hit.href ? (
                                        <Link href={hit.href} className="bp-tree-search-hit" style={hitStyle}>
                                            {hit.title}
                                        </Link>
                                    ) : (
                                        <span className="bp-tree-search-hit" style={{ display: "block", padding: "7px 10px", fontSize: t.text.small }}>
                                            {hit.title}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Not beside the answer a route already gave, which would list the same pages twice. */}
            {index && index.length > 0 && (results === undefined || typed === "") && (
                <div
                    aria-live="polite"
                    hidden
                    className="bp-tree-search-results bp-tree-search-index"
                    style={{ marginTop: tok("search-results-gap", t.space.sm) }}
                    {...{ [SEARCH_INDEX_ATTR]: INDEX_SHOWN }}
                >
                    <ul style={listStyle}>
                        {index.map((entry) => (
                            <li
                                key={entry.href}
                                hidden
                                {...{ [SEARCH_TEXT_ATTR]: `${entry.heading ?? ""} ${entry.title}`.trim().toLowerCase() }}
                            >
                                <Link href={entry.href} className="bp-tree-search-hit" style={hitStyle}>
                                    <span className="bp-tree-search-hit-title" style={{ fontWeight: tok("search-hit-weight", "600") }}>
                                        {entry.heading ?? entry.title}
                                    </span>
                                    {entry.heading && (
                                        <span className="bp-tree-search-hit-page" style={{ color: tok("search-empty-ink", c.muted) }}>
                                            {" · "}
                                            {entry.title}
                                        </span>
                                    )}
                                </Link>
                            </li>
                        ))}
                    </ul>
                    <p className="bp-tree-search-empty" hidden style={emptyStyle} {...{ [SEARCH_EMPTY_ATTR]: "" }}>
                        {config.labels.searchEmpty}
                    </p>
                </div>
            )}

            <SearchKeys id={id} />
        </div>
    );
}

export interface TreeRailProps {
    config: PressConfig;
    /** The page's own headings, from `itemHeadings`. Nothing is drawn for none. */
    headings: readonly MarkdownHeading[];
}

/** The page's own headings as links, for the rail beside it. */
export function TreeRail({ config, headings }: TreeRailProps) {
    const t = config.theme;
    const c = t.colors;
    if (headings.length === 0) return null;
    return (
        <nav aria-label={config.labels.onThisPage} className="bp-tree-rail-nav">
            <p className="bp-tree-rail-label" style={{ margin: 0, ...labelStyle(config) }}>
                {config.labels.onThisPage}
            </p>
            <div style={{ marginTop: tok("rail-label-gap", t.space.sm), display: "flex", flexDirection: "column", gap: tok("rail-gap", "2px") }}>
                {headings.map((h, i) => (
                    <a
                        key={`${h.id}-${i}`}
                        href={`#${h.id}`}
                        className="bp-tree-rail-link"
                        style={{
                            padding: `${tok("rail-link-pad-y", "6px")} ${tok("rail-link-pad-x", "10px")}`,
                            borderLeft: `2px solid ${tok("rail-link-edge", c.hairline)}`,
                            fontSize: tok("rail-link-size", t.text.small),
                            fontWeight: tok("rail-link-weight", "inherit"),
                            color: tok("rail-link-ink", c.secondaryInk),
                        }}
                    >
                        {h.text}
                    </a>
                ))}
            </div>
        </nav>
    );
}

/** The collection's tree layout, every part at its default where the tree does not say. */
export function treeVariant(config: PressConfig, collection: string): Required<TreeVariant> {
    const v = collectionOf(config, collection)?.tree?.variant;
    return {
        switcher: v?.switcher ?? "tabs",
        sidebar: v?.sidebar ?? "plain",
        rail: v?.rail ?? false,
        pager: v?.pager ?? "wide",
    };
}

/*
 * Only what a style attribute cannot say: where the rail gives way, and how a boxed sidebar stacks on
 * a phone. The boxed rules carry `!important` because they undo the inline layout they sit over.
 */
function shellCss(config: PressConfig): string {
    const edge = cssValue(tok("edge", config.theme.colors.hairline));
    return (
        `@media(max-width:${RAIL_MIN}){.bp-tree-rail{display:none}}` +
        `@media(max-width:${PHONE}){.bp-tree-shell-boxed>.bp-tree-aside{flex-basis:100%!important;border-right:0!important;border-bottom:1px solid ${edge}!important}}`
    );
}

/**
 * A page with a sidebar: the chrome on the left, the page on the right, stacked on a phone.
 *
 * Flex with a wrapping basis rather than a grid with media queries, so the same markup is a column on
 * a narrow screen and two columns on a wide one with nothing to keep in step.
 *
 * `boxed` splits the page edge to edge instead: the sidebar a fixed surface column, the page the rest,
 * with a hairline between. A `rail` is a third column at the inline end, and gives its room back to
 * the page below a laptop width.
 */
export function TreeShell({
    config,
    aside,
    rail,
    variant = "plain",
    children,
}: {
    config: PressConfig;
    aside: ReactNode;
    /** The rail, usually a `TreeRail`. Nothing is drawn for it when it is empty. */
    rail?: ReactNode;
    variant?: TreeVariant["sidebar"];
    children: ReactNode;
}) {
    const t = config.theme;
    const c = t.colors;
    const edge = `1px solid ${tok("edge", c.hairline)}`;
    const style = rail || variant === "boxed" ? <style dangerouslySetInnerHTML={{ __html: shellCss(config) }} /> : null;

    if (variant === "boxed") {
        return (
            <div
                className="bp-tree-shell bp-tree-shell-boxed"
                style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", borderTop: edge, minHeight: tok("min-height", "0px") }}
            >
                {style}
                <aside
                    className="bp-tree-aside"
                    style={{
                        flex: `0 0 ${tok("sidebar-width", "280px")}`,
                        minWidth: 0,
                        boxSizing: "border-box",
                        background: tok("sidebar-bg", c.surface),
                        borderRight: edge,
                        padding: `${tok("sidebar-pad-y", t.space.lg)} ${tok("sidebar-pad-x", t.space.md)}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: tok("aside-gap", t.space.md),
                    }}
                >
                    {aside}
                </aside>
                <div
                    className="bp-tree-body"
                    style={{ flex: "1 1 0%", minWidth: 0, padding: `${tok("body-pad-y", t.space.xl)} ${tok("body-pad-x", t.space.xl)}` }}
                >
                    {children}
                </div>
                {rail && (
                    <aside
                        className="bp-tree-rail"
                        style={{
                            flex: `0 0 ${tok("rail-width", t.layout.columnMin)}`,
                            minWidth: 0,
                            boxSizing: "border-box",
                            borderLeft: edge,
                            padding: `${tok("rail-pad-y", t.space.xl)} ${tok("rail-pad-x", t.space.md)}`,
                        }}
                    >
                        {rail}
                    </aside>
                )}
            </div>
        );
    }

    return (
        <div
            className="bp-tree-shell"
            style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                gap: tok("gap", t.space.lg),
                maxWidth: t.layout.wide,
                margin: "0 auto",
                padding: `${t.space.lg} ${t.layout.gutter}`,
            }}
        >
            {style}
            <aside
                className="bp-tree-aside"
                style={{
                    flex: "1 1 240px",
                    minWidth: 0,
                    maxWidth: tok("sidebar-width", "280px"),
                    display: "flex",
                    flexDirection: "column",
                    gap: tok("aside-gap", t.space.md),
                }}
            >
                {aside}
            </aside>
            <div className="bp-tree-body" style={{ flex: "999 1 520px", minWidth: 0 }}>
                {children}
            </div>
            {rail && (
                <aside className="bp-tree-rail" style={{ flex: `0 0 ${tok("rail-width", t.layout.columnMin)}`, minWidth: 0 }}>
                    {rail}
                </aside>
            )}
        </div>
    );
}

export interface TreeAsideProps {
    config: PressConfig;
    collection: string;
    tree: CollectionTreeResult;
    /** The slug of the item being read. */
    current?: string;
    /** The product being read, which the switcher marks. */
    product?: string;
    /** The search box, when the page draws one. */
    search?: ReactNode;
}

/**
 * The sidebar column in the order the switcher variant asks for: the tabs above the search box, or
 * the search box first and the list inside the sidebar, where it folds away with the pages on a phone.
 */
export function TreeAside({ config, collection, tree, current, product, search }: TreeAsideProps) {
    const switcher = treeVariant(config, collection).switcher;
    if (switcher === "list") {
        const list = treeProducts(config, collection).length > 0 && (
            <TreeSwitcher config={config} collection={collection} current={product} variant="list" />
        );
        return (
            <>
                {search}
                <TreeSidebar config={config} tree={tree} current={current} switcher={list || undefined} />
            </>
        );
    }
    return (
        <>
            <TreeSwitcher config={config} collection={collection} current={product} variant="tabs" />
            {search}
            <TreeSidebar config={config} tree={tree} current={current} />
        </>
    );
}
