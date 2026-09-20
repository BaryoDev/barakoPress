import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { DEFAULT_THEME, resolveTheme } = await import("../theme.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { blockSchema, resolveBlocks } = await import("./schema.js");
const { primitiveBlocks } = await import("./primitives.js");

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });
const registry = createBlockRegistry(config);

function render(raw: unknown, cfg = config): string {
    const blocks = resolveBlocks(raw, createBlockRegistry(cfg), { perViewer: false });
    return renderToStaticMarkup(<BlockList blocks={blocks} theme={cfg.theme} />);
}

const box = (content: unknown[]) => ({ type: "section", props: { content: [content] } });

describe("layout primitives", () => {
    it("takes its tone, padding and width from the theme", () => {
        const html = render([
            { type: "section", props: { tone: "accent", padding: "xl", width: "prose", content: [[]] } },
        ]);

        expect(html).toContain(`background:${config.theme.colors.accentTint}`);
        expect(html).toContain(`padding-top:${config.theme.space.xl}`);
        expect(html).toContain(`max-width:${config.theme.layout.prose}`);
    });

    it("follows the tenant's own scale, with no size of its own", () => {
        const roomy = defineConfig({
            site: { name: "T", url: "https://t.example" },
            theme: { space: { lg: "64px" }, layout: { columnMin: "320px" } },
        });

        const html = render([{ type: "stack", props: { gap: "lg", content: [[]] } }], roomy);

        expect(html).toContain("gap:64px");
        expect(html).not.toContain("gap:32px");
        expect(render([{ type: "grid", props: { columns: 3, items: [[], []] } }], roomy)).toContain("320px");
    });

    it("wraps a row rather than squeezing it, and keeps a grid to the columns asked for", () => {
        expect(render([{ type: "row", props: { items: [[], []] } }])).toContain("flex-wrap:wrap");
        expect(render([{ type: "grid", props: { columns: 4, items: [[]] } }])).toContain("repeat(4,");
    });

    /*
     * A four column flow at 390px used to be a page 1144px wide, because the track list was fixed at
     * four and the smallest a track could be was the column floor. Four floors and three gaps do not
     * fit on a phone, and a fixed track list does not wrap, so the phone scrolled sideways. The look
     * check against baryo.dev is what found it (#83), and the migration gate is read at 390px.
     *
     * What is asserted is the shape rather than the pixels: no fixed count, a track that is one
     * quarter of the row, and the floor still under it.
     */
    it("wraps a flow on a phone instead of scrolling it sideways", () => {
        const html = render([{ type: "flow", props: { columns: "4", gap: "lg", content: [[]] } }]);

        expect(html).toContain("display:grid");
        expect(html).not.toContain("repeat(4,");
        expect(html).toContain("repeat(auto-fit,");
        expect(html).toContain(`max(${DEFAULT_THEME.layout.columnMin}, calc((100% - 3 * ${DEFAULT_THEME.space.lg}) / 4))`);
    });

    it("gives a one column flow the whole row, with no gap taken off it", () => {
        expect(render([{ type: "flow", props: { columns: "1", content: [[]] } }])).toContain("/ 1)");
    });

    it("renders nested blocks inside the layout that holds them, in order", () => {
        const html = render([
            box([
                { type: "text", props: { value: "first" } },
                { type: "text", props: { value: "second" } },
            ]),
        ]);

        expect(html.indexOf("first")).toBeGreaterThan(-1);
        expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    });
});

