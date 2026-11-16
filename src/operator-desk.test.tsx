import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The operator desk (#7), end to end: the /staff/catering recipe in docs/pages.md, rendered on a
 * viewer route with the CMS mocked. Each test is one line of the issue's done-when list.
 */

const ANA_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ana-session-token.signaturepart";
const BEN_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ben-session-token.signaturepart";

// React's `cache` only memoizes inside a server request. This stands in for one request per test.
const memos = vi.hoisted(() => [] as Map<string, unknown>[]);
vi.mock("react", async (original) => {
    const real = await original<typeof import("react")>();
    const cache = <A extends unknown[], R>(fn: (...args: A) => R) => {
        const seen = new Map<string, unknown>();
        memos.push(seen);
        const ids = new Map<unknown, number>();
        const keyOf = (args: A) => args.map((a) => (typeof a === "object" && a !== null ? `o${ids.get(a) ?? ids.set(a, ids.size).get(a)}` : `p${String(a)}`)).join("|");
        return (...args: A): R => {
            const key = keyOf(args);
            if (!seen.has(key)) seen.set(key, fn(...args));
            return seen.get(key) as R;
        };
    };
    return { ...real, cache, default: { ...real, cache } };
});

let jar: Record<string, string> = {};
vi.mock("next/headers", () => ({
    headers: async () => new Headers({ host: "desk.example" }),
    cookies: async () => ({
        get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined),
        set: () => {},
    }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/og", () => ({ ImageResponse: class { constructor() { return new Response("png"); } } }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { VIEWER_COOKIE } = await import("./viewer.js");
const { createViewerPage } = await import("./screens/page.js");
const { createViewerTransitionRoute } = await import("./routes/viewer-transition.js");
const { bindBlocks } = await import("./blocks/bind.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { resolveBlocks, defineBlock } = await import("./blocks/schema.js");

const CMS = "https://cms.test";
const ANA = "11111111-5a4d-4c7e-9b1a-2d6e8f0a1b2c";
const WED = "22222222-5a4d-4c7e-9b1a-2d6e8f0a1b2c";
const GALA = "33333333-5a4d-4c7e-9b1a-2d6e8f0a1b2c";

const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: CMS,
    tenant: "t",
    viewerSessions: true,
    pages: "",
    collections: { requests: { type: "catering-request", fields: { title: "Name" } } },
    audiencePaths: { "/staff/catering": ["Front of house", "Owner"] },
});

const CAL_TOKEN = "eyJhbGciOiJIUzI1NiJ9.cal-session-token.signaturepart";
const ACCOUNTS: Record<string, { username: string; roles: string[] }> = {
    [ANA_TOKEN]: { username: "ana", roles: ["Front of house"] },
    [BEN_TOKEN]: { username: "ben", roles: ["Owner"] },
    [CAL_TOKEN]: { username: "cal", roles: ["Guest"] },
};

interface Row {
    id: string;
    Name: string;
    Service: string;
    Guests: number;
    Budget?: string;
}
// What each token may read. The CMS applies the account's rules, so the mock does it by token.
const ROWS: Record<string, Row[]> = {
    [ANA_TOKEN]: [{ id: ANA, Name: "Ana lunch order", Service: "Lunch", Guests: 12 }],
    [BEN_TOKEN]: [
        { id: WED, Name: "Ben wedding", Service: "Wedding", Guests: 80, Budget: "12000" },
        { id: GALA, Name: "Ben gala", Service: "Lunch", Guests: 200, Budget: "30000" },
    ],
    [CAL_TOKEN]: [],
};

interface Call {
    method: string;
    path: string;
    auth: string | null;
    body: string | null;
}
let calls: Call[] = [];
let state = "Pending";
let pages: Record<string, { id: string; slug: string; data: Record<string, unknown> }> = {};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname + url.search, auth: headers.get("authorization"), body: typeof init?.body === "string" ? init.body : null });
        const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        if (url.pathname === "/api/me") {
            const who = ACCOUNTS[token];
            return who
                ? Response.json({ userId: `u-${who.username}`, username: who.username, tenant: "t", roles: who.roles.map((name) => ({ id: name, name })), capabilities: [] })
                : new Response("", { status: 401 });
        }
        if (url.pathname === "/api/contents") {
            if (!ACCOUNTS[token] || url.searchParams.get("contentType") !== "catering-request") return new Response("", { status: 401 });
            const search = (url.searchParams.get("search") ?? "").toLowerCase();
            const service = url.searchParams.get("filter[Service][eq]");
            const rows = ROWS[token].filter((r) => r.Name.toLowerCase().includes(search) && (service === null || r.Service === service));
            return Response.json({
                items: rows.map(({ id, ...data }) => ({ id, contentType: "catering-request", data })),
                page: 1,
                pageSize: 20,
                totalItems: rows.length,
                totalPages: rows.length ? 1 : 0,
                hasNextPage: false,
            });
        }
        const one = url.pathname.match(/^\/api\/contents\/([^/]+)(\/status)?$/);
        if (one) {
            if (!ACCOUNTS[token]) return new Response("", { status: 401 });
            if (one[2] && method === "PUT") {
                state = JSON.parse(String(init?.body)).transition === "Approve" ? "Approved" : "Declined";
                return new Response("{}", { status: 200 });
            }
            const row = ROWS[token].find((r) => r.id === one[1]);
            if (!row) return new Response("", { status: 404 });
            const { id, ...data } = row;
            return Response.json({ id, contentType: "catering-request", data, status: 0, lifecycleState: state });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 2, truncated: false, items: [] });
        if (url.pathname === "/api/public/post") return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNextPage: false });
        if (url.pathname === "/api/public/page") {
            const items = Object.values(pages);
            return Response.json({ items, page: 1, pageSize: 100, totalItems: items.length, totalPages: 1, hasNextPage: false });
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const entry = pages[(url.searchParams.get("path") ?? "").replace(/^\//, "")];
            return entry ? Response.json({ contract: 2, path: `/${entry.slug}`, entry, breadcrumbs: [] }) : new Response("", { status: 404 });
        }
        return new Response("", { status: 404 });
    });
}

