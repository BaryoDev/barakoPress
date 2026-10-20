import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A selected theme variant recolours the body, the built-in header and the footer (#218). Those
 * take their colours from inline styles, so with variants named they read the slot variables the
 * variant rules write. A site that names none keeps its literal colours.
 */

let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { DEFAULT_THEME, resolveTheme, slotVariable, themeVariablesCss } = await import("./theme.js");

const CMS = "http://cms.test";

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    plain: {
        host: "plain.example",
        settings: { Name: "Plain", Url: "https://plain.example", FooterColumns: [{ heading: "Visit", links: [{ label: "Map", href: "/map" }] }] },
    },
    night: {
        host: "night.example",
        settings: {
            Name: "Night",
            Url: "https://night.example",
            FooterColumns: [{ heading: "Visit", links: [{ label: "Map", href: "/map" }] }],
            Variants: { dark: { pageBg: "#101010", ink: "#f5f5f5", inverse: "#FF00AA", surface: "#222222" } },
        },
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        if (url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: t.settings }],
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });

async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function pageHtml(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    return render(await Layout({ children: <p>the page</p> }));
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("theme variants reach the inline-styled layout", () => {
    it("draws the body, header and footer from slot variables when variants are named", async () => {
        const html = await pageHtml("night.example");
        const body = html.slice(html.indexOf("<body"), html.indexOf(">", html.indexOf("<body")));

        expect(body).toContain(`background:var(${slotVariable("pageBg")},${DEFAULT_THEME.colors.pageBg})`);
        expect(body).toContain(`color:var(${slotVariable("ink")},${DEFAULT_THEME.colors.ink})`);
        expect(html).toContain(`<footer style="background:var(--bp-c-inverse,${DEFAULT_THEME.colors.inverse})`);
        expect(html).toContain(`background:var(--bp-c-surface,${DEFAULT_THEME.colors.surface})`);
    });

    it("writes inverse and the other slots as variables, so the variant rule overrides them", async () => {
        const html = await pageHtml("night.example");
        const css = themeVariablesCss(resolveTheme({ variants: { dark: { inverse: "#FF00AA", pageBg: "#101010" } } }));

        expect(css).toContain(`:root[data-theme-variant="dark"]{`);
        const rule = css.slice(css.indexOf(':root[data-theme-variant="dark"]'));
        expect(rule).toContain("--bp-c-inverse:#FF00AA");
        expect(rule).toContain("--bp-c-page-bg:#101010");
        expect(rule).toContain(`--bp-c-ink:${DEFAULT_THEME.colors.ink}`);
        expect(html).toContain("--bp-c-inverse:#FF00AA");
        expect(html).toContain("--bp-c-page-bg:#101010");
    });

    it("keeps a site with no variants on its literal colours and writes no slot variable", async () => {
        const html = await pageHtml("plain.example");

        expect(html).toContain(`<footer style="background:${DEFAULT_THEME.colors.inverse}`);
        expect(html).not.toContain("--bp-c-");
        expect(html).not.toContain("var(--bp-c");
    });
});
