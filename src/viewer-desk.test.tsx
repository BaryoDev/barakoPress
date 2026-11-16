import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
let hidden = new Set<string>();
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
const { createPage, createViewerPage, createPageMetadata, createHome, createHomeMetadata, createPageStaticParams } = await import("./screens/page.js");
const { bindBlocks } = await import("./blocks/bind.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { resolveBlocks } = await import("./blocks/schema.js");
const { readTableState } = await import("./blocks/data.js");
const { createShareImage } = await import("./routes/share-image.js");
const { getNavigation } = await import("./cms.js");
const { createSitemap } = await import("./routes/sitemap.js");

const CMS = "https://cms.test";
const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: CMS,
    tenant: "t",
    viewerSessions: true,
    pageFields: { audience: "Audience" },
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
                items: Object.values(pages).filter((e) => !hidden.has(e.slug)).map((e) => ({ id: e.id, title: e.data.Title, slug: e.slug, path: `/${e.slug}`, children: [] })),
            });
        }
        if (url.pathname === "/api/public/post") {
            return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNextPage: false });
        }
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
    hidden = new Set();
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
    const withPages = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pages: "", pageFields: { audience: "Audience" } });
    beforeEach(() => {
        addPage("about", { Blocks: [text] });
        addPage("desk", { Audience: ["Front of house"], Blocks: [text] });
    });

    it("lists no page that names an audience on the shared menu", async () => {
        const slugs = (await getNavigation(withPages)).map((i) => i.slug);
        expect(slugs).toEqual(["about"]);
    });

    it("leaves out a page it cannot read rather than show its title", async () => {
        delete pages.about;
        const nav = await getNavigation(withPages);
        expect(nav.map((i) => i.slug)).toEqual([]);
        const real = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
            new URL(String(input)).pathname === "/api/public/pages/resolve" ? new Response("", { status: 500 }) : real(input, init)));
        forgetCachedReads();
        expect(await getNavigation(withPages)).toEqual([]);
    });
});