beforeEach(() => {
    forgetCachedReads();
    jar = {};
    calls = [];
    state = "Pending";
    for (const m of memos) m.clear();
    vi.stubGlobal("fetch", cms());
    // The page of the recipe in docs/pages.md, as the CMS would serve it.
    pages = {
        "staff/catering": {
            id: "p-desk",
            slug: "staff/catering",
            data: {
                Title: "Catering desk",
                Slug: "staff/catering",
                Blocks: [
                    {
                        type: "dataTable",
                        props: {
                            collection: "requests",
                            readAs: "viewer",
                            pageSize: 20,
                            empty: "No requests",
                            search: true,
                            searchLabel: "Search requests",
                            filters: [{ field: "Service", label: "Service", param: "service", values: ["Wedding", "Lunch", "Tasting"] }],
                            rowLink: "?record={id}",
                            columns: [{ field: "Title", label: "Event" }, { field: "Guests", label: "Guests" }],
                        },
                    },
                    {
                        type: "recordPanel",
                        props: {
                            collection: "requests",
                            empty: "Pick a request",
                            fields: [{ field: "Name", label: "Event" }, { field: "Guests", label: "Guests" }, { field: "Budget", label: "Budget" }],
                        },
                    },
                    { type: "transitionButton", props: { collection: "requests", label: "Approve", transition: "Approve", next: "/staff/catering" } },
                    { type: "transitionButton", props: { collection: "requests", label: "Decline", transition: "Decline", requireReason: true, reasonLabel: "Reason", reasonField: "reason", next: "/staff/catering" } },
                    { type: "text", props: { value: "Looking at {{query.q}}" } },
                    { type: "howBuilt", props: {} },
                ],
            },
        },
    };
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();
const desk = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ path: ["staff", "catering"] }), searchParams: Promise.resolve(query) });
const listCalls = () => calls.filter((c) => c.path.startsWith("/api/contents?"));
/** The text inside the howBuilt disclosure, which is the only place its listing is drawn. */
const listing = (out: string) => out.match(/data-press="how-built"[\s\S]*?<\/details>/)?.[0] ?? "";

const post = (fields: Record<string, string>) =>
    new Request("http://desk.example/api/viewer/transition", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "desk.example" },
        body: new URLSearchParams(fields).toString(),
    });
const route = createViewerTransitionRoute(config);

