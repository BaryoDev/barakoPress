import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * List and group fields (#124): a block that needs "a list of stages, each a label, a name and a
 * body" declares exactly that, instead of numbered fields or comma separated text parsed in the
 * component. Resolved, bound and published the way every other field is.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { blockSchema, defineBlock, resolveBlocks, readProps } = await import("./schema.js");
const { bindBlocks } = await import("./bind.js");
const { forgetPresetWarnings, presetsFrom } = await import("./presets.js");
const { createBlockSchemaRoute } = await import("../routes/block-schema.js");
import type { BindingProblem, BindingScopes } from "./bindings.js";
import type { BlockField, BlockRegistry } from "./schema.js";

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });

type Stage = { label: string; name?: string; body?: string; href?: string };

const stages = defineBlock<{ heading?: string; stages: Stage[]; tags?: string[]; scores?: number[]; lead?: Stage }>({
    type: "stages",
    label: "Stages",
    fields: [
        { name: "heading", kind: "text" },
        {
            name: "stages",
            kind: "list",
            label: "Stages",
            required: true,
            min: 2,
            max: 5,
            item: {
                kind: "group",
                label: "Stage",
                fields: [
                    { name: "label", kind: "text", required: true },
                    { name: "name", kind: "text" },
                    { name: "body", kind: "markdown" },
                    { name: "href", kind: "url" },
                ],
            },
        },
        { name: "tags", kind: "list", item: { kind: "text" }, max: 3 },
        { name: "scores", kind: "list", item: { kind: "number", min: 0, max: 10 } },
        {
            name: "lead",
            kind: "group",
            fields: [
                { name: "label", kind: "text", required: true },
                { name: "href", kind: "url" },
            ],
        },
    ],
    component: ({ props }) => (
        <ol>
            {props.stages.map((s, i) => (
                <li key={i}>{`${s.label}/${s.name ?? ""}`}</li>
            ))}
            {props.tags?.map((t, i) => <li key={`t${i}`}>{`tag:${t}`}</li>)}
        </ol>
    ),
});

const registry = createBlockRegistry(config, [stages]);

const FOUR = [
    { label: "Plan", name: "Scope", body: "What it is." },
    { label: "Build", name: "Make", body: "Make it." },
    { label: "Ship", name: "Release" },
    { label: "Run", name: "Operate", href: "/run" },
];

function resolved(props: Record<string, unknown>, reg: BlockRegistry = registry) {
    return resolveBlocks([{ type: "stages", props }], reg, { perViewer: false });
}

async function bound(props: Record<string, unknown>, scopes: BindingScopes = {}, reg: BlockRegistry = registry) {
    const problems: BindingProblem[] = [];
    const out = await bindBlocks(resolved(props, reg), {
        config,
        registry: reg,
        scopes,
        onProblem: (p) => problems.push(p),
    });
    return { blocks: out, problems };
}

afterEach(() => forgetPresetWarnings());

