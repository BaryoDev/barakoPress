import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * Plugin packages (#25): one image carries the sample plugin, and a tenant renders and is offered its
 * blocks only when its `Plugins` setting names it. The sample is imported by its package entry, the
 * way the derived image's generated press.plugins.ts imports it, and it imports the engine by name.
 */
let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { applySiteSettings } = await import("../site.js");
const { createBlockRegistry, registryFor } = await import("./registry.js");
const { definePlugin } = await import("./plugins.js");
const { pageBlocks } = await import("../screens/page-blocks.js");
const { BlockList } = await import("./render.js");
const { createBlockSchemaRoute } = await import("../routes/block-schema.js");
const { defineBlock } = await import("../index.js");
// Not a literal, so the repository's typecheck does not follow it into a package that resolves
// `barakopress` its own way. The sample has its own tsconfig, which CI checks.
const SAMPLE: string = "../../examples/plugin-sample/src/index.js";
const sample = ((await import(SAMPLE)) as { default: import("./plugins.js").PressPlugin }).default;
type BlockSchema = import("./schema.js").BlockSchema;
type PressConfig = import("../config.js").PressConfig;
type BlockRegistry = import("./schema.js").BlockRegistry;
type Page = import("../cms.js").Page;

const CMS = "http://cms.test";
const site = { name: "Built", url: "https://built.example" };

const PAGE = [
    { type: "text", props: { value: "before the tally" } },
    { type: "sampleTally", props: { count: 1234, label: "sites served", note: [[{ type: "text", props: { value: "and counting" } }]] } },
];

/** A page through the path the page screen takes: the request's registry, then resolve, bind and expand. */
async function render(config: PressConfig, registry: BlockRegistry, raw: unknown = PAGE): Promise<string> {
    const page = { id: "p", slug: "p", blocks: raw } as unknown as Page;
    const blocks = await pageBlocks(config, page, registryFor(config, registry));
    return renderToStaticMarkup(<BlockList blocks={blocks} theme={config.theme} />);
}

const base = defineConfig({ sites: {}, cmsUrl: CMS, tenant: "alpha" });
const registry = createBlockRegistry(base, [], { plugins: [sample] });

describe("a tenant and the plugins it enabled", () => {
    it("renders a plugin block for a tenant whose Plugins setting names the plugin", async () => {
        const html = await render(applySiteSettings(base, { Plugins: ["sample"] }, null), registry);
        expect(html).toContain('data-block="sampleTally"');
        expect(html).toContain("1,234");
        expect(html).toContain("sites served");
        expect(html).toContain("and counting");
    });

    it("refuses to render it for a tenant that did not, and renders the rest of the page", async () => {
        for (const settings of [{}, { Plugins: [] }, { Plugins: ["other"] }]) {
            const html = await render(applySiteSettings(base, settings, null), registry);
            expect(html).toContain("before the tally");
            expect(html).not.toContain("sampleTally");
            expect(html).not.toContain("1,234");
        }
    });

    it("drops a tenant preset that draws a plugin block the tenant has not enabled", async () => {
        const preset = {
            type: "tallyBand",
            label: "Tally band",
            fields: [],
            blocks: [{ type: "sampleTally", props: { count: 7, label: "in a band" } }],
        };
        const page = [{ type: "tallyBand", props: {} }];
        const on = applySiteSettings(base, { Plugins: ["sample"], Presets: [preset] }, null);
        const off = applySiteSettings(base, { Presets: [preset] }, null);
        expect(await render(on, registry, page)).toContain("in a band");
        expect(await render(off, registry, page)).not.toContain("in a band");
    });

    it("drops a preset compiled with the registry whose body draws a plugin block the site has not enabled", async () => {
        // Passed to createBlockRegistry rather than the config, so registryFor never compiles it again
        // and the body it holds is the one compiled while the plugin's block was in the registry.
        const preset = {
            type: "tallyBand",
            label: "Tally band",
            fields: [],
            blocks: [{ type: "sampleTally", props: { count: 7, label: "in a band" } }],
        };
        const page = [{ type: "tallyBand", props: {} }];
        const off = defineConfig({ site });
        const on = defineConfig({ site, plugins: ["sample"] });
        const options = { plugins: [sample], presets: [preset] };
        expect(await render(on, createBlockRegistry(on, [], options), page)).toContain("in a band");
        expect(await render(off, createBlockRegistry(off, [], options), page)).not.toContain("in a band");
    });

    it("renders an image with plugins installed exactly as one without, until a tenant turns one on", async () => {
        const plain = createBlockRegistry(base);
        const page = [{ type: "text", props: { value: "hello" } }, ...PAGE];
        expect(await render(base, registry, page)).toBe(await render(base, plain, page));
    });

    it("reads a build-time site's plugins from its config", async () => {
        const on = defineConfig({ site, plugins: ["sample"] });
        const off = defineConfig({ site });
        expect(await render(on, createBlockRegistry(on, [], { plugins: [sample] }))).toContain("1,234");
        expect(await render(off, createBlockRegistry(off, [], { plugins: [sample] }))).not.toContain("1,234");
    });
});

describe("the Plugins setting", () => {
    const configured = defineConfig({ sites: {}, cmsUrl: CMS, plugins: ["sample"] });

    it("replaces the configured list, and a list saved empty turns every plugin off", async () => {
        expect(applySiteSettings(configured, { Plugins: ["other"] }, null).plugins).toEqual(["other"]);
        expect(applySiteSettings(configured, { Plugins: [] }, null).plugins).toEqual([]);
    });

    it("keeps the configured list when the field is missing or not a list", async () => {
        expect(applySiteSettings(configured, {}, null).plugins).toEqual(["sample"]);
        expect(applySiteSettings(configured, { Plugins: "sample" }, null).plugins).toEqual(["sample"]);
    });

    it("drops what is not a plugin name, and takes the list as JSON text too", async () => {
        const read = applySiteSettings(base, { Plugins: ["sample", "Sample", "../x", 3, "", "sample"] }, null);
        expect(read.plugins).toEqual(["sample"]);
        expect(applySiteSettings(base, { Plugins: '["sample"]' }, null).plugins).toEqual(["sample"]);
    });
});

describe("the block schema with plugins installed", () => {
    const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
        alpha: { host: "alpha.example", settings: { Name: "Alpha", Plugins: ["sample"] } },
        beta: { host: "beta.example", settings: { Name: "Beta" } },
    };

    beforeEach(() => {
        forgetCachedReads();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = new URL(String(input));
                const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
                if (byHost) {
                    const found = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
                    return found ? Response.json({ handle: found[0] }) : new Response("", { status: 404 });
                }
                const tenant = TENANTS[new Headers(init?.headers).get("x-tenant") ?? ""];
                if (tenant && url.pathname === "/api/public/site") {
                    return Response.json({
                        items: [{ id: "s", data: tenant.settings }],
                        page: 1,
                        pageSize: 1,
                        totalItems: 1,
                        totalPages: 1,
                        hasNextPage: false,
                    });
                }
                return new Response("", { status: 404 });
            }),
        );
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        requestHeaders = null;
    });

    const config = defineConfig({ sites: {}, cmsUrl: CMS });
    const GET = createBlockSchemaRoute(config, createBlockRegistry(config, [], { plugins: [sample] }));
    async function schemaFor(host: string): Promise<BlockSchema> {
        requestHeaders = new Headers({ host });
        return (await (await GET(new Request(`https://${host}/api/blocks`, { headers: requestHeaders }))).json()) as BlockSchema;
    }

    it("lists a plugin's blocks, fields and all, for the tenant that enabled it and not another", async () => {
        const alpha = await schemaFor("alpha.example");
        const tally = alpha.blocks.find((b) => b.type === "sampleTally");
        expect(tally).toMatchObject({ label: "Tally", layer: "block", plugin: "sample" });
        expect(tally?.fields.map((f) => f.name)).toEqual(["count", "label", "tone", "note"]);
        expect(alpha.plugins).toEqual([{ name: "sample", enabled: true }]);

        const beta = await schemaFor("beta.example");
        expect(beta.blocks.length).toBeGreaterThan(0);
        expect(beta.blocks.map((b) => b.type)).not.toContain("sampleTally");
        expect(beta.plugins).toEqual([{ name: "sample", enabled: false }]);
    });

    it("lists a build-time site's plugin blocks only when its config enables them", async () => {
        const on = defineConfig({ site, plugins: ["sample"] });
        const off = defineConfig({ site });
        const read = async (c: PressConfig) =>
            (await (await createBlockSchemaRoute(c, createBlockRegistry(c, [], { plugins: [sample] }))(new Request("https://built.example/api/blocks"))).json()) as BlockSchema;
        expect((await read(on)).blocks.map((b) => b.type)).toContain("sampleTally");
        const closed = await read(off);
        expect(closed.blocks.length).toBeGreaterThan(0);
        expect(closed.blocks.map((b) => b.type)).not.toContain("sampleTally");
        expect(closed.plugins).toEqual([{ name: "sample", enabled: false }]);
    });
});