describe("content primitives", () => {
    it("renders a text variant as the element and the size the theme gives that role", () => {
        const html = render([{ type: "text", props: { value: "A heading", variant: "title" } }]);

        expect(html).toContain("<h2");
        expect(html).toContain(`font-size:${config.theme.text.title}`);
    });

    it("falls back to body copy for a variant the theme does not have", () => {
        expect(render([{ type: "text", props: { value: "Words", variant: "gigantic" } }])).not.toContain("Words");
        expect(render([{ type: "text", props: { value: "Words" } }])).toContain("<p");
    });

    it("keeps rich text inside the prose column and escapes raw HTML in it", () => {
        const html = render([{ type: "richText", props: { markdown: "hi <script>alert(1)</script>" } }]);

        expect(html).toContain("bp-prose");
        expect(html).toContain(`max-width:${config.theme.layout.prose}`);
        expect(html).not.toContain("<script>");
    });

    it("frames an image unless the block says not to, which is how a stored one keeps its look", () => {
        const stored = render([{ type: "image", props: { src: "https://i.example/a.png", caption: "A caption" } }]);

        expect(stored).toContain(`border:1px solid ${config.theme.colors.hairline}`);
        expect(stored).toContain("A caption");
        expect(render([{ type: "image", props: { src: "https://i.example/a.png", frame: false } }])).not.toContain(
            "border:1px",
        );
    });

    it("frames only a host the site allows, over https", () => {
        const allowed = { type: "embed", props: { src: "https://player.vimeo.com/video/1", title: "A film" } };

        expect(render([allowed])).toContain("<iframe");
        expect(render([allowed])).toContain("sandbox=");
        for (const src of ["https://evil.example/x", "http://player.vimeo.com/video/1"]) {
            expect(render([{ type: "embed", props: { src, title: "A film" } }])).not.toContain("<iframe");
        }
    });

    it("lets a site name the hosts it frames", () => {
        const own = defineConfig({
            site: { name: "T", url: "https://t.example" },
            embedHosts: ["maps.example"],
        });

        expect(render([{ type: "embed", props: { src: "https://maps.example/m", title: "Map" } }], own)).toContain(
            "<iframe",
        );
        expect(
            render([{ type: "embed", props: { src: "https://player.vimeo.com/video/1", title: "F" } }], own),
        ).not.toContain("<iframe");
    });

    it("autoplays muted and looping or not at all", () => {
        const html = render([{ type: "video", props: { src: "https://v.example/a.mp4", autoplay: true } }]);

        expect(html).toContain("autoPlay");
        expect(html).toContain('muted=""');
        expect(html).toContain("loop");
    });

    it("draws only an icon it has a shape for", () => {
        expect(render([{ type: "icon", props: { name: "arrow" } }])).toContain("<svg");
        expect(render([{ type: "icon", props: { name: "sparkles" } }])).not.toContain("<svg");
    });

    it("renders a button as a link, because a button that navigates is one", () => {
        const html = render([{ type: "button", props: { label: "Read more", href: "/blog" } }]);

        expect(html).toContain('<a href="/blog"');
        expect(html).toContain("Read more");
        expect(html).not.toContain("<button");
    });

    it("drops a link whose destination would execute", () => {
        expect(render([{ type: "button", props: { label: "Bad", href: "javascript:alert(1)" } }])).not.toContain("Bad");
    });

    it("marks an external link noopener, and opens a new tab only when asked", () => {
        const html = render([{ type: "link", props: { label: "Docs", href: "https://docs.example" } }]);

        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).not.toContain("_blank");
        expect(render([{ type: "link", props: { label: "D", href: "/d", newTab: true } }])).toContain('target="_blank"');
    });

    it("numbers a list when asked and bullets it otherwise", () => {
        expect(render([{ type: "list", props: { style: "number", items: [[]] } }])).toContain("<ol");
        expect(render([{ type: "list", props: { items: [[]] } }])).toContain("<ul");
    });
});

describe("the primitives as an editor sees them", () => {
    it("offers token names and never a colour or a length", () => {
        const schema = blockSchema(registry);
        const primitives = schema.blocks.filter((b) => b.layer === "primitive");

        expect(primitives.length).toBe(primitiveBlocks(config).length);
        const options = primitives.flatMap((b) => b.fields.flatMap((f) => f.options ?? []));
        expect(options.length).toBeGreaterThan(0);
        for (const option of options) {
            expect(option).not.toMatch(/^#|px$|rem$|^rgb|^hsl/);
        }
    });

    it("says which fields take a binding, so an editor knows where to offer one", () => {
        const blocks = blockSchema(registry).blocks;
        const text = blocks.find((b) => b.type === "text");
        const grid = blocks.find((b) => b.type === "grid");

        // Every string field, a choice included, so a preset can pass a tone through.
        expect(text?.fields.find((f) => f.name === "value")?.bindable).toBe(true);
        expect(text?.fields.find((f) => f.name === "variant")?.bindable).toBe(true);
        // A number is not text, and a slot holds blocks rather than a value.
        expect(grid?.fields.find((f) => f.name === "columns")?.bindable).toBe(false);
        expect(grid?.fields.find((f) => f.name === "items")?.bindable).toBe(false);
    });

    it("styles itself from the theme it is handed, not from the default one", () => {
        const other = resolveTheme({ colors: { pageBg: "#123456" } });
        const blocks = resolveBlocks([{ type: "section", props: { content: [[]] } }], registry, { perViewer: false });

        expect(renderToStaticMarkup(<BlockList blocks={blocks} theme={other} />)).toContain("background:#123456");
    });
});