describe("a viewer table row link with a mapped slug", () => {
    it("uses the row's id, since the authenticated list returns no slug", async () => {
        const mapped = defineConfig({ ...config, collections: { requests: { type: "catering-request", fields: { title: "Name", slug: "Slug" } } } });
        addPage("desk", { Blocks: [deskTable({ rowLink: "/requests/{slug}" })] });
        const real = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.pathname === "/api/contents") {
                return Response.json({ items: [{ id: "r1", contentType: "catering-request", data: { Name: "Lunch", Slug: "lunch" } }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false });
            }
            return real(input, init);
        }));
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(mapped)(args("desk")));
        expect(out).toContain('href="/requests/r1"');
        expect(out).not.toContain("/requests/lunch");
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
        pageFields: { audience: "Audience" },
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

    it("is a 404 on the shared route and in metadata, and a page field with no role in common closes it", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createPage(gated)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
        expect((await createPageMetadata(gated)(deskAt(["desk"]))).title).toBe("Not found");
        addPage("desk", { Audience: ["Guest"], Blocks: [text] });
        await expect(html(createViewerPage(gated)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("is left out of the shared menu and the sitemap", async () => {
        expect((await getNavigation(gated)).map((i) => i.slug)).toEqual(["about"]);
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

describe("audiencePaths on the slug route", () => {
    const slugged = defineConfig({
        site: { name: "Test", url: "https://test.example" },
        cmsUrl: CMS,
        tenant: "t",
        viewerSessions: true,
        audiencePaths: { "/staff/Desk": ["Front of house"] },
    });
    beforeEach(() => {
        addPage("desk", { Blocks: [text] });
        addPage("about", { Blocks: [text] });
    });

    it("is a 404 with no session, and for a viewer without the role", async () => {
        await expect(html(createViewerPage(slugged)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = CAL_TOKEN;
        await expect(html(createViewerPage(slugged)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        await expect(html(createPage(slugged)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("renders for a viewer with the role, and leaves other slugs public", async () => {
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        expect(await html(createViewerPage(slugged)(args("desk")))).toContain("Desk text");
        expect(await html(createPage(slugged)(args("about")))).toContain("Desk text");
    });

    it("leaves the slug out of the static params", async () => {
        expect(await createPageStaticParams(slugged)()).toEqual([{ slug: "about" }]);
    });

    it("narrows the page's own roles and never replaces them", async () => {
        const both = defineConfig({ ...slugged, pageFields: { audience: "Audience" } });
        addPage("desk", { Audience: ["Owner"], Blocks: [text] });
        // The slug grants Front of house, the page grants Owner: no role in common, so nobody.
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createViewerPage(both)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        await expect(html(createViewerPage(both)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        addPage("desk", { Audience: ["Owner", "Front of house"], Blocks: [text] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        expect(await html(createViewerPage(both)(args("desk")))).toContain("Desk text");
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        await expect(html(createViewerPage(both)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
    });
});

describe("audiencePaths with a page audience", () => {
    const deskAt = (path: string[]) => ({ params: Promise.resolve({ path }), searchParams: Promise.resolve({}) });
    const byPath = defineConfig({
        site: { name: "Test", url: "https://test.example" },
        cmsUrl: CMS,
        tenant: "t",
        viewerSessions: true,
        pages: "",
        pageFields: { audience: "Audience" },
        audiencePaths: { "/desk": ["Front of house"] },
    });
    const bySlug = defineConfig({ ...byPath, pages: undefined });

    it("narrows the page's roles on the path route and never replaces them", async () => {
        addPage("desk", { Audience: ["Owner"], Blocks: [text] });
        // Ana holds only the path role. The page wants Owner, so she is out.
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createViewerPage(byPath)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
        addPage("desk", { Audience: ["Owner", "Front of house"], Blocks: [text] });
        expect(await html(createViewerPage(byPath)(deskAt(["desk"])))).toContain("Desk text");
        // Ben holds a page role but not the path role.
        jar[VIEWER_COOKIE] = BEN_TOKEN;
        await expect(html(createViewerPage(byPath)(deskAt(["desk"])))).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("narrows the page's roles on the slug route and never replaces them", async () => {
        const slugged = defineConfig({ ...bySlug, audiencePaths: { "/staff/desk": ["Front of house"] } });
        addPage("desk", { Audience: ["Owner"], Blocks: [text] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        await expect(html(createViewerPage(slugged)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        addPage("desk", { Audience: ["Owner", "Front of house"], Blocks: [text] });
        expect(await html(createViewerPage(slugged)(args("desk")))).toContain("Desk text");
    });
});

describe("a page with an Audience value on a site not set to read it", () => {
    const unset = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", viewerSessions: true });
    const warnings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]).includes("has an Audience value"));

    it("renders and warns once, and a site that reads the field does not warn", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            addPage("unread-staff", { audience: ["Staff"], Blocks: [text] });
            expect(await html(createPage(unset)(args("unread-staff")))).toContain("Desk text");
            forgetCachedReads();
            expect(await html(createPage(unset)(args("unread-staff")))).toContain("Desk text");
            expect(warnings(spy)).toHaveLength(1);
            expect(String(warnings(spy)[0][0])).toContain('"unread-staff"');

            addPage("read-staff", { Audience: ["Staff"], Blocks: [text] });
            await html(createViewerPage(config)(args("read-staff"))).catch(() => {});
            expect(warnings(spy)).toHaveLength(1);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("a menu item whose page read returns null", () => {
    it("is left out with its children", async () => {
        const withPages = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pages: "", pageFields: { audience: "Audience" } });
        addPage("about", { Blocks: [text] });
        const real = globalThis.fetch;
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.pathname === "/api/public/pages/navigation") {
                return Response.json({
                    contract: 2,
                    truncated: false,
                    items: [
                        { id: "g", title: "Ghost", slug: "ghost", path: "/ghost", children: [{ id: "k", title: "Kid", slug: "kid", path: "/ghost/kid", children: [] }] },
                        { id: "p-about", title: "About", slug: "about", path: "/about", children: [] },
                    ],
                });
            }
            if (url.pathname === "/api/public/pages/resolve" && url.searchParams.get("path")?.startsWith("/ghost")) return new Response("", { status: 404 });
            return real(input, init);
        }));
        forgetCachedReads();
        expect((await getNavigation(withPages)).map((i) => i.slug)).toEqual(["about"]);
    });
});

describe("a gated page on the other routes", () => {
    const byField = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pages: "", pageFields: { audience: "Audience" } });
    const byPath = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pages: "", audiencePaths: { "/desk": ["Owner"] } });
    const noArgs = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

    it("gives no share card, for the field and for audiencePaths", async () => {
        const dir = mkdtempSync(join(tmpdir(), "font-"));
        writeFileSync(join(dir, "f.ttf"), Buffer.from([1, 2, 3]));
        process.env.PRESS_SHARE_IMAGE_FONT = join(dir, "f.ttf");
        try {
            addPage("desk", { Audience: ["Owner"], Blocks: [text] });
            addPage("about", { Blocks: [text] });
            const ask = (cfg: typeof byField, path: string) => createShareImage(cfg)(new Request(`https://t.example/share-image?path=${encodeURIComponent(path)}`));
            expect((await ask(byField, "/desk")).status).toBe(404);
            expect((await ask(byPath, "/desk")).status).toBe(404);
            expect((await ask(byField, "/about")).status).toBe(200);
        } finally {
            delete process.env.PRESS_SHARE_IMAGE_FONT;
        }
    });

    it("is not the home page, nor its metadata, when home.path names it", async () => {
        addPage("desk", { Audience: ["Owner"], Blocks: [text] });
        for (const cfg of [defineConfig({ ...byField, home: { path: "/desk" } }), defineConfig({ ...byPath, home: { path: "/desk" } })]) {
            expect(await html(createHome(cfg)(noArgs))).not.toContain("Desk text");
            expect(JSON.stringify(await createHomeMetadata(cfg)(noArgs))).not.toContain("Desk");
        }
    });

    it("is left out of the static params, and out of a sitemap when the menu does not list it", async () => {
        const open = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", pageFields: { audience: "Audience" } });
        addPage("desk", { Audience: ["Owner"], Blocks: [text] });
        addPage("about", { Blocks: [text] });
        expect(await createPageStaticParams(open)()).toEqual([{ slug: "about" }]);

        hidden.add("desk");
        hidden.add("about");
        const urls = (await createSitemap(byField)()).map((e) => e.url);
        expect(urls.some((u) => u.endsWith("/desk"))).toBe(false);
        expect(urls.some((u) => u.endsWith("/about"))).toBe(true);
    });
});

describe("an audience field that is present but unreadable", () => {
    it("closes the page, and says so once", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        for (const bad of [7, { name: "Owner" }, [{ name: "Owner" }], "   ", [" "]]) {
            addPage("desk", { Audience: bad, Blocks: [text] });
            forgetCachedReads();
            await expect(html(createViewerPage(config)(args("desk")))).rejects.toThrow("NEXT_NOT_FOUND");
        }
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('"desk"'))).toHaveLength(1);
    });

    it("leaves null, empty, and an empty list public", async () => {
        for (const ok of [null, "", []]) {
            addPage("desk", { Audience: ok, Blocks: [text] });
            forgetCachedReads();
            expect(await html(createPage(config)(args("desk")))).toContain("Desk text");
        }
    });
});

describe("a viewer-mode table that must not read", () => {
    it("makes no authenticated read for a viewer of another tenant, even on a page with no audience", async () => {
        const other = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "other", viewerSessions: true, collections: { requests: { type: "catering-request", fields: { title: "Name" } } } });
        addPage("desk", { Blocks: [deskTable()] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(other)(args("desk")));
        expect(out).toContain("No requests");
        expect(contentCalls()).toHaveLength(0);
    });

    it("draws no table and reads nothing for a readAs that is neither public nor viewer", async () => {
        // The block schema checks a select against its options, so a page never reaches the binder
        // with a typo: the block is dropped, with no rows, no public fallback and no read.
        addPage("desk", { Blocks: [deskTable({ readAs: "viewr" })] });
        jar[VIEWER_COOKIE] = ANA_TOKEN;
        const out = await html(createViewerPage(config)(args("desk")));
        expect(out).not.toContain("Public row");
        expect(out).not.toContain("Ana lunch order");
        expect(contentCalls()).toHaveLength(0);
        expect(publicListCalls()).toHaveLength(0);
    });

    it("draws the empty state, reads nothing and says so when the binder is handed such a value", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const registry = createBlockRegistry(config);
        const [block] = resolveBlocks([deskTable()], registry, { perViewer: true });
        const typo = { ...block, props: { ...block.props, readAs: "viewr" } };
        const reader = vi.fn(async () => ({ items: [], total: 0, pageSize: 0, hasNextPage: false }));
        const bound = await bindBlocks([typo], { config, registry, scopes: {}, viewerReader: async () => reader as never });
        const state = readTableState(bound[0].props.state as string);
        expect(state?.rows).toEqual([]);
        expect(reader).not.toHaveBeenCalled();
        expect(publicListCalls()).toHaveLength(0);
        expect(contentCalls()).toHaveLength(0);
        expect(warn.mock.calls.some((c) => String(c[0]).includes("readAs"))).toBe(true);
    });
});