describe("the catering desk recipe", () => {
    it("is a 404 for a viewer with no role of the audience, and for no session", async () => {
        await expect(html(createViewerPage(config)(desk()))).rejects.toThrow("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        await expect(html(createViewerPage(config)(desk()))).rejects.toThrow("NEXT_NOT_FOUND");
        expect(listCalls()).toHaveLength(0);
    });

    it("shows two viewers of different roles the rows their own tokens may read", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const ana = await html(createViewerPage(config)(desk()));
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        forgetCachedReads();
        const ben = await html(createViewerPage(config)(desk()));
        expect(ana).toContain("Ana lunch order");
        expect(ana).not.toContain("Ben wedding");
        expect(ben).toContain("Ben wedding");
        expect(ben).toContain("Ben gala");
        expect(ben).not.toContain("Ana lunch order");
        expect(listCalls().map((c) => c.auth)).toEqual([`Bearer ${ANA_TOKEN}`, `Bearer ${BEN_TOKEN}`]);
    });

    it("sends a search value to the core as the search parameter, and narrows the rows", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const out = await html(createViewerPage(config)(desk({ q: "wedding" })));
        const read = new URL(listCalls()[0].path, CMS);
        expect(read.searchParams.get("search")).toBe("wedding");
        expect(read.searchParams.get("contentType")).toBe("catering-request");
        expect(out).toContain("Ben wedding");
        expect(out).not.toContain("Ben gala");
    });

    it("sends a filter as filter[field][eq], and starts a new search at page one", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const out = await html(createViewerPage(config)(desk({ service: "Lunch", page: "3" })));
        const read = new URL(listCalls()[0].path, CMS);
        expect(read.searchParams.get("filter[Service][eq]")).toBe("Lunch");
        // The search form carries the filter and never the page, so submitting it lands on page one.
        const form = out.match(/data-press="table-search"[\s\S]*?<\/form>/)?.[0] ?? "";
        expect(form).toContain('name="service"');
        expect(form).not.toContain('name="page"');
    });

    it("ignores a filter value the page does not list", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        await html(createViewerPage(config)(desk({ service: "x][ne]=1" })));
        expect(listCalls()[0].path).not.toContain("filter");
    });

    it("cuts a long search before it reaches the core", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        await html(createViewerPage(config)(desk({ q: "a".repeat(5000) })));
        expect(new URL(listCalls()[0].path, CMS).searchParams.get("search")?.length).toBe(200);
    });

    it("keeps the search on a row link", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const out = await html(createViewerPage(config)(desk({ q: "ben" })));
        expect(out).toContain(`record=${WED}`);
        expect(out).toMatch(/href="\?[^"]*q=ben[^"]*"/);
    });

    it("refuses a Decline with no reason, with no call to the core", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const res = await route(post({ record: WED, transition: "Decline", collection: "requests", next: "/staff/catering", reasonRequired: "1", reasonField: "reason", reason: " " }));
        expect(res.headers.get("location")).toContain("result=reason");
        expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    });

    it("calls the core with the viewer's token on a transition, and the panel shows the new status", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const res = await route(post({ record: WED, transition: "Decline", collection: "requests", next: "/staff/catering", reasonRequired: "1", reasonField: "reason", reason: "Too many guests" }));
        const put = calls.find((c) => c.method === "PUT");
        expect(put?.path).toBe(`/api/contents/${WED}/status`);
        expect(put?.auth).toBe(`Bearer ${BEN_TOKEN}`);
        expect(JSON.parse(put?.body ?? "{}")).toEqual({ transition: "Decline", data: { reason: "Too many guests" } });
        const back = new URL(String(res.headers.get("location")), "http://desk.example");
        expect(back.pathname).toBe("/staff/catering");
        forgetCachedReads();
        const out = await html(createViewerPage(config)(desk(Object.fromEntries(back.searchParams))));
        expect(out).toContain("Declined");
        expect(out).toContain("The decision was recorded.");
    });

    it("shows the panel only the fields the viewer's account may read", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        expect(await html(createViewerPage(config)(desk({ record: WED })))).toContain("12000");
    });

    it("shows the page's configuration in howBuilt, with no token and no value from the request", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const out = await html(createViewerPage(config)(desk({ q: "SECRET-SEARCH-TEXT", record: WED })));
        const shown = listing(out);
        expect(shown).toContain("&quot;type&quot;: &quot;dataTable&quot;");
        expect(shown).toContain("requests");
        expect(shown).toContain("{{query.q}}");
        expect(shown).not.toContain("SECRET-SEARCH-TEXT");
        expect(shown).not.toContain("Ben wedding");
        expect(shown).not.toContain("12000");
        expect(out).not.toContain(BEN_TOKEN);
        expect(out).not.toContain("&quot;state&quot;");
    });

    it("is closed until opened", async () => {
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const out = await html(createViewerPage(config)(desk()));
        expect(out).toMatch(/<details[^>]*data-press="how-built"/);
        expect(out).not.toMatch(/<details[^>]*\bopen\b/);
    });
});

describe("howBuilt and gates", () => {
    const owners = defineBlock({ type: "ownersNote", label: "Owners", fields: [], gate: { roles: ["Owner"] }, component: () => <p>owners</p> });
    const plain = defineBlock({ type: "plainNote", label: "Plain", fields: [], component: () => <p>plain</p> });
    const list = async (canSee?: (gate: { roles?: readonly string[] }) => Promise<boolean>) => {
        const registry = createBlockRegistry(config, [owners, plain]);
        const blocks = resolveBlocks([{ type: "ownersNote", props: {} }, { type: "plainNote", props: {} }, { type: "howBuilt", props: {} }], registry, { perViewer: true });
        const bound = await bindBlocks(blocks, { config, registry, scopes: {}, canSee });
        return String(bound.find((b) => b.definition.type === "howBuilt")?.props.state ?? "");
    };

    it("leaves out a block whose gate the viewer does not pass", async () => {
        const shown = await list(async (gate) => gate.roles?.includes("Front of house") === true);
        expect(shown).toContain("plainNote");
        expect(shown).not.toContain("ownersNote");
    });

    it("lists a gated block for a viewer who passes it", async () => {
        expect(await list(async () => true)).toContain("ownersNote");
    });

    it("leaves a gated block out when nothing can say who is looking", async () => {
        expect(await list()).not.toContain("ownersNote");
    });
});
