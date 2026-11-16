import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The operator desk, second slice (#7): a recordPanel shows one entry as the signed-in viewer, and a
 * transitionButton moves it through its workflow with that viewer's token, never a server key.
 */

const ANA_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ana-session-token.signaturepart";
const BEN_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ben-session-token.signaturepart";

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
const { createPage, createViewerPage } = await import("./screens/page.js");
const { createViewerTransitionRoute } = await import("./routes/viewer-transition.js");

const CMS = "https://cms.test";
const SERVER_KEY = "server-renderer-key-must-not-travel";
const ID = "3f2c1b8e-5a4d-4c7e-9b1a-2d6e8f0a1b2c";
const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: CMS,
    tenant: "t",
    viewerSessions: true,
    collections: { requests: { type: "catering-request", fields: { title: "Name" } } },
});

const ACCOUNTS: Record<string, { username: string; roles: string[] }> = {
    [ANA_TOKEN]: { username: "ana", roles: ["Front of house"] },
    [BEN_TOKEN]: { username: "ben", roles: ["Owner"] },
};

// What each token may read of the same entry. The CMS applies the account's field rules.
const FIELDS: Record<string, Record<string, unknown>> = {
    [ANA_TOKEN]: { Name: "Wedding lunch", Guests: 40 },
    [BEN_TOKEN]: { Name: "Wedding lunch", Guests: 40, Budget: "12000", Margin: "30%" },
};

interface Call {
    method: string;
    path: string;
    auth: string | null;
    body: string | null;
}
let calls: Call[] = [];
let state = "Pending";
let putStatus = 200;
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
        if (url.pathname === `/api/contents/${ID}/status` && method === "PUT") {
            if (!ACCOUNTS[token]) return new Response("", { status: 401 });
            if (putStatus === 200) state = JSON.parse(String(init?.body)).transition === "Approve" ? "Approved" : "Declined";
            return new Response("{}", { status: putStatus });
        }
        if (url.pathname === `/api/contents/${ID}`) {
            if (!ACCOUNTS[token]) return new Response("", { status: 401 });
            return Response.json({ id: ID, contentType: "catering-request", data: FIELDS[token], status: 0, lifecycleState: state });
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
        const page = url.pathname.match(/^\/api\/public\/page\/(.+)$/);
        if (page && pages[page[1]]) return Response.json(pages[page[1]]);
        return new Response("", { status: 404 });
    });
}

beforeEach(() => {
    forgetCachedReads();
    jar = {};
    calls = [];
    pages = {};
    state = "Pending";
    putStatus = 200;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();
const at = (slug: string, query: Record<string, string> = {}) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(query) });
const entryCalls = () => calls.filter((c) => c.path.startsWith("/api/contents"));

const panel = (props: Record<string, unknown> = {}) => ({
    type: "recordPanel",
    props: { collection: "requests", empty: "Pick a request", ...props },
});
const approve = { type: "transitionButton", props: { collection: "requests", label: "Approve", transition: "Approve", next: "/desk" } };

function addPage(slug: string, blocks: unknown[]) {
    pages[slug] = { id: `p-${slug}`, slug, data: { Title: "Desk", Slug: slug, Blocks: blocks } };
}

const post = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
    new Request("http://desk.example/api/viewer/transition", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "desk.example", ...headers },
        body: new URLSearchParams(fields).toString(),
    });
const form = (extra: Record<string, string> = {}) => ({ record: ID, transition: "Approve", collection: "requests", next: "/desk", ...extra });
const route = createViewerTransitionRoute(config);

