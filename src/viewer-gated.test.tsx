import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Viewer sessions (#7): a gated block's server calls carry a viewer token, the Pages module path
 * carries it too, and the sign-in block puts no token anywhere a browser can read it.
 */

const SESSION = "eyJhbGciOiJIUzI1NiJ9.sessiontoken.signaturepart";
const MINT_CREDENTIAL = "service-credential-manage-public-delivery";
const jwt = (claims: Record<string, unknown>) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const minted = () => jwt({ purpose: "viewer", vtenant: "t", vsub: "u-1" });

type Set = { name: string; value: string; options: Record<string, unknown> };
let jar: Record<string, string> = {};
let sets: Set[] = [];
vi.mock("next/headers", () => ({
    headers: async () => new Headers({ host: "viewer.example" }),
    cookies: async () => ({
        get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined),
        set: (name: string, value: string, options: Record<string, unknown>) => {
            sets.push({ name, value, options });
            if (options.maxAge === 0) delete jar[name];
            else jar[name] = value;
        },
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
const { forgetCachedReads, list, pageAtPath, withViewerToken } = await import("./delivery.js");
const { VIEWER_COOKIE, forgetMintedTokens } = await import("./viewer.js");
const { createViewerLoginRoute } = await import("./routes/viewer-login.js");
const { createPage, createViewerPage } = await import("./screens/page.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { defineBlock } = await import("./blocks/schema.js");

const CMS = "https://cms.test";
const on = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", viewerSessions: true });
const off = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t" });
const ME = { userId: "u-1", username: "ana", tenant: "t", roles: [{ id: "r", name: "Member" }], capabilities: [] };

interface Call {
    path: string;
    viewerToken: string | null;
    cache: string | undefined;
}
let calls: Call[] = [];
let me: Record<string, unknown> = ME;

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ path: url.pathname, viewerToken: headers.get("x-viewer-token"), cache: init?.cache });
        if (url.pathname === "/api/me") {
            return headers.get("authorization") === `Bearer ${SESSION}` ? Response.json(me) : new Response("", { status: 401 });
        }
        if (url.pathname === "/api/viewer-tokens") {
            return Response.json({ token: minted(), expiresAt: new Date(Date.now() + 900_000).toISOString() });
        }
        if (url.pathname === "/api/auth/login") {
            return Response.json({ token: SESSION, expiry: new Date(Date.now() + 3_600_000).toISOString() });
        }
        if (url.pathname === "/api/public/page/home") {
            return Response.json({
                id: "p1",
                slug: "home",
                data: {
                    Title: "Home",
                    Blocks: [
                        { type: "text", props: { value: "Public text" } },
                        { type: "report", props: {} },
                        { type: "openReport", props: {} },
                        { type: "viewerSignIn", props: { title: "Members", error: "invalid" } },
                    ],
                },
            });
        }
        return new Response("", { status: 404 });
    });
}

const widget = (type: string, gate?: { roles?: string[]; fallback?: ReactNode }) =>
    defineBlock({
        type,
        label: type,
        fields: [],
        ...(gate ? { gate } : {}),
        component: async () => {
            await list(on, type).catch(() => {});
            return <p>{type} drawn</p>;
        },
    });
const report = widget("report", { roles: ["Member"], fallback: <p>Members only</p> });
const open = widget("openReport");

beforeEach(() => {
    forgetCachedReads();
    forgetMintedTokens();
    jar = {};
    sets = [];
    calls = [];
    me = ME;
    vi.stubEnv("CMS_VIEWER_MINT_TOKEN", MINT_CREDENTIAL);
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const args = { params: Promise.resolve({ slug: "home" }), searchParams: Promise.resolve({}) };
const html = async (page: Promise<ReactNode> | ReactNode) => (await new Response((await prerender(await page)).prelude).text()).replaceAll("<!-- -->", "");
const viewerPage = () => createViewerPage(on, createBlockRegistry(on, [report, open]));
const read = (type: string) => calls.filter((c) => c.path === `/api/public/${type}`);

describe("a gated block's server calls", () => {
    it("carry the viewer token when a member is signed in", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(viewerPage()(args));
        expect(out).toContain("report drawn");
        expect(read("report")).toHaveLength(1);
        expect(read("report")[0].viewerToken).toBe(minted());
        expect(read("report")[0].cache).toBe("no-store");
    });

    it("do not carry it when the cookie belongs to another tenant", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        me = { ...ME, tenant: "other" };
        const out = await html(viewerPage()(args));
        expect(out).toContain("Members only");
        expect(out).not.toContain("report drawn");
        expect(read("report")).toHaveLength(0);
        expect(calls.some((c) => c.path === "/api/viewer-tokens")).toBe(false);
        expect(calls.every((c) => c.viewerToken === null)).toBe(true);
    });

    it("are not made for a block with no gate, on a page a member is viewing", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(viewerPage()(args));
        expect(out).toContain("openReport drawn");
        expect(read("openReport")).toHaveLength(1);
        expect(read("openReport")[0].viewerToken).toBeNull();
    });

    it("are not made at all without a viewer, and the page shows the fallback and no error", async () => {
        const out = await html(viewerPage()(args));
        expect(out).toContain("Public text");
        expect(out).toContain("Members only");
        expect(read("report")).toHaveLength(0);
        expect(calls.some((c) => c.path === "/api/viewer-tokens")).toBe(false);
    });

    it("draw nothing, not an error, for a viewer without the role and no fallback", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        me = { ...ME, roles: [{ id: "r2", name: "Guest" }] };
        const quiet = widget("report", { roles: ["Member"] });
        const out = await html(createViewerPage(on, createBlockRegistry(on, [quiet]))(args));
        expect(out).toContain("Public text");
        expect(out).not.toContain("report drawn");
        expect(read("report")).toHaveLength(0);
    });

    it("never put the session or the minted token in the page", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(viewerPage()(args));
        for (const secret of [SESSION, MINT_CREDENTIAL, minted(), "vtenant"]) expect(out).not.toContain(secret);
        expect(sets).toHaveLength(0);
    });

    it("are left out of a shared page, which has no viewer", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(createPage(on, createBlockRegistry(on, [report, open]))(args));
        expect(out).not.toContain("report drawn");
        expect(out).not.toContain("Members only");
        expect(read("report")).toHaveLength(0);
    });
});

