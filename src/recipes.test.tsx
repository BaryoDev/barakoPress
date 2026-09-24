import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Style recipes and inline marks in text (#131).
 *
 * A recipe is tenant input that ends up in a style attribute, so most of this is what it refuses.
 * The case that has to hold whatever else changes is a block that names no recipe: it renders
 * exactly as it did.
 */

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { applySiteSettings } = await import("./site.js");
const { resolveTheme } = await import("./theme.js");
const { RECIPE_PROPERTIES, recipeLook, recipeValueOk, recipesFrom } = await import("./recipes.js");
const { renderInlineMarkdown } = await import("./markdown.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { BlockList } = await import("./blocks/render.js");
const { blockSchema, resolveBlocks } = await import("./blocks/schema.js");
const { bindBlocks } = await import("./blocks/bind.js");

const SITE = { name: "Test", url: "https://test.example" };

const CARD = {
    class: "lift card",
    style: {
        padding: "22px 24px",
        background: "{colors.surface}",
        border: "1px solid {colors.hairline}",
        "border-radius": "16px",
        "box-shadow": "0 24px 56px -28px rgba(16,18,35,.5)",
        display: "flex",
        "flex-direction": "column",
        gap: "{space.sm}",
    },
};

function configWith(recipes: Record<string, unknown>, tokens?: Record<string, string>) {
    return defineConfig({ site: SITE, theme: { recipes: recipes as never, ...(tokens ? { tokens } : {}) } });
}

function render(raw: unknown, cfg = configWith({ card: CARD })): string {
    const blocks = resolveBlocks(raw, createBlockRegistry(cfg), { perViewer: false });
    return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
}

const panel = (props: Record<string, unknown>) => ({
    type: "panel",
    props: { ...props, content: [[{ type: "text", props: { value: "Inside" } }]] },
});

describe("reading recipes", () => {
    it("keeps the properties on the list and the values that pass", () => {
        const read = recipesFrom(undefined, { card: CARD });

        expect(read?.card.class).toBe("lift card");
        expect(Object.keys(read?.card.style ?? {})).toHaveLength(8);
        expect(read?.card.style["box-shadow"]).toBe("0 24px 56px -28px rgba(16,18,35,.5)");
    });

    it("keeps the values barakocms.com's sections are written in", () => {
        for (const value of [
            "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
            "repeat(2,minmax(0,1fr))",
            "1.1fr 1fr",
            "clamp(56px, 8vw, 96px) clamp(18px, 4vw, 40px) clamp(52px, 7vw, 84px)",
            "20px clamp(28px, 4vw, 56px)",
            "'JetBrains Mono',monospace",
            "-.03em",
            "1 1 min(420px, 100%)",
            "tabular-nums",
            "var(--color-accent)",
            "calc((100% - 2 * 16px) / 3)",
            "linear-gradient(145deg, #101223 0%, #4034A8 55%)",
            "1.5px solid #5A46D6",
        ]) {
            expect(recipeValueOk(value), value).toBe(true);
        }
    });

    it("refuses a value that could load something or leave its declaration", () => {
        for (const value of [
            "url(https://evil.example/x.png)",
            "URL(https://evil.example/x.png)",
            "linear-gradient(red, blue), url(x)",
            "expression(alert(1))",
            "image-set('x.png' 1x)",
            "attr(data-x)",
            "red;position:fixed",
            "red; background: url(x)",
            "red}body{display:none",
            "red{",
            "</style><script>alert(1)</script>",
            "red !important",
            "\\75rl(x)",
            "red /* comment */",
            "'Sora",
            "\"Sora\" 'x",
            "@import 'x'",
            "javascript:alert(1)",
            "var(x)",
            "var(--a, url(x))",
            "calc(1px",
            "1px)",
            "red\nposition:fixed",
            "x".repeat(241),
            "",
        ]) {
            expect(recipeValueOk(value), value).toBe(false);
        }
    });

    it("drops a property off the list, and a bad value, and keeps the rest of the recipe", () => {
        const read = recipesFrom(undefined, {
            card: {
                style: {
                    padding: "12px",
                    behavior: "url(x.htc)",
                    "-moz-binding": "url(x)",
                    content: "'hi'",
                    cursor: "pointer",
                    position: "fixed",
                    "z-index": "9999",
                    background: "url(https://evil.example/x.png)",
                    color: "red;position:fixed",
                },
            },
        });

        expect(read?.card.style).toEqual({ padding: "12px" });
    });

    it("holds position to the values that stay in the flow", () => {
        const read = recipesFrom(undefined, {
            a: { style: { position: "relative" } },
            b: { style: { position: "absolute" } },
            c: { style: { position: "sticky" } },
        });

        expect(read?.a.style.position).toBe("relative");
        expect(read?.b).toBeUndefined();
        expect(read?.c).toBeUndefined();
    });

    it("refuses a bad name and a bad class, and drops a recipe left with nothing", () => {
        const read = recipesFrom(undefined, {
            "Card": { style: { padding: "1px" } },
            "no spaces": { style: { padding: "1px" } },
            "x\"y": { style: { padding: "1px" } },
            empty: { style: { cursor: "pointer" } },
            classy: { class: "ok \"><script> also-ok 9bad", style: {} },
        });

        expect(Object.keys(read ?? {})).toEqual(["card", "classy"]);
        expect(read?.classy.class).toBe("ok also-ok");
    });

    it("is the list the documentation names, and nothing that loads a resource", () => {
        expect(RECIPE_PROPERTIES).toContain("grid-template-columns");
        expect(RECIPE_PROPERTIES).toContain("--bp-ink");
        for (const risky of ["background-image", "list-style-image", "content", "cursor", "mask", "filter", "z-index", "top", "inset"]) {
            expect(RECIPE_PROPERTIES).not.toContain(risky);
        }
    });
});

describe("recipes in the site settings", () => {
    const base = configWith({ card: CARD, quiet: { style: { padding: "4px" } } });

    it("reads StyleRecipes, and merges them over the configured ones by name", () => {
        const applied = applySiteSettings(base, { StyleRecipes: { card: { style: { padding: "9px" } }, band: { class: "band" } } }, null);

        expect(applied.theme.recipes?.card).toEqual({ style: { padding: "9px" } });
        expect(applied.theme.recipes?.quiet).toEqual({ style: { padding: "4px" } });
        expect(applied.theme.recipes?.band).toEqual({ class: "band", style: {} });
    });

    it("reads StyleRecipes saved as text", () => {
        const applied = applySiteSettings(base, { StyleRecipes: JSON.stringify({ band: { style: { padding: "9px" } } }) }, null);

        expect(applied.theme.recipes?.band).toEqual({ style: { padding: "9px" } });
    });

    it("keeps the configured recipes when the tenant sets none, and has none when nobody does", () => {
        expect(applySiteSettings(base, {}, null).theme.recipes).toEqual(base.theme.recipes);
        expect(applySiteSettings(defineConfig({ site: SITE }), {}, null).theme.recipes).toBeUndefined();
    });
});

describe("a block wearing a recipe", () => {
    it("draws with the recipe in place of its own look", () => {
        const cfg = configWith({ card: CARD });
        const html = render([panel({ recipe: "card", padding: "xl" })], cfg);

        expect(html).toContain('class="lift card"');
        expect(html).toContain("padding:22px 24px");
        expect(html).toContain(`background:${cfg.theme.colors.surface}`);
        expect(html).toContain(`border:1px solid ${cfg.theme.colors.hairline}`);
        expect(html).toContain(`gap:${cfg.theme.space.sm}`);
        expect(html).toContain("border-radius:16px");
        // The panel's own padding, corner and height are the recipe's to set, not added under it.
        expect(html).not.toContain(`padding:${cfg.theme.space.xl}`);
        expect(html).not.toContain(`border-radius:${cfg.theme.radii.panel}`);
        expect(html).not.toContain("height:100%");
    });

    it("renders byte for byte as before when it names no recipe, or one the site does not have", () => {
        const plain = defineConfig({ site: SITE });
        const withRecipes = configWith({ card: CARD });
        const page = [
            panel({ tone: "accent" }),
            { type: "section", props: { tone: "inverse", content: [[{ type: "text", props: { value: "Hi", variant: "title" } }]] } },
            { type: "button", props: { label: "Go", href: "/go" } },
            { type: "tabGroup", props: { content: [[{ type: "tabPanel", props: { label: "One", group: "g", open: true, content: [[]] } }]] } },
        ];

        const before = render(page, plain);
        expect(render(page, withRecipes)).toBe(before);
        const unknown = page.map((b) => ({ ...b, props: { ...b.props, recipe: "nothing-by-this-name" } }));
        expect(render(unknown, withRecipes)).toBe(before);
    });

    it("resolves a token and drops only the declaration whose reference does not resolve", () => {
        const cfg = configWith(
            { brand: { style: { color: "{cms-ink}", background: "{nope}", padding: "{space.nope}", margin: "0" } } },
            { "cms-ink": "#1D3A8A" },
        );
        const html = render([{ type: "text", props: { value: "Hi", recipe: "brand" } }], cfg);

        expect(html).toContain('style="color:#1D3A8A;margin:0"');
    });

    it("re-checks a recipe at draw time, so one put on the theme by hand cannot inject either", () => {
        const theme = resolveTheme(undefined);
        const forged = {
            ...theme,
            recipes: {
                bad: {
                    class: '"><script>alert(1)</script>',
                    style: { color: "red;position:fixed", background: "url(https://evil.example)", "z-index": "9", padding: "2px" },
                },
            },
        };

        expect(recipeLook(forged, "bad")).toEqual({ style: { padding: "2px" } });
        const html = renderToStaticMarkup(
            <BlockList blocks={resolveBlocks([panel({ recipe: "bad" })], createBlockRegistry(defineConfig({ site: SITE })), { perViewer: false })} theme={forged} />,
        );
        expect(html).not.toContain("position:fixed");
        expect(html).not.toContain("url(");
        expect(html).not.toContain("<script>");
    });

    it("keeps what makes a sticky band sticky and a flow a flow", () => {
        const cfg = configWith({ bar: { style: { position: "relative", padding: "4px" } }, cells: { style: { display: "grid", gap: "16px" } } });
        const sticky = render([{ type: "stickyBar", props: { recipe: "bar", content: [[]] } }], cfg);
        const flow = render([{ type: "flow", props: { recipe: "cells", content: [[]] } }], cfg);

        expect(sticky).toContain("position:sticky");
        expect(sticky).not.toContain("position:relative");
        expect(flow).toContain("--bp-list:contents");
        expect(flow).toContain("display:grid;gap:16px");
    });

    it("sets the tone's variables for what is inside when the block also names a tone", () => {
        const cfg = configWith({ dark: { style: { background: "#101223", "--bp-ink": "#FFFFFF" } } });
        const alone = render([panel({ recipe: "dark" })], cfg);
        const toned = render([panel({ recipe: "dark", tone: "inverse" })], cfg);

        expect(alone).toContain("--bp-ink:#FFFFFF");
        expect(alone).not.toContain("--bp-ink-soft:");
        expect(toned).toContain(`--bp-ink-soft:${cfg.theme.colors.inverseInk}`);
    });

    it("is a field on every primitive, so barakoBrew offers it everywhere", () => {
        const primitives = blockSchema(createBlockRegistry(defineConfig({ site: SITE }))).blocks.filter((b) => b.layer === "primitive");

        expect(primitives.length).toBeGreaterThan(20);
        for (const block of primitives) {
            expect(block.fields.find((f) => f.name === "recipe"), block.type).toMatchObject({ kind: "text", bindable: true });
        }
    });

    it("takes its name from a preset's own prop, so one preset draws more than one look", async () => {
        const cfg = defineConfig({
            site: SITE,
            theme: { recipes: { "card-cms": { style: { background: "#EEEBFD" } }, "card-brew": { style: { background: "#FFF3D6" } } } },
            presets: [
                {
                    type: "productCard",
                    label: "Product card",
                    fields: [
                        { name: "name", kind: "text", required: true },
                        { name: "product", kind: "text" },
                    ],
                    blocks: [
                        {
                            type: "panel",
                            props: {
                                recipe: "card-{{props.product}}",
                                content: [[{ type: "text", props: { value: "{{props.name}}" } }]],
                            },
                        },
                    ],
                },
            ],
        });
        const registry = createBlockRegistry(cfg);
        const raw = [
            { type: "productCard", props: { name: "barakoCMS", product: "cms" } },
            { type: "productCard", props: { name: "barakoBrew", product: "brew" } },
        ];
        const bound = await bindBlocks(resolveBlocks(raw, registry, { perViewer: false }), { config: cfg, registry, scopes: {} });
        const html = renderToStaticMarkup(<BlockList blocks={bound} theme={cfg.theme} />);

        expect(html).toContain('style="background:#EEEBFD"');
        expect(html).toContain('style="background:#FFF3D6"');
    });
});

describe("inline marks in a text block", () => {
    const text = (props: Record<string, unknown>, cfg = configWith({ card: CARD })) =>
        render([{ type: "text", props: { format: "inline", ...props } }], cfg);

    it("draws code, emphasis, strong, links and the accent", () => {
        const html = text({ value: "Run `dotnet add`, *then* **ship** to [the docs](/docs) with ==barakoCMS==" });

        expect(html).toContain("<code>dotnet add</code>");
        expect(html).toContain("<em>then</em>");
        expect(html).toContain("<strong>ship</strong>");
        expect(html).toContain('<a href="/docs">the docs</a>');
        expect(html).toContain('<span class="bp-accent">barakoCMS</span>');
        expect(html).toContain('class="bp-inline"');
        expect(html).toContain(":where(.bp-inline) code{");
    });

    it("keeps the words of an unsafe link and drops where it went", () => {
        const html = text({ value: "[click](javascript:alert(1)) and [x](data:text/html,hi)" });

        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("data:");
        expect(html).toContain("click and x");
    });

    it("escapes raw HTML rather than passing it through", () => {
        const html = text({ value: '**Hi** <img src=x onerror="alert(1)"> <script>alert(1)</script>' });

        // Rendered as marks, so this is the inline renderer escaping and not the plain text path.
        expect(html).toContain("<strong>Hi</strong>");

        expect(html).not.toContain("<img");
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("draws no block of its own, so a heading stays one element", () => {
        expect(renderInlineMarkdown("# Not a heading")).toBe("# Not a heading");
        expect(renderInlineMarkdown("- not a list")).toBe("- not a list");
        expect(renderInlineMarkdown("![alt](https://x.example/a.png)")).toBe("alt");
        const html = text({ value: "# Title", variant: "title" });
        expect(html).toMatch(/<h2 style="[^"]*" class="bp-inline">/);
        expect(html).toContain("># Title</h2>");
        expect(html).not.toContain("<h1");
    });

    it("leaves the marks as typed when the block is plain, which is the default", () => {
        const html = render([{ type: "text", props: { value: "a **b** ==c==" } }]);

        expect(html).toContain(">a **b** ==c==<");
        expect(html).not.toContain("bp-inline");
    });

    it("lets a recipe tint the code inside one block", () => {
        const cfg = configWith({ chip: { class: "lede", style: { "--bp-code-bg": "#EEEBFD", "--bp-code-radius": "5px", "--bp-code-pad": "1px 5px" } } });
        const html = text({ value: "Uses `x`", recipe: "chip" }, cfg);

        expect(html).toContain('class="bp-inline lede"');
        expect(html).toContain("--bp-code-bg:#EEEBFD");
        expect(html).toContain("var(--bp-code-bg,transparent)");
    });
});
