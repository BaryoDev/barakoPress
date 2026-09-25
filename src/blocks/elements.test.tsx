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
const { writeFilterState } = await import("./filter.js");
const { bindBlocks } = await import("./bind.js");

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
        expect(html).toContain('<a href="https://github.com/BaryoDev" rel="noopener noreferrer" style="padding:22px;display:flex;justify-content:space-between" class="lift">');
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

describe("a container that links, holding a link of its own", () => {
    async function bound(raw: unknown): Promise<string> {
        const cfg = defineConfig({ site: SITE, theme: { recipes: RECIPES as never } });
        const registry = createBlockRegistry(cfg);
        const blocks = await bindBlocks(resolveBlocks(raw, registry, { perViewer: false }), { config: cfg, registry, scopes: {} });
        return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
    }
    const inside = (block: unknown) => [{ type: "stack", props: { href: "/docs/", recipe: "card", content: [[block]] } }];

    it("is drawn without its href, so no link sits inside a link", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const withLink = await bound(inside({ type: "link", props: { label: "Read", href: "/read/" } }));
        const withInline = await bound(inside(text({ value: "See [the docs](/docs/x)", format: "inline" })));
        const withButton = await bound(inside({ type: "stack", props: { href: "/inner/", content: [[text({})]] } }));
        warn.mockRestore();

        for (const html of [withLink, withInline, withButton]) expect(html.match(/<a /g)).toHaveLength(1);
        expect(withLink).toContain('<div style="padding:22px;display:flex;justify-content:space-between" class="lift">');
        expect(withButton).toContain('href="/inner/"');
    });

    it("keeps its href when what it holds is only words", async () => {
        const html = await bound(inside(text({ value: "Read the docs", tag: "span" })));
        expect(html).toContain('<a data-next-link="" href="/docs/"');
    });

    it("keeps a decoration that holds a link in the accessibility tree", () => {
        const html = render([text({ value: "[x](/x)", format: "inline", decorative: true })]);
        expect(html).not.toContain("aria-hidden");
        expect(render([text({ value: "*x*", format: "inline", decorative: true })])).toContain('aria-hidden="true"');
    });
});

describe("an anchor on a section, a stack or a panel", () => {
    it("is the element's id", () => {
        for (const type of ["section", "stack", "panel"]) {
            const html = render([{ type, props: { anchor: "start", content: [[text({})]] } }]);
            expect(html, type).toMatch(/<(section|div) id="start"/);
        }
    });

    it("can come from a binding, and is checked after it resolves", async () => {
        const cfg = defineConfig({ site: SITE, theme: { recipes: RECIPES as never } });
        const registry = createBlockRegistry(cfg);
        const draw = async (anchor: string) => {
            const blocks = await bindBlocks(resolveBlocks([{ type: "stack", props: { anchor, content: [[text({})]] } }], registry, { perViewer: false }), {
                config: cfg,
                registry,
                scopes: { page: () => ({ Slug: "v4-4-0", Bad: '" onclick="x' }) },
            });
            return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
        };
        expect(await draw("{{page.Slug}}")).toContain('id="v4-4-0"');
        expect(await draw("{{page.Bad}}")).not.toContain("id=");
    });

    it("is left off when it is not a plain name", () => {
        const html = render([{ type: "stack", props: { anchor: 'x" onclick="y', content: [[text({})]] } }]);
        expect(html).not.toContain("id=");
    });
});

describe("a filter bar wearing recipes", () => {
    const TABS = {
        tabs: { style: { "margin-top": "28px", display: "flex", "flex-wrap": "wrap", gap: "8px" }, class: "chip-row" },
        tab: { style: { padding: "8px 15px", background: "#fff", border: "1px solid #E7E8F1" }, class: "hv-edge-accent" },
        "tab-on": { style: { padding: "8px 15px", background: "#101223", color: "#fff" } },
    };
    const bar = (props: Record<string, unknown>) => [
        { type: "filterBar", props: { field: "Category", allLabel: "All", state: writeFilterState({ id: "f1-body", values: ["Auth", "Ops"] }), ...props } },
    ];

    it("draws its row and its buttons in them, the pressed one in its own, and keeps them pointers", () => {
        const html = render(bar({ recipe: "tabs", buttonRecipe: "tab", pressedRecipe: "tab-on" }), TABS);

        expect(html).toContain('<div role="group" style="margin-top:28px;display:flex;flex-wrap:wrap;gap:8px" class="chip-row">');
        expect(html).toContain('<button type="button" aria-pressed="true" style="padding:8px 15px;background:#101223;color:#fff;cursor:pointer">All</button>');
        expect(html).toContain('<button type="button" aria-pressed="false" style="padding:8px 15px;background:#fff;border:1px solid #E7E8F1;cursor:pointer" class="hv-edge-accent">Auth</button>');
        expect(html).toContain('<div data-block="filterBar" style="--bp-list:flex;display:contents" data-bp-contents="">');
    });

    it("draws its own look for a recipe the site does not have, with no class", () => {
        const html = render(bar({ recipe: "nobody", buttonRecipe: "nobody" }), TABS);

        expect(html).toContain('<div role="group" style="display:flex;flex-wrap:wrap;gap:');
        expect(html).not.toContain("class=");
    });
});

