import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The operator desk, first slice (#7): a page that names an audience is a 404 for anyone outside it,
 * and a dataTable set to read as the viewer lists through the authenticated list with that viewer's
 * own token, and never through the public route.
 */

const ANA_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ana-session-token.signaturepart";
const BEN_TOKEN = "eyJhbGciOiJIUzI1NiJ9.ben-session-token.signaturepart";
const CAL_TOKEN = "eyJhbGciOiJIUzI1NiJ9.cal-session-token.signaturepart";

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
const { createPage, createViewerPage, createPageMetadata } = await import("./screens/page.js");
const { getNavigation } = await import("./cms.js");
const { createSitemap } = await import("./routes/sitemap.js");

const CMS = "https://cms.test";
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
    [CAL_TOKEN]: { username: "cal", roles: ["Guest"] },
};

// What each token may read. The CMS applies the account's read rules; the mock does it by token.
const ROWS: Record<string, string[]> = {
    [ANA_TOKEN]: ["Ana lunch order", "Ana tasting"],
    [BEN_TOKEN]: ["Ben wedding", "Ben gala", "Ben tasting"],
    [CAL_TOKEN]: [],
};

interface Call {
    path: string;
    auth: string | null;
    tenant: string | null;
}
let calls: Call[] = [];
let pages: Record<string, { id: string; slug: string; data: Record<string, unknown> }> = {};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ path: url.pathname + url.search, auth: headers.get("authorization"), tenant: headers.get("x-tenant") });
        const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        if (url.pathname === "/api/me") {
            const who = ACCOUNTS[token];
            return who
                ? Response.json({ userId: `u-${who.username}`, username: who.username, tenant: "t", roles: who.roles.map((name) => ({ id: name, name })), capabilities: [] })
                : new Response("", { status: 401 });
        }
        if (url.pathname === "/api/contents") {
            if (!ACCOUNTS[token] || url.searchParams.get("contentType") !== "catering-request") return new Response("", { status: 401 });
            const rows = ROWS[token];
            return Response.json({
                items: rows.map((name, i) => ({ id: `${token.slice(30, 33)}${i}`, contentType: "catering-request", data: { Name: name } })),
                page: 1,
                pageSize: 20,
                totalItems: rows.length,
                totalPages: rows.length ? 1 : 0,
                hasNextPage: false,
            });
        }
        if (url.pathname === "/api/public/catering-request") {
            return Response.json({
                items: [{ id: "pub", data: { Name: "Public row" } }],
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        if (url.pathname === "/api/public/pages/navigation") {
            return Response.json({
                contract: 2,
                truncated: false,
                items: Object.values(pages).map((e) => ({ id: e.id, title: e.data.Title, slug: e.slug, path: `/${e.slug}`, children: [] })),
            });
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
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();
const args = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

const text = { type: "text", props: { value: "Desk text" } };
const deskTable = (props: Record<string, unknown> = {}) => ({
    type: "dataTable",
    props: { collection: "requests", columns: [{ field: "Title", label: "Request" }], empty: "No requests", readAs: "viewer", ...props },
});

function addPage(slug: string, data: Record<string, unknown>) {
    pages[slug] = { id: `p-${slug}`, slug, data: { Title: "Desk", Slug: slug, ...data } };
}

const contentCalls = () => calls.filter((c) => c.path.startsWith("/api/contents"));
const publicListCalls = () => calls.filter((c) => c.path.startsWith("/api/public/catering-request"));

describe("a page with an audience", () => {
    beforeEach(() => addPage("desk", { Audience: ["Front of house", "Owner"], Blocks: [text] }));

    it("is a 404 with no session", async () => {
        await expect(html(createViewerPage(config)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("is a 404 for a viewer holding none of the roles", async () => {
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        await expect(html(createViewerPage(config)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("is a 404 for a token the CMS does not know", async () => {
        jar[VIEWER_COOKIE] = "eyJhbGciOiJIUzI1NiJ9.stale.signaturepart";
        await expect(html(createViewerPage(config)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("renders for a viewer holding one of the roles", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        expect(await html(createViewerPage(config)(args("desk")))).toContain("Desk text");
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        expect(await html(createViewerPage(config)(args("desk")))).toContain("Desk text");
    });

    it("is a 404 on the shared route even for a viewer with the role", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createPage(config)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("gives its title and summary to nobody through metadata", async () => {
        addPage("desk", { Audience: "Front of house, Owner", Summary: "Hidden summary", Blocks: [text] });
        const meta = await createPageMetadata(config)(args("desk"));
        expect(meta.title).toBe("Not found");
        expect(JSON.stringify(meta)).not.toContain("Hidden summary");
    });

    it("leaves a page with no audience public", async () => {
        addPage("open", { Blocks: [text] });
        expect(await html(createPage(config)(args("open")))).toContain("Desk text");
    });
});

describe("a dataTable that reads as the viewer", () => {
    beforeEach(() => addPage("desk", { Blocks: [deskTable()] }));

    it("sends the viewer's token to the authenticated list and not to delivery", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await html(createViewerPage(config)(args("desk")));
        const reads = contentCalls();
        expect(reads).toHaveLength(1);
        expect(reads[0].path).toContain("contentType=catering-request");
        expect(reads[0].auth).toBe(`Bearer ${ANA_TOKEN}`);
        expect(reads[0].tenant).toBe("t");
        expect(publicListCalls()).toHaveLength(0);
    });

    it("shows two viewers their own rows", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const ana = await html(createViewerPage(config)(args("desk")));
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        const ben = await html(createViewerPage(config)(args("desk")));
        expect(ana).toContain("Ana lunch order");
        expect(ana).not.toContain("Ben wedding");
        expect(ben).toContain("Ben wedding");
        expect(ben).toContain("Ben gala");
        expect(ben).not.toContain("Ana lunch order");
        expect(contentCalls().map((c) => c.auth)).toEqual([`Bearer ${ANA_TOKEN}`, `Bearer ${BEN_TOKEN}`]);
    });

    it("draws the empty state when the viewer may read nothing", async () => {
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        expect(await html(createViewerPage(config)(args("desk")))).toContain("No requests");
    });

    it("draws the empty state with no CMS list call when there is no session", async () => {
        const out = await html(createViewerPage(config)(args("desk")));
        expect(out).toContain("No requests");
        expect(out).not.toContain("Public row");
        expect(contentCalls()).toHaveLength(0);
        expect(publicListCalls()).toHaveLength(0);
    });

    it("draws the empty state and reads nothing on the shared route", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createPage(config)(args("desk")));
        expect(out).toContain("No requests");
        expect(out).not.toContain("Ana lunch order");
        expect(contentCalls()).toHaveLength(0);
        expect(publicListCalls()).toHaveLength(0);
    });

    it("does not fall back to the public read when the CMS refuses the token", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const real = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
            new URL(String(input)).pathname === "/api/contents" ? new Response("", { status: 403 }) : real(input, init)));
        const out = await html(createViewerPage(config)(args("desk")));
        expect(out).not.toContain("Public row");
        expect(publicListCalls()).toHaveLength(0);
    });

    it("never puts the token in the rendered page", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(args("desk")));
        expect(out).toContain("Ana lunch order");
        expect(out).not.toContain(ANA_TOKEN);
        expect(out).not.toContain("ana-session-token");
    });

    it("keeps the public mode reading delivery with no token", async () => {
        addPage("desk", { Blocks: [deskTable({ readAs: "public" })] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(args("desk")));
        expect(out).toContain("Public row");
        expect(contentCalls()).toHaveLength(0);
        expect(publicListCalls().every((c) => c.auth === null)).toBe(true);
    });
});

describe("the site menu", () => {
    const withPages = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pages: "" });
    beforeEach(() => {
        addPage("about", { Blocks: [text] });
        addPage("desk", { Audience: ["Front of house"], Blocks: [text] });
    });

    it("lists no page that names an audience on the shared menu", async () => {
        const slugs = (await getNavigation(withPages)).map((i) => i.slug);
        expect(slugs).toEqual(["about"]);
    });

    it("lists the page for a viewer holding one of its roles, and not for one without", async () => {
        expect((await getNavigation(withPages, { viewerRoles: ["Front of house"] })).map((i) => i.slug)).toEqual(["about", "desk"]);
        expect((await getNavigation(withPages, { viewerRoles: ["Guest"] })).map((i) => i.slug)).toEqual(["about"]);
    });

    it("leaves out a page it cannot read rather than show its title", async () => {
        delete pages.about;
        const nav = await getNavigation(withPages, { viewerRoles: ["Front of house"] });
        expect(nav.map((i) => i.slug)).toEqual(["desk"]);
        const real = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
            new URL(String(input)).pathname === "/api/public/pages/resolve" ? new Response("", { status: 500 }) : real(input, init)));
        forgetCachedReads();
        expect(await getNavigation(withPages)).toEqual([]);
    });
});

describe("a viewer table row link", () => {
    it("uses the row's id when the row has no slug", async () => {
        addPage("desk", { Blocks: [deskTable({ rowLink: "/requests/{slug}" })] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(args("desk")));
        const hrefs = [...out.matchAll(/href="(\/requests\/[^"]*)"/g)].map((m) => m[1]);
        expect(hrefs).toHaveLength(2);
        for (const href of hrefs) expect(href).not.toBe("/requests/");
    });
});

describe("audiencePaths", () => {
    const gated = defineConfig({
        site: { name: "Test", url: "https://test.example" },
        cmsUrl: CMS,
        tenant: "t",
        viewerSessions: true,
        pages: "",
        audiencePaths: { "/Desk/": ["Front of house", "Owner"] },
    });

    // Delivery drops the Audience field, as it does when the pages type does not mark it Public.
    beforeEach(() => {
        addPage("about", { Blocks: [text] });
        addPage("desk", { Blocks: [text] });
    });

    const deskAt = (path: string[]) => ({ params: Promise.resolve({ path }), searchParams: Promise.resolve({}) });

    it("is a 404 with no session", async () => {
        await expect(html(createViewerPage(gated)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("is a 404 for a viewer holding none of its roles", async () => {
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        await expect(html(createViewerPage(gated)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("renders for a viewer holding one of its roles", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        expect(await html(createViewerPage(gated)(deskAt(["desk"])))).toContain("Desk text");
    });

    it("gates the path whatever its case, so a CMS that matches paths loosely cannot open it", async () => {
        // The CMS here serves the page at the upper-case path too. Only the gate can refuse it.
        addPage("DESK", { Blocks: [text] });
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        await expect(html(createViewerPage(gated)(deskAt(["DESK"])))).rejects.toThrow("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        expect(await html(createViewerPage(gated)(deskAt(["DESK"])))).toContain("Desk text");
    });

    it("is a 404 for a viewer of another tenant", async () => {
        const other = defineConfig({ ...{ site: gated.site }, cmsUrl: CMS, tenant: "other", viewerSessions: true, pages: "", audiencePaths: { "/desk": ["Front of house"] } });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createViewerPage(other)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("is a 404 on the shared route and in metadata, and the roles win over the page field", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createPage(gated)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
        expect((await createPageMetadata(gated)(deskAt(["desk"]))).title).toBe("Not found");
        addPage("desk", { Audience: ["Guest"], Blocks: [text] });
        expect(await html(createViewerPage(gated)(deskAt(["desk"])))).toContain("Desk text");
    });

    it("is left out of the shared menu and the sitemap, and kept for a viewer with a role", async () => {
        expect((await getNavigation(gated)).map((i) => i.slug)).toEqual(["about"]);
        expect((await getNavigation(gated, { viewerRoles: ["Owner"] })).map((i) => i.slug)).toEqual(["about", "desk"]);
        expect((await getNavigation(gated, { viewerRoles: ["Guest"] })).map((i) => i.slug)).toEqual(["about"]);
        const urls = (await createSitemap(gated)()).map((e) => e.url);
        expect(urls.some((u) => u.endsWith("/about"))).toBe(true);
        expect(urls.some((u) => u.endsWith("/desk"))).toBe(false);
    });

    it("refuses a bad entry at config load", () => {
        const make = (audiencePaths: unknown) =>
            defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, audiencePaths: audiencePaths as Record<string, string[]> });
        expect(() => make({ "/desk": [] })).toThrow("at least one role");
        expect(() => make({ "/desk": [3] })).toThrow("not a non-empty string");
        expect(() => make({ "/desk": [""] })).toThrow("not a non-empty string");
        expect(() => make({ "/desk": "Owner" })).toThrow("at least one role");
        expect(() => make({ desk: ["Owner"] })).toThrow("must start with /");
        expect(() => make({ "/desk": ["Owner"], "/Desk/": ["Owner"] })).toThrow("repeats");
    });
});