describe("a list of groups", () => {
    it("round-trips through resolve and bind, a fifth stage with no code change", async () => {
        const five = [...FOUR, { label: "Retire", name: "Sunset" }];
        const { blocks } = await bound({ stages: five });

        expect(blocks).toHaveLength(1);
        const got = blocks[0].props.stages as Stage[];
        expect(got).toHaveLength(5);
        expect(got.map((s) => s.label)).toEqual(["Plan", "Build", "Ship", "Run", "Retire"]);
        expect(got[3]).toEqual({ label: "Run", name: "Operate", href: "/run" });

        const html = renderToStaticMarkup(<BlockList blocks={blocks} theme={config.theme} />);
        expect(html).toContain("Retire/Sunset");
    });

    it("hands the component only the keys a group declares", () => {
        const out = resolved({ stages: [{ label: "A", extra: "no" }, { label: "B", onclick: "x" }] });

        expect(out).toHaveLength(1);
        const got = out[0].props.stages as Record<string, unknown>[];
        expect(got).toHaveLength(2);
        for (const stage of got) expect(Object.keys(stage)).toEqual(["label"]);
    });

    it("binds strings inside a group like any string field", async () => {
        const { blocks } = await bound(
            {
                stages: [
                    { label: "{{site.Name}} plans", name: "one" },
                    { label: "Build", href: "{{site.Docs}}" },
                ],
                lead: { label: "Start at {{site.Name}}" },
            },
            { site: () => ({ Name: "Baryo", Docs: "https://docs.test/start" }) },
        );

        expect(blocks).toHaveLength(1);
        const got = blocks[0].props.stages as Stage[];
        expect(got).toHaveLength(2);
        expect(got[0].label).toBe("Baryo plans");
        expect(got[1].href).toBe("https://docs.test/start");
        expect(blocks[0].props.lead).toEqual({ label: "Start at Baryo" });
    });

    it("drops the block when a bound url inside a group is unsafe", async () => {
        const { blocks } = await bound(
            { stages: [{ label: "A" }, { label: "B", href: "{{site.Docs}}" }] },
            { site: () => ({ Docs: "javascript:alert(1)" }) },
        );
        expect(blocks).toEqual([]);
    });

    it("names the nested field a binding problem came from", async () => {
        const { blocks, problems } = await bound({ stages: [{ label: "A" }, { label: "B", name: "{{site.Missing}}" }] }, {
            site: () => ({}),
        });

        expect(blocks).toHaveLength(1);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ block: "stages", field: "stages.1.name", reason: "no value" });
    });
});

describe("a stored value of the wrong shape", () => {
    const cases: [string, Record<string, unknown>][] = [
        ["a list given plain text", { stages: "Plan, Build, Ship" }],
        ["a list given an object", { stages: { label: "A" } }],
        ["a list item that is not a group", { stages: [{ label: "A" }, "B"] }],
        ["a group item missing its required field", { stages: [{ label: "A" }, { name: "no label" }] }],
        ["a group item with a field of the wrong kind", { stages: [{ label: "A" }, { label: 2 }] }],
        ["an unsafe url inside a group", { stages: [{ label: "A" }, { label: "B", href: "javascript:alert(1)" }] }],
        ["a text list holding a number", { stages: FOUR, tags: ["a", 2] }],
        ["a number list holding text", { stages: FOUR, scores: [1, "2"] }],
        ["a number item out of its range", { stages: FOUR, scores: [1, 11] }],
        ["a null item", { stages: [{ label: "A" }, null] }],
        ["a group given a list", { stages: FOUR, lead: [{ label: "A" }] }],
        ["a group given text", { stages: FOUR, lead: "A" }],
        ["a whole-value binding with a format", { stages: FOUR, tags: "{{item.Tags | upper}}" }],
    ];

    it.each(cases)("drops the block: %s", (_, props) => {
        expect(resolved(props)).toEqual([]);
    });

    it("still renders a block whose list and group hold their shape", () => {
        const out = resolved({ stages: FOUR, tags: ["a", "b"], scores: [0, 10], lead: { label: "Go", href: "/go" } });
        expect(out).toHaveLength(1);
        expect(out[0].props.scores).toEqual([0, 10]);
        expect(out[0].props.lead).toEqual({ label: "Go", href: "/go" });
    });

    it("treats an empty list as absent, so a required one drops the block", () => {
        expect(resolved({ stages: [] })).toEqual([]);
        const out = resolved({ stages: FOUR, tags: [] });
        expect(out).toHaveLength(1);
        expect(out[0].props).not.toHaveProperty("tags");
    });
});

describe("how long a list may be", () => {
    it("refuses fewer items than min and more than max", () => {
        expect(resolved({ stages: [{ label: "A" }] })).toEqual([]);
        expect(resolved({ stages: [...FOUR, { label: "E" }, { label: "F" }] })).toEqual([]);
        expect(resolved({ stages: FOUR, tags: ["a", "b", "c", "d"] })).toEqual([]);
    });

    it("takes the bounds themselves", () => {
        expect(resolved({ stages: FOUR.slice(0, 2) })).toHaveLength(1);
        expect(resolved({ stages: [...FOUR, { label: "E" }] })).toHaveLength(1);
        expect(resolved({ stages: FOUR, tags: ["a", "b", "c"] })).toHaveLength(1);
    });

    it("caps a list with no max, so a pasted list cannot make one render expensive", () => {
        const many = Array.from({ length: 101 }, (_, i) => i % 10);
        expect(resolved({ stages: FOUR, scores: many.slice(0, 100) })).toHaveLength(1);
        expect(resolved({ stages: FOUR, scores: many })).toEqual([]);
    });
});