describe("how many recipes a site may keep", () => {
    it("reads four hundred, which a site's whole design needs", () => {
        const many = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`r${i}`, { style: { margin: "0" } }]));
        const read = recipesFrom(undefined, many);
        expect(Object.keys(read ?? {})).toHaveLength(400);
    });
});

/*
 * Review findings on #147. Whether something inside a linked container can be pressed is read from
 * what the engine renders, not guessed from the markdown's spelling: an autolinked address, a
 * reference link and a call to action are links, and a code span holding a URL is not.
 */
describe("a linked container and what its content draws", () => {
    async function bound(raw: unknown): Promise<string> {
        const cfg = defineConfig({ site: SITE, theme: { recipes: RECIPES as never } });
        const registry = createBlockRegistry(cfg);
        const blocks = await bindBlocks(resolveBlocks(raw, registry, { perViewer: false }), { config: cfg, registry, scopes: {} });
        return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
    }
    const inside = (block: unknown) => [{ type: "stack", props: { href: "/docs/", content: [[block]] } }];
    const anchors = (html: string) => (html.match(/<a /g) ?? []).length;

    it("drops its href when the content renders a link of its own, however the link is written", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const drawn = {
            www: await bound(inside(text({ value: "See www.example.com", format: "inline" }))),
            email: await bound(inside(text({ value: "Mail hi@example.com", format: "inline" }))),
            reference: await bound(inside({ type: "richText", props: { markdown: "Read [the docs][d].\n\n[d]: /docs/x" } })),
            callToAction: await bound(inside({ type: "callToAction", props: { heading: "H", label: "Go", href: "/go/" } })),
        };
        warn.mockRestore();
        for (const [name, html] of Object.entries(drawn)) {
            expect(anchors(html), name).toBe(1);
            expect(html, name).not.toContain('href="/docs/"');
        }
    });

    it("keeps its href when a URL sits in a code span and nothing inside links", async () => {
        const kept = [
            await bound(inside(text({ value: "Base URL `https://api.example.com`", format: "inline" }))),
            await bound(inside({ type: "richText", props: { markdown: "Call `https://api.example.com/v1`" } })),
        ];
        for (const html of kept) {
            expect(anchors(html)).toBe(1);
            expect(html).toContain('href="/docs/"');
        }
    });

    it("opens an address elsewhere without handing it this page", () => {
        const html = render([{ type: "stack", props: { href: "https://elsewhere.example/", content: [[text({})]] } }]);
        expect(html).toContain('<a href="https://elsewhere.example/" rel="noopener noreferrer"');
    });
});

describe("decorative inline text", () => {
    it("stays in the accessibility tree when what it renders holds a link, an autolink included", () => {
        const html = render([text({ value: "https://example.com", format: "inline", decorative: true })]);
        expect(html).toContain('<a href="https://example.com"');
        expect(html).not.toContain('aria-hidden="true"');
        expect(render([text({ value: "Just words", format: "inline", decorative: true })])).toContain('aria-hidden="true"');
    });
});

describe("a hue flow whose cells wear recipes", () => {
    it("turns the element the recipe draws, since the cell's wrapper takes no box to filter", async () => {
        const { hueCss } = await import("./motion.js");
        const panel = (value: string) => ({ type: "panel", props: { recipe: "card", content: [[text({ value })]] } });
        const html = render([{ type: "flow", props: { columns: "3", hueRotate: "wide", content: [[panel("a"), panel("b"), panel("c")]] } }]);
        expect((html.match(/data-bp-contents=""/g) ?? []).length).toBeGreaterThanOrEqual(3);
        const css = hueCss("wide");
        expect(css).toContain('[data-bp-hue="wide"]>*>[data-bp-contents]:nth-child(3n+2)>*{filter:hue-rotate(40deg)}');
        expect(css).toContain('[data-bp-hue="wide"]>*>[data-bp-contents]:nth-child(3n+3)>*{filter:hue-rotate(-40deg)}');
    });
});
