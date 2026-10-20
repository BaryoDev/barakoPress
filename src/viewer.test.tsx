import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Viewer sessions (#7): the cookie, the routes, and the `viewer` binding on a viewer page.
 * The cookie jar is whatever the test says, and the CMS is a fetch stub.
 */

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.sessiontoken.signaturepart";

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
const { forgetCachedReads } = await import("./delivery.js");
const { VIEWER_COOKIE, signIn, signOut, getViewer, gateOutcome } = await import("./viewer.js");
const { createViewerLoginRoute } = await import("./routes/viewer-login.js");
const { createViewerLogoutRoute } = await import("./routes/viewer-logout.js");
const { createPage, createViewerPage } = await import("./screens/page.js");

const CMS = "https://cms.test";
const on = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", viewerSessions: true });
const off = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t" });

const ME = {
    userId: "u-1",
    username: "ana",
    tenant: "t",
    roles: [
        { id: "r2", name: "Member" },
        { id: "r1", name: "Auditor" },
    ],
    capabilities: ["content.read"],
    legacyRoleFallback: false,
};

const ME_VIEWER = { id: "u-1", username: "ana", tenant: "t", roles: ["Member"], capabilities: [] as string[] };

let calls: { path: string; auth: string | null; tenant: string | null }[] = [];
let loginAnswer: () => Response;

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({ path: url.pathname, auth: headers.get("authorization"), tenant: headers.get("x-tenant") });
        if (url.pathname === "/api/auth/login") return loginAnswer();
        if (url.pathname === "/api/me") {
            return headers.get("authorization") === `Bearer ${TOKEN}` ? Response.json(ME) : new Response("", { status: 401 });
        }
        if (url.pathname === "/api/public/page/welcome") {
            return Response.json({
                id: "p1",
                slug: "welcome",
                data: {
                    Title: "Welcome",
                    Blocks: [
                        { type: "text", props: { value: "Hello {{viewer.Username ?? Guest}}" } },
                        { type: "text", props: { value: "Roles: {{viewer.Roles ?? none}}" } },
                    ],
                },
            });
        }
        return new Response("", { status: 404 });
    });
}

beforeEach(() => {
    forgetCachedReads();
    jar = {};
    sets = [];
    calls = [];
    loginAnswer = () => Response.json({ token: TOKEN, expiry: new Date(Date.now() + 3_600_000).toISOString(), refreshToken: "refresh" });
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://viewer.example/api/viewer/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "viewer.example", ...headers },
        body: JSON.stringify(body),
    });

describe("signing a viewer in", () => {
    it("keeps the token in an http-only, secure, same-site cookie", async () => {
        const result = await signIn(on, { username: "ana", password: "pw" });
        expect(result).toEqual({ ok: true });
        expect(sets).toHaveLength(1);
        expect(sets[0].name).toBe(VIEWER_COOKIE);
        expect(sets[0].value).toBe(TOKEN);
        expect(sets[0].options.httpOnly).toBe(true);
        expect(sets[0].options.secure).toBe(true);
        expect(sets[0].options.sameSite).toBe("lax");
        expect(sets[0].options.path).toBe("/");
        expect(Number(sets[0].options.maxAge)).toBeGreaterThan(0);
        expect(Number(sets[0].options.maxAge)).toBeLessThanOrEqual(86_400);
    });

    it("sends the tenant to the CMS and sets nothing on a wrong password", async () => {
        loginAnswer = () => new Response("", { status: 401 });
        expect(await signIn(on, { username: "ana", password: "bad" })).toEqual({ ok: false, reason: "invalid" });
        expect(calls).toHaveLength(1);
        expect(calls[0].tenant).toBe("t");
        expect(sets).toHaveLength(0);
    });

    it("sets nothing when the device is not approved yet", async () => {
        loginAnswer = () => Response.json({ token: "", requiresDeviceApproval: true, message: "code sent" });
        expect(await signIn(on, { username: "ana", password: "pw" })).toEqual({ ok: false, reason: "approval" });
        expect(sets).toHaveLength(0);
    });

    it("sets nothing when the CMS is down", async () => {
        loginAnswer = () => new Response("", { status: 503 });
        expect(await signIn(on, { username: "ana", password: "pw" })).toEqual({ ok: false, reason: "unavailable" });
        expect(sets).toHaveLength(0);
    });
});

describe("the login route", () => {
    it("answers without the token in the body or a readable header", async () => {
        const res = await createViewerLoginRoute(on)(post({ username: "ana", password: "pw" }));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain("refresh");
        expect([...res.headers.values()].join("\n")).not.toContain(TOKEN);
        expect(jar[VIEWER_COOKIE]).toBe(TOKEN);
    });

    it("answers 401 for a wrong password and 400 for a body without a password", async () => {
        loginAnswer = () => new Response("", { status: 401 });
        expect((await createViewerLoginRoute(on)(post({ username: "ana", password: "bad" }))).status).toBe(401);
        expect((await createViewerLoginRoute(on)(post({ username: "ana" }))).status).toBe(400);
        expect(sets).toHaveLength(0);
    });

    it("refuses a post that came from another site", async () => {
        const res = await createViewerLoginRoute(on)(post({ username: "ana", password: "pw" }, { "sec-fetch-site": "cross-site" }));
        expect(res.status).toBe(403);
        expect(calls).toHaveLength(0);
        expect(sets).toHaveLength(0);
    });

    it("answers 404 and never calls the CMS when the flag is off", async () => {
        const res = await createViewerLoginRoute(off)(post({ username: "ana", password: "pw" }));
        expect(res.status).toBe(404);
        expect(calls).toHaveLength(0);
        expect(sets).toHaveLength(0);
    });
});

