import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defineConfig } from "../config.js";
import { toPage } from "../cms.js";
import { BlockList } from "./render.js";
import { createBlockRegistry } from "./registry.js";
import {
    MAX_BLOCKS,
    MAX_DEPTH,
    blockSchema,
    defineBlock,
    resolveBlocks,
    type BlockRegistry,
} from "./schema.js";

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });
const registry = createBlockRegistry(config);

function render(raw: unknown, reg: BlockRegistry = registry, perViewer = false): string {
    const blocks = resolveBlocks(raw, reg, { perViewer });
    return renderToStaticMarkup(<BlockList blocks={blocks} theme={config.theme} />);
}

function types(raw: unknown, reg: BlockRegistry = registry, perViewer = false): string[] {
    return resolveBlocks(raw, reg, { perViewer }).map((b) => b.definition.type);
}

const text = (markdown: string) => ({ type: "richText", props: { markdown } });

describe("resolveBlocks", () => {
    it("keeps the stored order", () => {
        expect(
            types([
                text("one"),
                { type: "callToAction", props: { heading: "h", label: "l", href: "/x" } },
                text("two"),
            ]),
        ).toEqual(["richText", "callToAction", "richText"]);
    });

    it("renders nothing for a value that is not a list", () => {
        expect(types({ type: "richText", props: { markdown: "x" } })).toEqual([]);
        expect(types("[]")).toEqual([]);
    });

    it("drops a block whose type this site does not register, and keeps the rest", () => {
        expect(types([{ type: "carousel", props: {} }, text("kept")])).toEqual(["richText"]);
    });

    it("drops a block missing a required prop", () => {
        expect(
            types([
                { type: "callToAction", props: { heading: "h", label: "l" } },
                { type: "callToAction", props: { heading: "h", label: "l", href: "/ok" } },
            ]),
        ).toEqual(["callToAction"]);
    });

    it("drops a block whose link would execute, rather than rendering it without the link", () => {
        const html = render([
            { type: "callToAction", props: { heading: "Bad", label: "l", href: "javascript:alert(1)" } },
            { type: "callToAction", props: { heading: "Good", label: "l", href: "https://ok.example" } },
        ]);

        expect(html).toContain("Good");
        expect(html).not.toContain("Bad");
        expect(html).not.toContain("javascript:");
    });

    it("fails a block on a wrong value in an optional field", () => {
        expect(
            types([
                { type: "collection", props: { collection: "post", limit: 500 } },
                { type: "collection", props: { collection: "post", limit: 3 } },
                { type: "collection", props: { collection: "nope" } },
            ]),
        ).toEqual(["collection"]);
    });

    it("hands a component only the props its fields declare", () => {
        const [block] = resolveBlocks(
            [{ type: "image", props: { src: "https://img.example/a.png", alt: "a", onload: "x()" } }],
            registry,
            { perViewer: false },
        );

        expect(block.props).toEqual({ src: "https://img.example/a.png", alt: "a" });
    });

    it("leaves a per-viewer block out unless the caller renders per viewer", () => {
        const reg = createBlockRegistry(config, [
            defineBlock({ type: "mine", label: "Mine", fields: [], perViewer: true, component: () => "private" }),
        ]);
        const raw = [text("shared"), { type: "mine", props: {} }];

        expect(types(raw, reg, false)).toEqual(["richText"]);
        expect(types(raw, reg, true)).toEqual(["richText", "mine"]);
    });

    it("stops nesting at the depth limit", () => {
        let raw: unknown = [text("deepest")];
        for (let i = 0; i < MAX_DEPTH + 2; i++) raw = [{ type: "columns", props: { columns: [raw] } }];

        let depth = 0;
        let level = resolveBlocks(raw, registry, { perViewer: false });
        while (level.length > 0) {
            expect(level[0].definition.type).toBe("columns");
            depth++;
            level = level[0].slots.columns[0];
        }
        expect(depth).toBe(MAX_DEPTH);
    });

    it("reads at most MAX_BLOCKS from one list", () => {
        const raw = Array.from({ length: MAX_BLOCKS + 5 }, (_, i) => text(`b${i}`));
        expect(types(raw)).toHaveLength(MAX_BLOCKS);
    });

    it("spends one budget across nested lists, not one per list", () => {
        // Two levels of four full columns. Per list this was 100 * 4 * 100 blocks.
        const leaf = Array.from({ length: MAX_BLOCKS }, (_, i) => text(`leaf${i}`));
        const inner = { type: "columns", props: { columns: [leaf, leaf, leaf, leaf] } };
        const raw = Array.from({ length: MAX_BLOCKS }, () => ({
            type: "columns",
            props: { columns: [[inner], [inner], [inner], [inner]] },
        }));

        const count = (blocks: ReturnType<typeof resolveBlocks>): number =>
            blocks.reduce(
                (n, b) => n + 1 + Object.values(b.slots).flat().reduce((m, list) => m + count(list), 0),
                0,
            );
        const resolved = resolveBlocks(raw, registry, { perViewer: false });

        expect(resolved.length).toBeGreaterThan(0);
        expect(count(resolved)).toBeLessThanOrEqual(MAX_BLOCKS);
    });
});