describe("a binding that resolves to an array", () => {
    const item = (values: Record<string, unknown>): BindingScopes => ({ item: () => values });

    it("fills a list field from {{item.Tags}}", async () => {
        const { blocks } = await bound({ stages: FOUR, tags: "{{item.Tags}}" }, item({ Tags: ["fast", "plain"] }));

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props.tags).toEqual(["fast", "plain"]);
        const html = renderToStaticMarkup(<BlockList blocks={blocks} theme={config.theme} />);
        expect(html).toContain("tag:fast");
        expect(html).toContain("tag:plain");
    });

    it("fills a list of groups, keeping only the declared keys", async () => {
        const rows = [
            { label: "Plan", name: "Scope", Secret: "no" },
            { label: "Build", name: "Make" },
        ];
        const { blocks } = await bound({ stages: "{{item.Stages}}" }, item({ Stages: rows }));

        expect(blocks).toHaveLength(1);
        const got = blocks[0].props.stages as Record<string, unknown>[];
        expect(got).toHaveLength(2);
        expect(got[0]).toEqual({ label: "Plan", name: "Scope" });
    });

    it("never rescans what the binding resolved to", async () => {
        const { blocks } = await bound(
            { stages: FOUR, tags: "{{item.Tags}}" },
            { item: () => ({ Tags: ["{{site.Name}}", "plain"] }), site: () => ({ Name: "LEAKED" }) },
        );

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props.tags).toEqual(["{{site.Name}}", "plain"]);
    });

    it("checks each item against the field, leaving out the ones that fail", async () => {
        const { blocks } = await bound({ stages: FOUR, tags: "{{item.Tags}}" }, item({ Tags: ["a", 7, null, "b"] }));

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props.tags).toEqual(["a", "b"]);
    });

    it("keeps an unsafe url out of a bound list of groups", async () => {
        const { blocks } = await bound(
            { stages: "{{item.Stages}}" },
            item({
                Stages: [
                    { label: "A", href: "javascript:alert(1)" },
                    { label: "B", href: "/b" },
                    { label: "C" },
                ],
            }),
        );

        expect(blocks).toHaveLength(1);
        const got = blocks[0].props.stages as Stage[];
        expect(got).toHaveLength(2);
        expect(got.map((s) => s.label)).toEqual(["B", "C"]);
    });

    it("cuts a bound list at max, since the data is not the editor's to shorten", async () => {
        const { blocks } = await bound({ stages: FOUR, tags: "{{item.Tags}}" }, item({ Tags: ["a", "b", "c", "d", "e"] }));

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props.tags).toEqual(["a", "b", "c"]);
    });

    it("drops the block when a bound list comes up short of min", async () => {
        const { blocks } = await bound({ stages: "{{item.Stages}}" }, item({ Stages: [{ label: "only one" }] }));
        expect(blocks).toEqual([]);
    });

    it("drops the block when the binding is not an array", async () => {
        const { blocks } = await bound({ stages: FOUR, tags: "{{item.Tags}}" }, item({ Tags: "a, b" }));
        expect(blocks).toEqual([]);
    });

    it("treats a missing value as absent and reports it", async () => {
        const { blocks, problems } = await bound({ stages: FOUR, tags: "{{item.Tags}}" }, item({}));

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props).not.toHaveProperty("tags");
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatchObject({ binding: "{{item.Tags}}", reason: "no value", field: "tags" });
    });

    it("fills a group from a bound object", async () => {
        const { blocks } = await bound(
            { stages: FOUR, lead: "{{item.Lead}}" },
            item({ Lead: { label: "Go", href: "/go", Other: 1 } }),
        );

        expect(blocks).toHaveLength(1);
        expect(blocks[0].props.lead).toEqual({ label: "Go", href: "/go" });
    });
});