describe("signing out", () => {
    it("clears the cookie", async () => {
        await signIn(on, { username: "ana", password: "pw" });
        expect(jar[VIEWER_COOKIE]).toBe(TOKEN);
        const res = await createViewerLogoutRoute(on)(
            new Request("http://viewer.example/api/viewer/logout", { method: "POST", headers: { host: "viewer.example" } }),
        );
        expect(res.status).toBe(200);
        expect(VIEWER_COOKIE in jar).toBe(false);
        expect(sets[sets.length - 1].options.maxAge).toBe(0);
        expect(await getViewer(on)).toBeNull();
    });

    it("answers 404 and clears nothing when the flag is off", async () => {
        const res = await createViewerLogoutRoute(off)(new Request("http://viewer.example/x", { method: "POST" }));
        expect(res.status).toBe(404);
        expect(sets).toHaveLength(0);
        await signOut();
        expect(sets).toHaveLength(1);
    });
});

describe("a CMS on plain http", () => {
    const plain = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: "http://cms.test", tenant: "t", viewerSessions: true });

    it("is sent no password and no token", async () => {
        calls = [];
        expect(await signIn(plain, { username: "ana", password: "pw" })).toEqual({ ok: false, reason: "unavailable" });
        jar[VIEWER_COOKIE] = TOKEN;
        expect(await getViewer(plain)).toBeNull();
        expect(calls).toHaveLength(0);
    });
});

describe("reading the viewer", () => {
    it("returns who the token belongs to, with role names sorted, and not the token", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const viewer = await getViewer(on);
        expect(viewer).toEqual({ id: "u-1", username: "ana", tenant: "t", roles: ["Auditor", "Member"], capabilities: ["content.read"] });
        expect(JSON.stringify(viewer)).not.toContain(TOKEN);
    });

    it("is null for no cookie, a token the CMS refuses, and a site with the flag off", async () => {
        expect(await getViewer(on)).toBeNull();
        jar[VIEWER_COOKIE] = "stale";
        expect(await getViewer(on)).toBeNull();
        jar[VIEWER_COOKIE] = TOKEN;
        calls = [];
        expect(await getViewer(off)).toBeNull();
        expect(calls).toHaveLength(0);
    });
});

describe("a viewer page", () => {
    const args = { params: Promise.resolve({ slug: "welcome" }), searchParams: Promise.resolve({}) };
    const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();

    it("binds the viewer into a block and never prints the token", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const out = await html(createViewerPage(on)(args));
        expect(out).toContain("Hello ana");
        expect(out).toContain("Roles: Auditor, Member");
        expect(out).not.toContain(TOKEN);
    });

    it("renders the fallback for a signed-out visitor", async () => {
        const out = await html(createViewerPage(on)(args));
        expect(out).toContain("Hello Guest");
        expect(out).toContain("Roles: none");
    });

    it("renders the fallback when the flag is off, even with a cookie", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const out = await html(createViewerPage(off)(args));
        expect(out).toContain("Hello Guest");
        expect(out).not.toContain("Hello ana");
        expect(calls.some((c) => c.path === "/api/me")).toBe(false);
    });

    it("gives the cached page route no viewer values", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const out = await html(createPage(on)(args));
        expect(out).toContain("Hello Guest");
        expect(out).not.toContain("Hello ana");
        expect(calls.some((c) => c.path === "/api/me")).toBe(false);
    });
});

describe("a gated viewer page", () => {
    const args = { params: Promise.resolve({ slug: "welcome" }), searchParams: Promise.resolve({}) };
    const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();
    const refused = async (page: Promise<ReactNode>) => page.then(() => "rendered", (e: Error) => e.message);

    it("shows the page to a viewer who holds one of the roles", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const out = await html(createViewerPage(on, undefined, { gate: { roles: ["Staff", "Auditor"] } })(args));
        expect(out).toContain("Hello ana");
    });

    it("answers not found for a signed-in viewer without the role", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        expect(await refused(createViewerPage(on, undefined, { gate: { roles: ["Staff"] } })(args))).toBe("NEXT_NOT_FOUND");
    });

    it("sends a signed-out visitor to the sign-in path, or answers not found without one", async () => {
        expect(await refused(createViewerPage(on, undefined, { gate: { roles: ["Member"], signIn: "/login" } })(args))).toBe("NEXT_REDIRECT /login");
        expect(await refused(createViewerPage(on, undefined, { gate: { roles: ["Member"] } })(args))).toBe("NEXT_NOT_FOUND");
    });

    it("admits any signed-in viewer for an empty role list, and nobody signed out", async () => {
        const page = createViewerPage(on, undefined, { gate: {} });
        expect(await refused(page(args))).toBe("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = TOKEN;
        expect(await html(page(args))).toContain("Hello ana");
    });

    it("admits nobody when sessions are off", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        expect(await refused(createViewerPage(off, undefined, { gate: { roles: ["Member"] } })(args))).toBe("NEXT_NOT_FOUND");
    });

    it("refuses a viewer whose token belongs to another tenant, or to none", async () => {
        jar[VIEWER_COOKIE] = TOKEN;
        const other = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "other", viewerSessions: true });
        const gate = { gate: { roles: ["Member"] } };
        expect(await refused(createViewerPage(other, undefined, gate)(args))).toBe("NEXT_NOT_FOUND");
        expect(calls.some((c) => c.path === "/api/me")).toBe(true);
        expect(gateOutcome({ ...ME_VIEWER, tenant: "" }, gate.gate, "t")).toBe("deny");
        expect(gateOutcome({ ...ME_VIEWER, tenant: "T" }, gate.gate, "t")).toBe("allow");
    });
});
