import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The block schema on a request-time site (#134): each tenant is offered its own presets and tones,
 * found the way a page finds them, and a build-time site gets the answer it always got.
 *
 * `headers()` throwing when nothing set it is the assertion that a build-time site never reads the
 * request.
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
const { forgetCachedReads, purgeTagsFor } = await import("../delivery.js");
const { createBlockRegistry } = await import("../blocks/registry.js");
const { resolveSite } = await import("../site.js");
const { createBlockSchemaRoute } = await import("./block-schema.js");
type BlockSchema = import("../blocks/schema.js").BlockSchema;

const CMS = "http://cms.test";
const CONSOLE = "https://brew.example";

const preset = (type: string) => ({
    type,
    label: type,
    fields: [{ name: "heading", kind: "text" as const }],
    blocks: [{ type: "text", props: { value: "{{props.heading}}" } }],
});
const tone = { ink: "#111111", bg: "#fafafa", edge: "#cccccc" };

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    alpha: {
        host: "alpha.example",
        settings: { Name: "Alpha", Presets: [preset("alphaBand")], Tones: { alphatone: tone } },
    },
    beta: {
        host: "beta.example",
        settings: { Name: "Beta", Presets: [preset("betaBand")], Tones: { betatone: tone } },
    },
};

type Call = { path: string; tenant: string | null; tags: string[] };
let calls: Call[] = [];

function cms(options: { down?: boolean } = {}) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ path: url.pathname, tenant, tags: init?.next?.tags ?? [] });
        if (options.down) throw new Error("ECONNREFUSED");

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const found = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return found ? Response.json({ handle: found[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (t && url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: t.settings }],
                page: 1,
                pageSize: 1,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });
const registry = createBlockRegistry(config);
const GET = createBlockSchemaRoute(config, registry, { consoleOrigins: [CONSOLE] });

function ask(host: string, origin?: string): Request {
    requestHeaders = new Headers({ host, ...(origin ? { origin } : {}) });
    return new Request(`https://${host}/api/blocks`, { headers: requestHeaders });
}

const types = (schema: BlockSchema) => schema.blocks.map((b) => b.type);

/** Every option any select in the schema offers, nested fields included. */
function selectOptions(schema: BlockSchema): Set<string> {
    const out = new Set<string>();
    type Field = { options?: string[]; fields?: Field[]; item?: { fields?: Field[] } };
    const walk = (fields: Field[] | undefined) => {
        for (const f of fields ?? []) {
            for (const o of f.options ?? []) out.add(o);
            walk(f.fields);
            walk(f.item?.fields);
        }
    };
    for (const b of schema.blocks) walk(b.fields as Field[]);
    return out;
}

beforeEach(() => {
    forgetCachedReads();
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    requestHeaders = null;
});

describe("the block schema on a request-time site", () => {
    it("lists the requesting tenant's presets and tones and not another tenant's", async () => {
        const alpha = (await (await GET(ask("alpha.example"))).json()) as BlockSchema;
        expect(types(alpha)).toContain("alphaBand");
        expect(types(alpha)).not.toContain("betaBand");
        expect(selectOptions(alpha).has("alphatone")).toBe(true);
        expect(selectOptions(alpha).has("betatone")).toBe(false);

        const beta = (await (await GET(ask("beta.example"))).json()) as BlockSchema;
        expect(types(beta)).toContain("betaBand");
        expect(types(beta)).not.toContain("alphaBand");
        expect(selectOptions(beta).has("betatone")).toBe(true);
        expect(selectOptions(beta).has("alphatone")).toBe(false);
    });

    it("answers an unknown host 404 with no schema, as the binding report does", async () => {
        const res = await GET(ask("nobody.example", CONSOLE));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "no site" });
        expect(res.headers.get("access-control-allow-origin")).toBe(CONSOLE);
        expect(res.headers.get("vary")).toBe("Origin");
    });

    it("answers 503 rather than throwing when the tenant lookup fails", async () => {
        vi.stubGlobal("fetch", cms({ down: true }));
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await GET(ask("alpha.example"));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "unavailable" });
    });

    it("reads each tenant's settings under that tenant's cache tag, the one a settings delivery purges", async () => {
        await GET(ask("alpha.example"));
        await GET(ask("beta.example"));

        const settings = calls.filter((c) => c.path === "/api/public/site");
        expect(settings).toHaveLength(2);
        for (const [read, tenant] of [[settings[0], "alpha"], [settings[1], "beta"]] as const) {
            expect(read.tenant).toBe(tenant);
            expect(read.tags.length).toBeGreaterThan(0);
            expect(read.tags.every((tag) => tag.startsWith(`cms:${tenant}`))).toBe(true);

            requestHeaders = new Headers({ host: TENANTS[tenant].host });
            const resolved = (await resolveSite(config, requestHeaders))!;
            const purged = purgeTagsFor(resolved, { type: "site" });
            expect(purged.length).toBeGreaterThan(0);
            expect(purged.some((tag) => read.tags.includes(tag))).toBe(true);
        }
    });

    it("keeps CORS as it was: a listed origin is echoed, an unlisted one is not", async () => {
        const listed = await GET(ask("alpha.example", CONSOLE));
        expect(listed.status).toBe(200);
        expect(listed.headers.get("access-control-allow-origin")).toBe(CONSOLE);
        expect(listed.headers.get("access-control-allow-credentials")).toBeNull();
        expect(listed.headers.get("vary")).toBe("Origin");

        const unlisted = await GET(ask("alpha.example", "https://evil.example"));
        expect(unlisted.headers.get("access-control-allow-origin")).toBeNull();
        expect(unlisted.headers.get("vary")).toBe("Origin");
    });

    it("varies on the tenant header when the operator named one", async () => {
        const named = defineConfig({ sites: { tenantHeader: "X-Press-Tenant" }, cmsUrl: CMS });
        const route = createBlockSchemaRoute(named, createBlockRegistry(named));
        requestHeaders = new Headers({ host: "anything.example", "x-press-tenant": "beta" });
        const res = await route(new Request("https://anything.example/api/blocks", { headers: requestHeaders }));
        expect(res.headers.get("vary")).toBe("Origin, x-press-tenant");
        expect(types((await res.json()) as BlockSchema)).toContain("betaBand");
    });
});

describe("the block schema on a build-time site", () => {
    it("answers byte for byte what the registry-only route answers, without reading the request", async () => {
        const built = defineConfig({
            site: { name: "Built", url: "https://built.example" },
            cmsUrl: CMS,
            presets: [preset("builtBand")],
            theme: { tones: { builttone: tone } },
        });
        const builtRegistry = createBlockRegistry(built);
        const fetchMock = cms();
        vi.stubGlobal("fetch", fetchMock);

        const request = () => new Request("https://built.example/api/blocks", { headers: { origin: CONSOLE } });
        const before = createBlockSchemaRoute(builtRegistry, { consoleOrigins: [CONSOLE] })(request());
        const after = await createBlockSchemaRoute(built, builtRegistry, { consoleOrigins: [CONSOLE] })(request());

        const text = await after.text();
        expect(text).toBe(await before.text());
        expect(text).toContain("builtBand");
        expect(text).toContain("builttone");
        expect(after.status).toBe(before.status);
        expect([...after.headers]).toEqual([...before.headers]);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