describe("the Pages module path", () => {
    it("carries the viewer token on the path lookup inside a viewer scope", async () => {
        await withViewerToken(minted(), async () => {
            await pageAtPath(on, "/members/report");
        });
        const lookup = calls.filter((c) => c.path === "/api/public/pages/resolve");
        expect(lookup).toHaveLength(1);
        expect(lookup[0].viewerToken).toBe(minted());
        expect(lookup[0].cache).toBe("no-store");
    });

    it("carries none outside one", async () => {
        await pageAtPath(on, "/members/report");
        const lookup = calls.filter((c) => c.path === "/api/public/pages/resolve");
        expect(lookup).toHaveLength(1);
        expect(lookup[0].viewerToken).toBeNull();
    });
});

describe("the sign-in block", () => {
    it("is a plain form posting to the login route, with no token in it", async () => {
        const out = await html(viewerPage()(args));
        expect(out).toMatch(/<form [^>]*action="\/api\/viewer\/login" method="post"/);
        expect(out).toContain('name="username"');
        expect(out).toContain('type="password"');
        expect(out).toContain("That username or password is not right.");
        expect(out).not.toContain("<script");
        for (const secret of [SESSION, MINT_CREDENTIAL, minted()]) expect(out).not.toContain(secret);
    });

    it("draws nothing for a signed-in viewer", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(viewerPage()(args));
        expect(out).not.toContain("viewer-sign-in");
        expect(out).not.toContain(SESSION);
    });

    it("draws nothing when sessions are off", async () => {
        const out = await html(createViewerPage(off, createBlockRegistry(off, [report, open]))(args));
        expect(out).not.toContain("viewer-sign-in");
    });

    it("is left out of a shared page", async () => {
        expect(await html(createPage(on, createBlockRegistry(on, [report, open]))(args))).not.toContain("viewer-sign-in");
    });
});

describe("posting the sign-in form", () => {
    const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
        new Request("http://viewer.example/api/viewer/login", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", host: "viewer.example", ...headers },
            body: new URLSearchParams(fields),
        });

    it("sets the http-only cookie and redirects, with the token in neither", async () => {
        const res = await createViewerLoginRoute(on)(form({ username: "ana", password: "pw", next: "/members" }));
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/members");
        expect(sets).toHaveLength(1);
        expect(sets[0].options.httpOnly).toBe(true);
        expect(await res.text()).not.toContain(SESSION);
        expect([...res.headers.values()].join("\n")).not.toContain(SESSION);
    });

    it("will not redirect off the site", async () => {
        for (const next of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
            const res = await createViewerLoginRoute(on)(form({ username: "ana", password: "pw", next }));
            expect(res.headers.get("location")).toBe("/");
        }
    });

    it("comes back to the page with the reason when the password is wrong", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("", { status: 401 })),
        );
        const res = await createViewerLoginRoute(on)(form({ username: "ana", password: "bad", next: "/login?x=1" }));
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/login?x=1&signin=invalid");
        expect(sets).toHaveLength(0);
    });

    it("refuses a cross-site post", async () => {
        const res = await createViewerLoginRoute(on)(form({ username: "ana", password: "pw" }, { "sec-fetch-site": "cross-site" }));
        expect(res.status).toBe(403);
        expect(sets).toHaveLength(0);
    });
});