describe("BlockList", () => {
    it("escapes raw HTML in rich text", () => {
        const html = render([text("hi <script>alert(1)</script>")]);

        expect(html).toContain("hi");
        expect(html).not.toContain("<script>");
    });

    it("renders nested blocks inside their column, in order", () => {
        const html = render([
            {
                type: "columns",
                props: { columns: [[text("left one"), text("left two")], [text("right")]] },
            },
        ]);

        expect(html).toContain('data-block="columns"');
        const left1 = html.indexOf("left one");
        const left2 = html.indexOf("left two");
        const right = html.indexOf("right");
        expect(left1).toBeGreaterThan(-1);
        expect(left1).toBeLessThan(left2);
        expect(left2).toBeLessThan(right);
    });

    it("renders a consumer block that replaces a built-in", () => {
        const reg = createBlockRegistry(config, [
            defineBlock<{ markdown: string }>({
                type: "richText",
                label: "Plain",
                fields: [{ name: "markdown", kind: "markdown", required: true }],
                component: ({ props }) => <p className="plain">{props.markdown}</p>,
            }),
        ]);

        expect(render([text("swapped")], reg)).toContain('<p class="plain">swapped</p>');
    });
});

describe("createBlockRegistry", () => {
    it("ships the primitives, the data blocks and the named blocks stored pages already use", () => {
        const layers: Record<string, string[]> = {};
        for (const block of registry.values()) (layers[block.layer ?? "block"] ??= []).push(block.type);

        expect(layers.primitive).toEqual([
            "section",
            "stack",
            "row",
            "grid",
            "flow",
            "panel",
            "spacer",
            "divider",
            "text",
            "richText",
            "image",
            "video",
            "embed",
            "icon",
            "button",
            "link",
            "list",
            "disclosure",
            "reveal",
            "rotatingText",
            "typingTerminal",
            "codeSample",
        ]);
        expect(layers.data).toEqual(["source", "repeat", "showIf", "slot", "pager"]);
        expect(layers.block).toEqual(["columns", "callToAction", "collection"]);
    });

    it("refuses one type registered twice by the site", () => {
        const block = defineBlock({ type: "x", label: "X", fields: [], component: () => null });
        expect(() => createBlockRegistry(config, [block, block])).toThrow(/registered twice/);
    });

    it("refuses a select with no options", () => {
        const block = defineBlock({
            type: "x",
            label: "X",
            fields: [{ name: "pick", kind: "select" }],
            component: () => null,
        });
        expect(() => createBlockRegistry(config, [block])).toThrow(/no options/);
    });
});

describe("blockSchema", () => {
    it("is plain data an editor can fetch", () => {
        const schema = blockSchema(registry);

        expect(schema.blocks).toHaveLength(registry.size);
        expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
        const cta = schema.blocks.find((b) => b.type === "callToAction");
        expect(cta?.fields.map((f) => f.name)).toEqual(["heading", "text", "label", "href"]);
    });

    it("hands out copies, so changing the result cannot change what the registry accepts", () => {
        const schema = blockSchema(registry);
        const options = schema.blocks
            .find((b) => b.type === "collection")
            ?.fields.find((f) => f.name === "collection")?.options;

        expect(options).toContain("post");
        options?.splice(0, options.length, "hijacked");

        expect(types([{ type: "collection", props: { collection: "post" } }])).toEqual(["collection"]);
        expect(types([{ type: "collection", props: { collection: "hijacked" } }])).toEqual([]);
    });

    it("offers only the collections this site can link to", () => {
        const noTaxonomy = defineConfig({
            site: { name: "T", url: "https://t.example" },
            types: { post: "article", author: undefined, category: undefined },
        });
        const field = blockSchema(createBlockRegistry(noTaxonomy))
            .blocks.find((b) => b.type === "collection")
            ?.fields.find((f) => f.name === "collection");

        expect(field?.options).toEqual(["post"]);
        expect(
            blockSchema(registry)
                .blocks.find((b) => b.type === "collection")
                ?.fields.find((f) => f.name === "collection")?.options,
        ).toEqual(["post", "author", "category"]);
    });
});

describe("toPage", () => {
    it("reads the site's own field names, not the blueprint's", () => {
        const landing = defineConfig({
            site: { name: "T", url: "https://t.example" },
            types: { page: "landing" },
            pageFields: { title: "Heading", slug: "Path", blocks: "Sections", body: undefined },
        });
        const page = toPage(landing, {
            id: "1",
            data: { Heading: "Hello", Path: "hello", Sections: [text("x")], Title: "wrong", Blocks: [] },
        });

        expect(page.title).toBe("Hello");
        expect(page.slug).toBe("hello");
        expect(page.blocks).toEqual([text("x")]);
        expect(page.body).toBe("");
    });
});

/*
 * Compile-time checks. `npx tsc --noEmit` reads this file, so an expect-error that stops being an
 * error fails the typecheck. None of these run.
 */
export const typeChecks = [
    defineBlock<{ title: string }>({
        type: "t",
        label: "T",
        // @ts-expect-error a field name the props do not have
        fields: [{ name: "heading", kind: "text", required: true }],
        component: ({ props }) => props.title,
    }),
    defineBlock<{ count: number }>({
        type: "t",
        label: "T",
        // @ts-expect-error a text kind on a number prop
        fields: [{ name: "count", kind: "text", required: true }],
        component: ({ props }) => props.count,
    }),
    defineBlock<{ title: string }>({
        type: "t",
        label: "T",
        // @ts-expect-error a prop the component treats as present, on a field that may be absent
        fields: [{ name: "title", kind: "text" }],
        component: ({ props }) => props.title,
    }),
    defineBlock<{ title?: string }, "body">({
        type: "t",
        label: "T",
        fields: [
            { name: "title", kind: "text" },
            { name: "body", kind: "slots" },
        ],
        component: ({ props, slots }) => [props.title, slots.body],
    }),
];
