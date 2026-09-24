import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Marked } from "marked";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Tree screens a site can style (#130): tokens with today's values behind them, a class on each part,
 * the layouts a token cannot express as variants, and one search index per tree read.
 *
 * That the defaults draw the same pixels as before is the look check's to prove, not this file's:
 * this file proves the markup a stylesheet and a token reach is there, and that each variant draws
 * the elements it promises in the order it promises.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { markdownHeadings, renderMarkdown } = await import("./markdown.js");
const { itemHeadings, treeSearchIndex } = await import("./tree.js");
const { EditLink, SearchBox, TreePager, TreeShell, TreeSidebar, TreeSwitcher, TreeAside, TreeRail } = await import(
    "./screens/tree.js"
);
const { ItemView } = await import("./screens/collection.js");

type Variant = import("./config.js").TreeVariant;
type Tree = import("./tree.js").CollectionTreeResult;

afterEach(() => {
    vi.restoreAllMocks();
});

function configWith(tree: { variant?: Variant; searchIndex?: boolean; searchPath?: string } = {}) {
    return defineConfig({
        site: { name: "Manual", url: "https://manual.example" },
        collections: {
            guide: {
                type: "guide",
                route: "/guide",
                label: "Guide",
                fields: { title: "Headline" },
                tree: {
                    section: "Part",
                    product: "Edition",
                    editBase: "https://example.org/edit/",
                    products: [
                        { key: "first", label: "First edition", href: "/guide" },
                        { key: "second", label: "Second edition", href: "/guide/second", note: "draft" },
                    ],
                    ...tree,
                },
            },
        },
    });
}

const item = (slug: string, title: string, body = "") => ({ id: slug, slug, title, collection: "guide", body }) as never;
const node = (slug: string, title: string, body = "", children: Tree["sections"][number]["nodes"] = []) => ({
    item: item(slug, title, body),
    href: `/guide/${slug}`,
    children,
});

const BODY = "Opening.\n\n## Before you **start**\n\nText.\n\n### Not a rail entry\n\n## The `config` file\n\nMore.";

function tree(): Tree {
    const sections = [
        { name: "Basics", nodes: [node("hello", "Hello", BODY), node("setup", "Setup", "", [node("keys", "Keys", "## Keys\n")])] },
        { name: "Later", nodes: [node("faq", "Questions")] },
    ];
    return { sections, order: [item("hello", "Hello"), item("setup", "Setup"), item("keys", "Keys"), item("faq", "Questions")], truncated: false };
}

function all(config = configWith(), variant: Variant = {}) {
    const t = tree();
    return renderToStaticMarkup(
        <TreeShell config={config} variant={variant.sidebar} rail={variant.rail ? <TreeRail config={config} headings={itemHeadings(t.sections[0].nodes[0].item)} /> : undefined} aside={
            <>
                <TreeSwitcher config={config} collection="guide" current="first" variant={variant.switcher} />
                <SearchBox config={config} action="/guide" param="q" query="set" id="s" results={[{ href: "/guide/setup", title: "Setup" }]} />
                <TreeSidebar config={config} tree={t} current="keys" />
            </>
        }>
            <TreePager config={config} collection="guide" previous={item("setup", "Setup")} next={item("faq", "Questions")} variant={variant.pager} />
            <EditLink config={config} item={item("keys", "Keys")} />
        </TreeShell>,
    );
}

/** Every inline style in the markup, as written. */
function styles(html: string): string[] {
    return [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));
}

/** A style with every tree token taken out, fallback and all, so what is left is what no token reaches. */
function untokened(style: string): string {
    let out = style;
    let before;
    do {
        before = out;
        out = out.replace(/var\(--t-tree-[a-z-]+, [^()]*(\([^()]*\))?[^()]*\)/g, "TOKEN");
    } while (out !== before);
    return out;
}