describe("what a plugin may register, and what it is given", () => {
    const block = (type: string) =>
        defineBlock<{ value?: string }>({ type, label: type, fields: [{ name: "value", kind: "text" }], component: () => null });

    it("refuses a plugin block that takes a name already registered", async () => {
        expect(() => createBlockRegistry(base, [], { plugins: [definePlugin({ name: "x", blocks: [block("text")] })] })).toThrow(
            /"text" is already registered by the engine/,
        );
        expect(() => createBlockRegistry(base, [block("mine")], { plugins: [definePlugin({ name: "x", blocks: [block("mine")] })] })).toThrow(
            /by the site/,
        );
        const a = definePlugin({ name: "a", blocks: [block("shared")] });
        const b = definePlugin({ name: "b", blocks: [block("shared")] });
        expect(() => createBlockRegistry(base, [], { plugins: [a, b] })).toThrow(/by plugin "a"/);
        expect(() => createBlockRegistry(base, [], { plugins: [a, a] })).toThrow(/installed twice/);
    });

    it("refuses a bad name, a block registered twice, and a preset body a plugin brings", async () => {
        expect(() => definePlugin({ name: "Bad Name", blocks: [] })).toThrow(/must be lowercase/);
        expect(() => definePlugin({ name: "x", blocks: [block("one"), block("one")] })).toThrow(/twice/);
        expect(() => definePlugin({ name: "x", blocks: [{ ...block("one"), preset: [] }] })).toThrow(/preset body/);
        // A plain object in place of definePlugin's output is checked all the same.
        expect(() => createBlockRegistry(base, [], { plugins: [{ name: "No", blocks: [] }] })).toThrow(/must be lowercase/);
    });

    it("hands a plugin component its props, its rendered slots and the theme, and nothing else", async () => {
        let given: string[] = [];
        const spy = definePlugin({
            name: "spy",
            blocks: [
                {
                    type: "spy",
                    label: "Spy",
                    fields: [{ name: "value", kind: "text" }],
                    component: (args) => {
                        given = Object.keys(args).sort();
                        return null;
                    },
                },
            ],
        });
        const config = defineConfig({ site, plugins: ["spy"] });
        await render(config, createBlockRegistry(config, [], { plugins: [spy] }), [{ type: "spy", props: { value: "v" } }]);
        expect(given).toEqual(["props", "slots", "theme"]);
    });

    it("checks a plugin block's fields against its props at compile time, as a built-in's are", async () => {
        defineBlock<{ count: number }>({
            type: "typed",
            label: "Typed",
            // @ts-expect-error a text kind on a number prop
            fields: [{ name: "count", kind: "text", required: true }],
            component: () => null,
        });
        defineBlock<{ count: number }>({
            type: "typed",
            label: "Typed",
            // @ts-expect-error a prop the component treats as present, on a field that may be absent
            fields: [{ name: "count", kind: "number" }],
            component: () => null,
        });
    });
});