describe("a preset with a list field", () => {
    const presets = presetsFrom([
        {
            type: "taglines",
            label: "Taglines",
            fields: [
                { name: "words", kind: "list", item: { kind: "text" }, min: 1, max: 8 },
                {
                    name: "steps",
                    kind: "list",
                    item: { kind: "group", fields: [{ name: "label", kind: "text", required: true }] },
                },
            ],
            blocks: [
                { type: "rotatingText", props: { words: "{{props.words}}" } },
                { type: "stages", props: { stages: "{{props.steps}}" } },
            ],
        },
    ]);
    const withPreset = createBlockRegistry(config, [stages], { presets });

    it("reads list and group kinds from a stored preset", () => {
        expect(presets).toHaveLength(1);
        const fields = presets[0].fields;
        expect(fields.map((f) => f.kind)).toEqual(["list", "list"]);
        expect(fields[0].item).toEqual({ kind: "text" });
        expect(fields[1].item?.kind).toBe("group");
        expect(fields[1].item?.fields?.map((f) => f.name)).toEqual(["label"]);
    });

    it("passes {{props.x}} of a list into a primitive that takes a list", async () => {
        const raw = [
            {
                type: "taglines",
                props: { words: ["fast", "{{site.Name}}", "yours"], steps: [{ label: "One" }, { label: "Two" }] },
            },
        ];
        const out = await bindBlocks(resolveBlocks(raw, withPreset, { perViewer: false }), {
            config,
            registry: withPreset,
            scopes: { site: () => ({ Name: "Baryo" }) },
        });

        expect(out.map((b) => b.definition.type)).toEqual(["rotatingText", "stages"]);
        expect(out[0].props.words).toEqual(["fast", "Baryo", "yours"]);
        expect(out[1].props.stages).toEqual([{ label: "One" }, { label: "Two" }]);

        const html = renderToStaticMarkup(<BlockList blocks={out} theme={config.theme} />);
        expect(html).toContain(">Baryo<");
        expect(html).toContain("Two/");
    });

    it("drops a stored preset field whose list has no item kind it knows", () => {
        const read = presetsFrom([
            {
                type: "bad",
                fields: [
                    { name: "a", kind: "list", item: { kind: "slots" } },
                    { name: "b", kind: "list" },
                    { name: "c", kind: "group" },
                    { name: "d", kind: "list", item: { kind: "url" } },
                ],
                blocks: [],
            },
        ]);
        expect(read).toHaveLength(1);
        expect(read[0].fields.map((f) => f.name)).toEqual(["d"]);
    });
});

describe("rotatingText takes a list of words", () => {
    async function html(props: Record<string, unknown>, scopes: BindingScopes = {}) {
        const out = await bindBlocks(resolveBlocks([{ type: "rotatingText", props }], registry, { perViewer: false }), {
            config,
            registry,
            scopes,
        });
        return renderToStaticMarkup(<BlockList blocks={out} theme={config.theme} />);
    }

    it("draws each word in the list, commas and all", async () => {
        const out = await html({ words: ["one, two", "three"] });
        expect(out).toContain(">one, two<");
        expect(out).toContain(">three<");
    });

    it("draws the words a bound array holds", async () => {
        const out = await html({ words: "{{item.Tags}}" }, { item: () => ({ Tags: ["alpha", "beta"] }) });
        expect(out).toContain(">alpha<");
        expect(out).toContain(">beta<");
    });

    it("still reads the comma separated text a stored page already holds", async () => {
        const out = await html({ items: "fast, plain, yours" });
        expect(out).toContain(">plain<");
    });
});

