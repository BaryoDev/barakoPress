import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Viewer tokens (#7): a gated page mints a token on the server and reads Members content with it,
 * and that read never lands anywhere an anonymous visitor could be served from.
 */

const SESSION = "eyJhbGciOiJIUzI1NiJ9.sessiontoken.signaturepart";
const MINT_CREDENTIAL = "service-credential-manage-public-delivery";
const jwt = (claims: Record<string, unknown>) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

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
const { forgetCachedReads, list } = await import("./delivery.js");
const { VIEWER_COOKIE, forgetMintedTokens } = await import("./viewer.js");
const { createViewerLoginRoute } = await import("./routes/viewer-login.js");
const { createPage, createViewerPage } = await import("./screens/page.js");

const CMS = "https://cms.test";
const on = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS, tenant: "t", viewerSessions: true });
const ME = { userId: "u-1", username: "ana", tenant: "t", roles: [{ id: "r", name: "Member" }], capabilities: [] };

interface Call {
    path: string;
    method: string;
    auth: string | null;
    tenant: string | null;
    viewerToken: string | null;
    cache: string | undefined;
    next: unknown;
    body: string | null;
}
let calls: Call[] = [];
let mintAnswer: () => Response;

const minted = () => jwt({ purpose: "viewer", vtenant: "t", vsub: "u-1" });

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: unknown }) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({
            path: url.pathname,
            method: init?.method ?? "GET",
            auth: headers.get("authorization"),
            tenant: headers.get("x-tenant"),
            viewerToken: headers.get("x-viewer-token"),
            cache: init?.cache,
            next: init?.next,
            body: typeof init?.body === "string" ? init.body : null,
        });
        if (url.pathname === "/api/me") {
            return headers.get("authorization") === `Bearer ${SESSION}` ? Response.json(ME) : new Response("", { status: 401 });
        }
        if (url.pathname === "/api/viewer-tokens") {
            return headers.get("authorization") === `Bearer ${MINT_CREDENTIAL}` ? mintAnswer() : new Response("", { status: 403 });
        }
        if (url.pathname === "/api/public/page/secret") {
            // A Members entry: a 404 to an anonymous caller, the entry to a viewer token.
            if (!headers.get("x-viewer-token")) return new Response("", { status: 404 });
            return new Response(
                JSON.stringify({ id: "p9", slug: "secret", data: { Title: "Secret", Blocks: [{ type: "text", props: { value: "Members only text" } }] } }),
                { headers: { "cache-control": "private, no-store" } },
            );
        }
        return new Response("", { status: 404 });
    });
}

