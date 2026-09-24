import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The element a primitive draws (barakocms-site#46): a block wearing a recipe is its own cell, a text
 * block can be the element a design names, and a stack or a panel can be a link or an anchor target.
 * A block that asks for none of it renders as it always did, which the rest of the suite holds.
 */

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a data-next-link="" href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { recipesFrom } = await import("../recipes.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { resolveBlocks } = await import("./schema.js");

const SITE = { name: "Test", url: "https://test.example" };
const RECIPES = {
    lede: { style: { flex: "1 1 min(420px, 100%)", margin: "0" } },
    row: { style: { display: "flex", "flex-wrap": "wrap", "--bp-list": "contents" } },
    card: { class: "lift", style: { padding: "22px", display: "flex", "justify-content": "space-between" } },
};

function render(raw: unknown, recipes: Record<string, unknown> = RECIPES): string {
    const cfg = defineConfig({ site: SITE, theme: { recipes: recipes as never } });
    const blocks = resolveBlocks(raw, createBlockRegistry(cfg), { perViewer: false });
    return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
}

const text = (props: Record<string, unknown>) => ({ type: "text", props: { value: "Words", ...props } });

describe("a block wearing a recipe", () => {
    it("is its own cell: the wrapper around it takes no box", () => {
        const html = render([{ type: "stack", props: { recipe: "row", content: [[text({ recipe: "lede" })]] } }]);

        const wrappers = [...html.matchAll(/<div data-block="(\w+)" style="([^"]*)"/g)].map((m) => [m[1], m[2]]);
        expect(wrappers).toEqual([
            ["stack", "--bp-list:flex;display:contents"],
            ["text", "--bp-list:flex;display:contents"],
        ]);
        expect(html).toContain('<p style="flex:1 1 min(420px, 100%);margin:0">Words</p>');
    });

    it("keeps its wrapper when the site has no recipe of that name, and draws its own look", () => {
        const html = render([text({ recipe: "nobody" })]);

        expect(html).toContain('<div data-block="text" style="--bp-list:flex">');
        expect(html).not.toContain("display:contents");
    });

    it("keeps its wrapper when it names no recipe at all", () => {
        expect(render([text({})])).toContain('<div data-block="text" style="--bp-list:flex">');
    });
});

describe("the element a text block is", () => {
    it("is the tag it names, with the variant's look when it wears no recipe", () => {
        const span = render([text({ tag: "span", variant: "title" })]);
        expect(span).toMatch(/<span style="[^"]*font-size:[^"]*">Words<\/span>/);
        expect(render([text({ tag: "code", recipe: "lede" })])).toContain('<code style="flex:1 1 min(420px, 100%);margin:0">Words</code>');
    });

    it("drops a block whose tag is not one it offers", () => {
        const html = render([text({ tag: "script" })]);
        expect(html).not.toContain("Words");
        expect(html).not.toContain("<script");
    });

    it("hides a decoration from a screen reader, and carries a title when it has one", () => {
        const html = render([text({ value: "=>", tag: "span", decorative: true, title: "nuget.org", recipe: "lede" })]);
        expect(html).toContain('<span aria-hidden="true" title="nuget.org" style="flex:1 1 min(420px, 100%);margin:0">=&gt;</span>');
    });
});

describe("a stack or a panel that links", () => {
    const linked = (type: string, href: string) => ({
        type,
        props: { href, recipe: "card", content: [[text({ tag: "span", recipe: "lede" })]] },
    });

    it("is a Next link for a path on the site", () => {
        const html = render([linked("stack", "/docs/")]);
        expect(html).toContain('<a data-next-link="" href="/docs/" style="padding:22px;display:flex;justify-content:space-between" class="lift">');
        expect(html).not.toContain("<div style=\"padding");
    });

    it("is a plain anchor for a link off the site", () => {
        const html = render([linked("panel", "https://github.com/BaryoDev")]);
        expect(html).toContain('<a href="https://github.com/BaryoDev" style="padding:22px;display:flex;justify-content:space-between" class="lift">');
    });

    it("is refused, as any link field is, when the address is not one a link may hold", () => {
        expect(render([linked("stack", "javascript:alert(1)")])).not.toContain("Words");
        expect(render([linked("panel", "//elsewhere.example/x")])).not.toContain("Words");
    });

    it("stays a div with no href", () => {
        const html = render([{ type: "panel", props: { recipe: "card", content: [[text({})]] } }]);
        expect(html).toContain('<div style="padding:22px;display:flex;justify-content:space-between" class="lift">');
    });
});

describe("an anchor on a section, a stack or a panel", () => {
    it("is the element's id", () => {
        for (const type of ["section", "stack", "panel"]) {
            const html = render([{ type, props: { anchor: "start", content: [[text({})]] } }]);
            expect(html, type).toMatch(/<(section|div) id="start"/);
        }
    });

    it("is left off when it is not a plain name", () => {
        const html = render([{ type: "stack", props: { anchor: 'x" onclick="y', content: [[text({})]] } }]);
        expect(html).not.toContain("id=");
    });
});

describe("how many recipes a site may keep", () => {
    it("reads four hundred, which a site's whole design needs", () => {
        const many = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`r${i}`, { style: { margin: "0" } }]));
        const read = recipesFrom(undefined, many);
        expect(Object.keys(read ?? {})).toHaveLength(400);
    });
});