describe("a record panel", () => {
    it("shows two viewers of different roles their own fields", async () => {
        addPage("desk", [panel({ fields: [{ field: "Name", label: "Event" }, { field: "Budget", label: "Budget" }] })]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const ana = await html(createViewerPage(config)(at("desk", { record: ID })));
        expect(ana).toContain("Wedding lunch");
        expect(ana).not.toContain("12000");
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        forgetCachedReads();
        const ben = await html(createViewerPage(config)(at("desk", { record: ID })));
        expect(ben).toContain("12000");
        expect(entryCalls().map((c) => c.auth)).toEqual([`Bearer ${ANA_TOKEN}`, `Bearer ${BEN_TOKEN}`]);
    });

    it("reads nothing with no viewer", async () => {
        addPage("desk", [panel()]);
        const out = await html(createViewerPage(config)(at("desk", { record: ID })));
        expect(out).toContain("Pick a request");
        expect(entryCalls()).toHaveLength(0);
    });

    it("reads nothing for a bad id shape", async () => {
        addPage("desk", [panel()]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        for (const bad of ["../x", "12", `${ID}/status`, "a b"]) {
            const out = await html(createViewerPage(config)(at("desk", { record: bad })));
            expect(out).toContain("Pick a request");
        }
        expect(entryCalls()).toHaveLength(0);
    });

    it("draws empty and reads nothing on the shared route", async () => {
        addPage("desk", [panel()]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createPage(config)(at("desk", { record: ID })));
        expect(out).not.toContain("Wedding lunch");
        expect(entryCalls()).toHaveLength(0);
    });

    it("shows the entry's status", async () => {
        addPage("desk", [panel()]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(at("desk", { record: ID })));
        expect(out).toContain("Pending");
    });

    it("draws nothing for an unknown result key", async () => {
        addPage("desk", [panel()]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(at("desk", { record: ID, result: "<b>hacked</b>" })));
        expect(out).not.toContain("hacked");
        expect(out).not.toContain("The decision was recorded.");
    });

    it("never puts the token in the page", async () => {
        addPage("desk", [panel(), approve]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(at("desk", { record: ID })));
        expect(out).toContain("/api/viewer/transition");
        expect(out).not.toContain(ANA_TOKEN);
        expect(out).not.toContain(SERVER_KEY);
    });
});

describe("the transition route", () => {
    it("refuses a cross-origin POST", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const res = await route(post(form(), { origin: "https://evil.example" }));
        expect(res.status).toBe(403);
        expect(entryCalls()).toHaveLength(0);
    });

    it("refuses Decline without a reason", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const res = await route(post(form({ transition: "Decline", reasonRequired: "1", reasonField: "reason", reason: "  " })));
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toContain("result=reason");
        expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    });

    it("sends the viewer's token, not a server key, to the core transition endpoint", async () => {
        vi.stubEnv("BARAKO_RENDERER_KEY", SERVER_KEY);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const res = await route(post(form({ transition: "Decline", reasonRequired: "1", reasonField: "reason", reason: "Too many guests" })));
        const put = calls.find((c) => c.method === "PUT");
        expect(put?.path).toBe(`/api/contents/${ID}/status`);
        expect(put?.auth).toBe(`Bearer ${ANA_TOKEN}`);
        expect(JSON.parse(put?.body ?? "{}")).toEqual({ transition: "Decline", data: { reason: "Too many guests" } });
        expect(res.headers.get("location")).toBe(`/desk?record=${ID}&result=done`);
        expect(String(res.headers.get("location"))).not.toContain(ANA_TOKEN);
    });

    it("answers forbidden when there is no viewer, with no CMS call", async () => {
        const res = await route(post(form()));
        expect(res.headers.get("location")).toContain("result=forbidden");
        expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    });

    it("maps a refusal from the core to a fixed key", async () => {
        putStatus = 403;
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const res = await route(post(form()));
        expect(res.headers.get("location")).toContain("result=forbidden");
    });

    it("is a 404 unless sessions are on", async () => {
        const off = createViewerTransitionRoute(defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t" }));
        expect((await off(post(form()))).status).toBe(404);
    });
});

describe("after a decision", () => {
    it("shows the new status and the result message", async () => {
        addPage("desk", [panel(), approve]);
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const res = await route(post(form()));
        const loc = new URL(String(res.headers.get("location")), "http://desk.example");
        const out = await html(createViewerPage(config)(at("desk", Object.fromEntries(loc.searchParams))));
        expect(out).toContain("Approved");
        expect(out).toContain("The decision was recorded.");
    });
});