beforeEach(() => {
    forgetCachedReads();
    forgetMintedTokens();
    jar = {};
    sets = [];
    calls = [];
    mintAnswer = () => Response.json({ token: minted(), expiresAt: new Date(Date.now() + 900_000).toISOString(), header: "X-Viewer-Token" });
    vi.stubEnv("CMS_VIEWER_MINT_TOKEN", MINT_CREDENTIAL);
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const args = { params: Promise.resolve({ slug: "secret" }), searchParams: Promise.resolve({}) };
const html = async (page: Promise<ReactNode> | ReactNode) => new Response((await prerender(await page)).prelude).text();
const gated = { gate: { roles: ["Member"] } };
const deliveryCalls = () => calls.filter((c) => c.path.startsWith("/api/public/"));

describe("minting a viewer token", () => {
    it("asks the CMS for a token for the signed-in viewer with the server credential", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        await html(createViewerPage(on, undefined, gated)(args));
        const mint = calls.filter((c) => c.path === "/api/viewer-tokens");
        expect(mint).toHaveLength(1);
        expect(mint[0].method).toBe("POST");
        expect(mint[0].auth).toBe(`Bearer ${MINT_CREDENTIAL}`);
        expect(mint[0].tenant).toBe("t");
        expect(JSON.parse(mint[0].body!)).toMatchObject({ subject: "u-1" });
    });

    it("never lets the credential or the minted token reach the browser", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        const out = await html(createViewerPage(on, undefined, gated)(args));
        expect(out).toContain("Members only text");
        expect(out).not.toContain(MINT_CREDENTIAL);
        expect(out).not.toContain(minted());
        expect(out).not.toContain("vtenant");
        expect(sets).toHaveLength(0);
        const login = await createViewerLoginRoute(on)(
            new Request("http://viewer.example/api/viewer/login", {
                method: "POST",
                headers: { "content-type": "application/json", host: "viewer.example" },
                body: JSON.stringify({ username: "ana", password: "pw" }),
            }),
        );
        const everything = JSON.stringify(sets) + (await login.text()) + [...login.headers.values()].join("\n");
        expect(everything).not.toContain(MINT_CREDENTIAL);
        expect(everything).not.toContain(minted());
    });

    it("mints nothing without the credential, and the read stays anonymous", async () => {
        vi.stubEnv("CMS_VIEWER_MINT_TOKEN", "");
        jar[VIEWER_COOKIE] = SESSION;
        await expect(html(createViewerPage(on, undefined, gated)(args))).rejects.toThrow("NEXT_NOT_FOUND");
        expect(calls.some((c) => c.path === "/api/viewer-tokens")).toBe(false);
        expect(deliveryCalls().every((c) => c.viewerToken === null)).toBe(true);
    });

    it("mints nothing for a route with no gate", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        await html(createViewerPage(on)(args)).catch(() => {});
        expect(calls.some((c) => c.path === "/api/viewer-tokens")).toBe(false);
    });

    it("does not use a token minted for another tenant", async () => {
        mintAnswer = () => Response.json({ token: jwt({ purpose: "viewer", vtenant: "other", vsub: "u-1" }), expiresAt: new Date(Date.now() + 900_000).toISOString() });
        jar[VIEWER_COOKIE] = SESSION;
        await expect(html(createViewerPage(on, undefined, gated)(args))).rejects.toThrow("NEXT_NOT_FOUND");
        expect(deliveryCalls().every((c) => c.viewerToken === null)).toBe(true);
    });

    it("does not use a token from a CMS that refuses the mint", async () => {
        mintAnswer = () => new Response("", { status: 503 });
        jar[VIEWER_COOKIE] = SESSION;
        await expect(html(createViewerPage(on, undefined, gated)(args))).rejects.toThrow("NEXT_NOT_FOUND");
        expect(deliveryCalls().every((c) => c.viewerToken === null)).toBe(true);
    });

    it("keeps the token for the next request instead of minting each time", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        await html(createViewerPage(on, undefined, gated)(args));
        await html(createViewerPage(on, undefined, gated)(args));
        expect(calls.filter((c) => c.path === "/api/viewer-tokens")).toHaveLength(1);
    });
});

describe("a member's read", () => {
    it("carries the viewer token on the entry read, uncached", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        await html(createViewerPage(on, undefined, gated)(args));
        const read = deliveryCalls().filter((c) => c.path === "/api/public/page/secret");
        expect(read).toHaveLength(1);
        expect(read[0].viewerToken).toBe(minted());
        expect(read[0].cache).toBe("no-store");
        expect(read[0].next).toBeUndefined();
    });

    it("is not served to an anonymous visitor afterwards", async () => {
        jar[VIEWER_COOKIE] = SESSION;
        expect(await html(createViewerPage(on, undefined, gated)(args))).toContain("Members only text");
        delete jar[VIEWER_COOKIE];
        calls = [];
        await expect(html(createPage(on)(args))).rejects.toThrow("NEXT_NOT_FOUND");
        const read = deliveryCalls().filter((c) => c.path === "/api/public/page/secret");
        expect(read).toHaveLength(1);
        expect(read[0].viewerToken).toBeNull();
    });

    it("is not answered from the copy an anonymous read left behind", async () => {
        await expect(html(createPage(on)(args))).rejects.toThrow("NEXT_NOT_FOUND");
        jar[VIEWER_COOKIE] = SESSION;
        calls = [];
        expect(await html(createViewerPage(on, undefined, gated)(args))).toContain("Members only text");
        expect(deliveryCalls().some((c) => c.viewerToken === minted())).toBe(true);
    });

    it("is not sent on a delivery route that is not a type read", async () => {
        const { navigationTree } = await import("./delivery.js");
        const { withViewerToken } = await import("./delivery.js");
        await withViewerToken(minted(), async () => {
            await navigationTree(on).catch(() => {});
            await list(on, "page").catch(() => {});
        });
        expect(deliveryCalls().find((c) => c.path === "/api/public/pages/navigation")?.viewerToken).toBeNull();
        expect(deliveryCalls().find((c) => c.path === "/api/public/page")?.viewerToken).toBe(minted());
    });
});
