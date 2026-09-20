import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The binding report barakoBrew reads (#63).
 *
 * The three reasons already existed where a page binds; what is under test here is that a person
 * who is not holding the server log can get them, that each one names the block and the field it
 * came from, and that nobody without the tenant's key can.
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
const { createBlockRegistry } = await import("../blocks/registry.js");
const { bindingsKeyFor } = await import("../revalidate-key.js");
const { createBindingReportRoute, createBindingReportPreflight } = await import("./binding-report.js");
type BindingReport = import("./binding-report.js").BindingReport;

const CMS = "http://cms.test";
const SECRET = "a-press-secret-long-enough-to-pass-the-guard";

const TYPO = { type: "text", props: { value: "{{sight.Name}}" } };
const RENAMED = { type: "text", props: { value: "{{page.Headline}}" } };
const ITEM_OUTSIDE_A_REPEAT = { type: "text", props: { value: "{{item.Title}}" } };
const FINE = { type: "text", props: { value: "{{site.Name}}" } };

const PAGES: Record<string, { id: string; slug: string; data: Record<string, unknown> }> = {
    about: {
        id: "pg1",
        slug: "about",
        data: {
            Title: "About us",
            Slug: "about",
            Blocks: [TYPO, RENAMED, ITEM_OUTSIDE_A_REPEAT, FINE],
        },
    },
    clean: { id: "pg2", slug: "clean", data: { Title: "Clean", Slug: "clean", Blocks: [FINE] } },
};

const config = defineConfig({ sites: {}, cmsUrl: CMS, pageFields: { blocks: "Blocks" } });
const registry = createBlockRegistry(config);

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");

        if (url.pathname === "/api/tenants/by-host/school.example") return Response.json({ handle: "school" });
        if (url.pathname.startsWith("/api/tenants/by-host/")) return new Response("", { status: 404 });
        if (tenant !== "school") return new Response("", { status: 404 });

        if (url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: { Name: "Baryo High", Url: "https://school.example" } }],
                page: 1,
                pageSize: 1,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        const one = url.pathname.match(/^\/api\/public\/page\/(.+)$/);
        if (one && Object.hasOwn(PAGES, one[1])) return Response.json(PAGES[one[1]]);
        return new Response("", { status: 404 });
    });
}

function visit(host = "school.example") {
    requestHeaders = new Headers({ host });
}

const KEY = bindingsKeyFor(SECRET, "school");

function ask(query: string, key: string | null = KEY, extra: Record<string, string> = {}): Request {
    const headers = new Headers(extra);
    if (key) headers.set("authorization", `Bearer ${key}`);
    return new Request(`https://school.example/api/blocks/bindings${query}`, { headers });
}

const report = createBindingReportRoute(config, registry, { secret: SECRET, consoleOrigins: ["https://brew.example"] });

beforeEach(() => {
    forgetCachedReads();
    visit();
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    requestHeaders = null;
});

describe("the binding report", () => {
    it("names every reason, and the block and field each one came from", async () => {
        const res = await report(ask("?slug=about"));
        expect(res.status).toBe(200);
        const body = (await res.json()) as BindingReport;

        expect(body.page).toMatchObject({ slug: "about", title: "About us" });
        expect(body.problems).toHaveLength(3);
        expect(body.truncated).toBe(false);
        expect(body.problems).toEqual([
            { binding: "{{sight.Name}}", reason: "unknown scope", block: "text", field: "value" },
            { binding: "{{page.Headline}}", reason: "no value", block: "text", field: "value" },
            { binding: "{{item.Title}}", reason: "unbound scope", block: "text", field: "value" },
        ]);
    });

    it("reports nothing for a page whose bindings all resolve", async () => {
        const res = await report(ask("?slug=clean"));
        const body = (await res.json()) as BindingReport;

        expect(res.status).toBe(200);
        expect(body.page.slug).toBe("clean");
        expect(body.problems).toEqual([]);
    });

    it("answers no visitor and no caller without the tenant's key", async () => {
        expect((await report(ask("?slug=about", null))).status).toBe(401);
        expect((await report(ask("?slug=about", "not-the-key"))).status).toBe(401);
        // Another tenant's key is another tenant's, which is the whole point of deriving it.
        expect((await report(ask("?slug=about", bindingsKeyFor(SECRET, "bakery")))).status).toBe(401);
    });

    it("is never cached, and never handed to a browser origin the site did not name", async () => {
        const allowed = await report(ask("?slug=about", KEY, { origin: "https://brew.example" }));
        expect(allowed.headers.get("cache-control")).toBe("no-store");
        expect(allowed.headers.get("access-control-allow-origin")).toBe("https://brew.example");

        const other = await report(ask("?slug=about", KEY, { origin: "https://elsewhere.example" }));
        expect(other.status).toBe(200);
        expect(other.headers.get("access-control-allow-origin")).toBeNull();
        expect(other.headers.get("vary")).toContain("Origin");
    });

    it("refuses every report when no secret is configured", async () => {
        const unconfigured = createBindingReportRoute(config, registry, { secret: "" });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await unconfigured(ask("?slug=about"));

        expect(res.status).toBe(503);
    });

    it("answers 404 for a page this tenant does not have, and for a host with no tenant", async () => {
        expect((await report(ask("?slug=missing"))).status).toBe(404);

        visit("nobody.example");
        expect((await report(ask("?slug=about"))).status).toBe(404);
    });

    it("preflights only the origins the site named", () => {
        const preflight = createBindingReportPreflight({ consoleOrigins: ["https://brew.example"] });

        const allowed = preflight(ask("", null, { origin: "https://brew.example" }));
        expect(allowed.status).toBe(204);
        expect(allowed.headers.get("access-control-allow-headers")).toContain("Authorization");

        const other = preflight(ask("", null, { origin: "https://elsewhere.example" }));
        expect(other.headers.get("access-control-allow-methods")).toBeNull();
    });
});