describe("the tree's parts, as a site's stylesheet and tokens see them", () => {
    it("read every colour, gap and radius through a tree token, with the theme's own value behind it", () => {
        const found = styles(all());
        expect(found.length).toBeGreaterThan(20);

        const declarations = found.flatMap((s) => untokened(s).split(";"));
        const colours = declarations.filter((d) => /#[0-9a-f]{3,8}\b/i.test(d));
        expect(colours).toEqual([]);
        const radii = declarations.filter((d) => d.startsWith("border-radius:"));
        expect(radii.length).toBeGreaterThan(5);
        expect(radii.filter((d) => d !== "border-radius:TOKEN")).toEqual([]);
        const gaps = declarations.filter((d) => /^(gap|margin-top|margin-left):/.test(d));
        expect(gaps.length).toBeGreaterThan(5);
        expect(gaps.filter((d) => !d.includes("TOKEN"))).toEqual([]);

        // The fallback is the theme's value, so a site that sets nothing draws what it drew.
        const theme = configWith().theme;
        const html = all();
        expect(html).toContain(`var(--t-tree-link-current-bg, ${theme.colors.accentTint})`);
        expect(html).toContain(`var(--t-tree-link-radius, ${theme.radii.control})`);
        expect(html).toContain(`var(--t-tree-section-gap, ${theme.space.md})`);
        expect(html).toContain(`var(--t-tree-tab-current-bg, ${theme.colors.accent})`);
    });

    it("carries a class on each part, so a stylesheet can reach what a token does not", () => {
        const html = all();
        for (const name of [
            "bp-tree-shell",
            "bp-tree-aside",
            "bp-tree-body",
            "bp-tree-sidebar",
            "bp-tree-summary",
            "bp-tree-sections",
            "bp-tree-section",
            "bp-tree-section-label",
            "bp-tree-list",
            "bp-tree-item",
            "bp-tree-link",
            "bp-tree-link-current",
            "bp-tree-switcher",
            "bp-tree-tab",
            "bp-tree-tab-current",
            "bp-tree-search",
            "bp-tree-search-label",
            "bp-tree-search-input",
            "bp-tree-search-results",
            "bp-tree-search-hit",
            "bp-tree-pager",
            "bp-tree-pager-prev",
            "bp-tree-pager-next",
            "bp-tree-pager-label",
            "bp-tree-pager-title",
            "bp-tree-edit",
        ]) {
            expect(html, name).toMatch(new RegExp(`class="([^"]* )?${name}( [^"]*)?"`));
        }
        // The current page is the one that carries the current class, and it is not a link.
        expect(html).toMatch(/<span class="bp-tree-link bp-tree-link-current"[^>]*aria-current="page"[^>]*>Keys<\/span>/);
    });

    it("draws today's layout when no variant is asked for", () => {
        const html = all();
        expect(html).toContain('class="bp-tree-switcher bp-tree-switcher-tabs"');
        expect(html).not.toContain("bp-tree-shell-boxed");
        expect(html).not.toContain("bp-tree-rail");
        expect(html).not.toContain("bp-tree-pager-empty");
        expect(html).not.toContain("<style>@media(max-width:64rem)");
    });
});

describe("the variants", () => {
    it("draw the switcher as a labelled list inside the sidebar, under the search box", () => {
        const config = configWith({ variant: { switcher: "list" }, searchPath: "/guide" });
        const html = renderToStaticMarkup(<TreeAside config={config} collection="guide" tree={tree()} current="hello" product="second" search={<p>SEARCH</p>} />);

        const search = html.indexOf("SEARCH");
        const sidebar = html.indexOf("bp-tree-sidebar");
        const list = html.indexOf("bp-tree-switcher-list");
        const sections = html.indexOf("bp-tree-sections");
        expect(search).toBeGreaterThanOrEqual(0);
        expect([search < sidebar, sidebar < list, list < sections]).toEqual([true, true, true]);
        expect(html).not.toContain("bp-tree-tab");
        expect(html).toContain('<p class="bp-tree-switcher-label"');
        // A product is a sidebar row, marked the way the page being read is.
        expect(html).toMatch(/<span class="bp-tree-link bp-tree-link-current bp-tree-product"[^>]*aria-current="true"[^>]*>Second edition<span class="bp-tree-product-note"[^>]*>draft<\/span><\/span>/);
        expect(html).toMatch(/<a href="\/guide" class="bp-tree-link bp-tree-product"/);
    });

    it("keep the tabs above the search box, as they always were, when the tree does not ask for a list", () => {
        const html = renderToStaticMarkup(<TreeAside config={configWith()} collection="guide" tree={tree()} search={<p>SEARCH</p>} />);
        expect(html.indexOf("bp-tree-switcher-tabs")).toBeLessThan(html.indexOf("SEARCH"));
        expect(html.indexOf("SEARCH")).toBeLessThan(html.indexOf("bp-tree-sidebar"));
    });

    it("split the page edge to edge when the sidebar is boxed, and stack it on a phone", () => {
        const html = all(configWith(), { sidebar: "boxed" });
        expect(html).toContain('class="bp-tree-shell bp-tree-shell-boxed"');
        expect(html).toContain(".bp-tree-shell-boxed>.bp-tree-aside{flex-basis:100%!important");
        expect(html).toMatch(/class="bp-tree-aside" style="[^"]*background:var\(--t-tree-sidebar-bg, #FFFFFF\)/);
    });

    it("draw a rail of the page's own second level headings, linking to the ids its body renders", () => {
        const html = all(configWith(), { rail: true });
        const rail = html.slice(html.indexOf('class="bp-tree-rail"'));
        const links = [...rail.matchAll(/<a href="#([^"]+)" class="bp-tree-rail-link"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
        expect(links).toEqual([
            ["before-you-start", "Before you start"],
            ["the-config-file", "The config file"],
        ]);
        const body = renderMarkdown(BODY);
        for (const [id] of links) expect(body).toContain(`<h2 id="${id}">`);
        expect(html).toContain("@media(max-width:64rem){.bp-tree-rail{display:none}}");
        expect(rail).toContain("On this page");
    });

    it("hold the missing half of the pager, so next stays on the right", () => {
        const config = configWith();
        const html = renderToStaticMarkup(<TreePager config={config} collection="guide" next={item("faq", "Questions")} variant="halves" />);
        expect(html.indexOf("bp-tree-pager-empty")).toBeLessThan(html.indexOf("bp-tree-pager-next"));
        expect(html).toContain("flex-wrap:nowrap");
        const wide = renderToStaticMarkup(<TreePager config={config} collection="guide" next={item("faq", "Questions")} />);
        expect(wide).not.toContain("bp-tree-pager-empty");
    });

    it("are read from the collection's tree by the item page", () => {
        const config = configWith({ variant: { switcher: "list", sidebar: "boxed", rail: true, pager: "halves" } });
        const t = tree();
        const html = renderToStaticMarkup(<ItemView config={config} item={item("hello", "Hello", BODY)} tree={t} />);
        expect(html).toContain("bp-tree-shell-boxed");
        expect(html).toContain("bp-tree-switcher-list");
        expect(html).toContain('href="#before-you-start"');
        // Hello is first in reading order, so the previous half is the one held empty.
        expect(html).toContain("bp-tree-pager-empty");
    });
});

describe("the search index", () => {
    it("lists every page and then its headings, in reading order, each heading linked to its anchor", () => {
        const index = treeSearchIndex(tree());
        expect(index).toEqual([
            { title: "Hello", href: "/guide/hello" },
            { title: "Hello", heading: "Before you start", href: "/guide/hello#before-you-start" },
            { title: "Hello", heading: "The config file", href: "/guide/hello#the-config-file" },
            { title: "Setup", href: "/guide/setup" },
            { title: "Keys", href: "/guide/keys" },
            { title: "Keys", heading: "Keys", href: "/guide/keys#keys" },
            { title: "Questions", href: "/guide/faq" },
        ]);
    });

    it("is built once per tree read, and a body is tokenised once however many reads list it", () => {
        const lexed = vi.spyOn(Marked.prototype, "lexer");
        const body = "## Only here\n\nA body no other test uses.";
        const read = () => ({ ...tree(), sections: [{ name: "Solo", nodes: [node("solo", "Solo", body)] }] });

        const first = read();
        const once = treeSearchIndex(first);
        expect(once).toHaveLength(2);
        expect(treeSearchIndex(first)).toBe(once);

        // A second read of the same content, the way the next page of a static build reads it.
        const again = treeSearchIndex(read());
        expect(again).toEqual(once);
        expect(lexed.mock.calls.filter(([source]) => source === body)).toHaveLength(1);
    });

    it("draws into the page hidden, for the box to filter as the reader types, when the tree asks for one", () => {
        const config = configWith({ searchIndex: true });
        const html = renderToStaticMarkup(<ItemView config={config} item={item("keys", "Keys")} tree={tree()} />);

        expect(html).toContain('role="search"');
        // No route reads the query here, so the form names none rather than one that ignores it.
        expect(html).not.toMatch(/<form[^>]*action=/);
        expect(html).toMatch(/<div aria-live="polite" hidden="" class="bp-tree-search-results bp-tree-search-index"[^>]*data-bp-search-index="8"/);
        expect(html).toMatch(/<li hidden="" data-bp-search-text="before you start hello"><a href="\/guide\/hello#before-you-start"/);
        expect(html).toContain('data-bp-search-empty=""');
    });

    it("stays out of the page unless the tree asks for it", () => {
        const html = renderToStaticMarkup(<ItemView config={configWith({ searchPath: "/guide" })} item={item("keys", "Keys")} tree={tree()} />);
        expect(html).toContain('action="/guide"');
        expect(html).not.toContain("data-bp-search-index");
    });
});

describe("a body's headings", () => {
    it("carry the ids the rendered body gives them, with their inline markup dropped", () => {
        const found = markdownHeadings(BODY);
        expect(found).toHaveLength(2);
        const html = renderMarkdown(BODY);
        for (const h of found) expect(html).toContain(`<h2 id="${h.id}">`);
        expect(found.map((h) => h.text)).toEqual(["Before you start", "The config file"]);
        expect(markdownHeadings(BODY, 3)).toEqual([{ id: "not-a-rail-entry", text: "Not a rail entry" }]);
    });
});