describe("a definition with a list or a group", () => {
    const define = (fields: BlockField[]) => ({ type: "x", label: "X", fields, component: () => null });

    it("refuses a list with no item kind, or one it cannot hold", () => {
        expect(() => createBlockRegistry(config, [define([{ name: "a", kind: "list" }])])).toThrow(/item/);
        expect(() =>
            createBlockRegistry(config, [define([{ name: "a", kind: "list", item: { kind: "slots" as never } }])]),
        ).toThrow(/item/);
    });

    it("refuses a group with no fields, a slots field inside one, or a name used twice inside one", () => {
        expect(() => createBlockRegistry(config, [define([{ name: "g", kind: "group" }])])).toThrow(/fields/);
        expect(() =>
            createBlockRegistry(config, [define([{ name: "g", kind: "group", fields: [{ name: "s", kind: "slots" }] }])]),
        ).toThrow(/slots/);
        expect(() =>
            createBlockRegistry(config, [
                define([
                    {
                        name: "g",
                        kind: "group",
                        fields: [
                            { name: "a", kind: "text" },
                            { name: "a", kind: "text" },
                        ],
                    },
                ]),
            ]),
        ).toThrow(/twice/);
    });

    it("refuses nesting deeper than three levels", () => {
        const g = (fields: BlockField[]): BlockField => ({ name: "g", kind: "group", fields });
        const leaf: BlockField = { name: "t", kind: "text" };
        expect(() => createBlockRegistry(config, [define([g([g([g([leaf])])])])])).not.toThrow();
        expect(() => createBlockRegistry(config, [define([g([g([g([g([leaf])])])])])])).toThrow(/deep/);
    });

    it("leaves a plain text field plain text", () => {
        expect(readProps([{ name: "t", kind: "text" }], { t: "a, b" })).toEqual({ t: "a, b" });
        expect(readProps([{ name: "t", kind: "text" }], { t: ["a", "b"] })).toBeNull();
    });
});

describe("the block schema at /api/blocks", () => {
    it("describes a list's item and a group's fields, with bindability resolved at every level", async () => {
        const res = createBlockSchemaRoute(registry)();
        const body = (await res.json()) as {
            version: number;
            blocks: { type: string; fields: Record<string, unknown>[] }[];
        };

        expect(body.version).toBe(3);
        const block = body.blocks.find((b) => b.type === "stages");
        expect(block).toBeDefined();
        const fields = block?.fields ?? [];
        expect(fields.length).toBeGreaterThan(0);

        const list = fields.find((f) => f.name === "stages");
        expect(list).toMatchObject({ kind: "list", required: true, min: 2, max: 5, bindable: true });
        const listItem = list?.item as { kind: string; label: string; bindable: boolean; fields: Record<string, unknown>[] };
        expect(listItem).toMatchObject({ kind: "group", label: "Stage", bindable: true });
        expect(listItem.fields).toHaveLength(4);
        expect(listItem.fields.map((f) => [f.name, f.kind, f.bindable])).toEqual([
            ["label", "text", true],
            ["name", "text", true],
            ["body", "markdown", true],
            ["href", "url", true],
        ]);

        expect(fields.find((f) => f.name === "tags")).toMatchObject({
            kind: "list",
            max: 3,
            item: { kind: "text", bindable: true },
        });
        expect(fields.find((f) => f.name === "scores")).toMatchObject({
            kind: "list",
            item: { kind: "number", min: 0, max: 10, bindable: false },
        });

        const group = fields.find((f) => f.name === "lead");
        expect(group).toMatchObject({ kind: "group", bindable: true });
        const groupFields = group?.fields as Record<string, unknown>[];
        expect(groupFields).toHaveLength(2);
        expect(groupFields.map((f) => f.name)).toEqual(["label", "href"]);
    });

    it("hands out copies of nested fields, so changing the result cannot change what renders", () => {
        const nested = blockSchema(registry)
            .blocks.find((b) => b.type === "stages")
            ?.fields.find((f) => f.name === "stages")?.item?.fields;
        expect(nested?.length).toBeGreaterThan(0);
        nested?.splice(0);

        expect(resolved({ stages: FOUR })).toHaveLength(1);
        expect(resolved({ stages: FOUR })[0].props.stages).toHaveLength(4);
    });
});
