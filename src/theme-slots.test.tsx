import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Colour slots named by role, and block sizes taken from the type scale (#49).
 *
 * The old names are what a tenant's `Colors` entry was saved with, so both tests here matter: a
 * bakery that put its cream in `darkPanel` in 0.3.0 keeps its footer, and a school that writes
 * `inverse` today gets the same band.
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
const { applySiteSettings } = await import("./site.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { DEFAULT_THEME, mergeColors, proseCss, resolveTheme } = await import("./theme.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { resolveBlocks } = await import("./blocks/schema.js");
const { BlockList } = await import("./blocks/render.js");
const { PageView } = await import("./screens/page.js");

const CMS = "http://cms.test";

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    // Saved before the slots were renamed, which is every tenant on 0.3.0.
    bakery: {
        host: "bakery.example",
        settings: {
            Name: "Corner Bakery",
            Url: "https://bakery.example",
            Colors: { darkPanel: "#F4E3C1", darkPanelInk: "#3B2A17", darkPanelAccent: "#8A5A20" },
            FooterColumns: [{ heading: "Visit", links: [{ label: "Directions", href: "/directions" }] }],
        },
    },
    // Saved with the role names.
    school: {
        host: "school.example",
        settings: {
            Name: "Baryo High",
            Url: "https://school.example",
            Colors: { inverse: "#0B3D2E", inverseInk: "#E9F5EF", inverseAccent: "#9AD8BE" },
            FooterColumns: [{ heading: "Office", links: [{ label: "Enrol", href: "/enrol" }] }],
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

async function footerHtml(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    const html = await render(await Layout({ children: <p>the page</p> }));
    return html.slice(html.indexOf("</main>") + "</main>".length, html.indexOf("</body>"));
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

describe("colour slots named by role", () => {
    it("gives a tenant its footer band whether it named the old slot or the role", async () => {
        const bakery = await footerHtml("bakery.example");
        expect(bakery).toContain("background:#F4E3C1");
        expect(bakery).toContain("color:#3B2A17");
        expect(bakery).toContain("color:#8A5A20");

        const school = await footerHtml("school.example");
        expect(school).toContain("background:#0B3D2E");
        expect(school).toContain("color:#E9F5EF");
        expect(school).toContain("color:#9AD8BE");
    });

    it("keeps each old slot and its role holding the same colour", () => {
        const base = { ...config, tenant: "t" };
        const old = applySiteSettings(base, TENANTS.bakery.settings, null).theme.colors;
        expect(old.inverse).toBe("#F4E3C1");
        expect(old.darkPanel).toBe("#F4E3C1");
        expect(old.inverseInk).toBe("#3B2A17");
        expect(old.darkPanelInk).toBe("#3B2A17");

        const role = applySiteSettings(base, TENANTS.school.settings, null).theme.colors;
        expect(role.darkPanel).toBe("#0B3D2E");
        expect(role.inverse).toBe("#0B3D2E");

        const configured = resolveTheme({ colors: { codeGreen: "#123456", accentTintBorderStrong: "#654321" } }).colors;
        expect(configured.code).toBe("#123456");
        expect(configured.accentBorderStrong).toBe("#654321");
        expect(resolveTheme({ colors: { code: "#00FF00" } }).colors.codeGreen).toBe("#00FF00");

        // Both named, so the role is the one that stands: it is the name that survives to 1.0.0.
        const both = mergeColors(DEFAULT_THEME.colors, { darkPanel: "#111111", inverse: "#222222" });
        expect(both.inverse).toBe("#222222");
        expect(both.darkPanel).toBe("#222222");
    });

    it("takes the prose code panel from the tenant's inverse band", () => {
        const theme = applySiteSettings({ ...config, tenant: "t" }, TENANTS.school.settings, null).theme;
        const css = proseCss(theme, "prose");
        // The code panel, which is the one rule in the prose stylesheet that reverses the page.
        expect(css).toContain("background:#0B3D2E;color:#E9F5EF");
    });

    it("refuses a Colors value that is not a colour, whichever name it was saved under", () => {
        const out = applySiteSettings(
            { ...config, tenant: "t" },
            { Colors: { inverse: "red;}</style>", darkPanelInk: "#ABCDEF" } },
            null,
        ).theme.colors;
        expect(out.inverse).toBe(DEFAULT_THEME.colors.inverse);
        expect(out.darkPanel).toBe(DEFAULT_THEME.colors.darkPanel);
        expect(out.inverseInk).toBe("#ABCDEF");
    });
});

describe("block sizes from the type scale", () => {
    const scaled = {
        ...DEFAULT_THEME,
        text: { ...DEFAULT_THEME.text, title: "44px", meta: "9px" },
        space: { ...DEFAULT_THEME.space, lg: "60px", md: "30px" },
    };
    const registry = createBlockRegistry(config);
    const html = (raw: unknown) => renderToStaticMarkup(<BlockList blocks={resolveBlocks(raw, registry, { perViewer: false })} theme={scaled} />);

    it("sizes a block heading from the theme, not from a pixel value in the block", () => {
        const cta = html([{ type: "callToAction", props: { heading: "Enrol now", label: "Enrol", href: "/enrol" } }]);
        expect(cta).toContain("Enrol now");
        expect(cta).toContain("font-size:44px");
        expect(cta).not.toContain("26px");
    });

    it("takes a block's padding and gaps from the spacing scale", () => {
        const cta = html([{ type: "callToAction", props: { heading: "Enrol now", label: "Enrol", href: "/enrol" } }]);
        expect(cta).toContain("padding:60px");
        expect(cta).toContain("margin-top:30px");

        const columns = html([
            {
                type: "columns",
                props: {
                    columns: [
                        [{ type: "richText", props: { markdown: "left" } }],
                        [{ type: "richText", props: { markdown: "right" } }],
                    ],
                },
            },
        ]);
        expect(columns).toContain("left");
        expect(columns).toContain("gap:60px");
        expect(columns).not.toContain("gap:32px");
    });

    it("sizes a page title from the scale", async () => {
        const themed = { ...config, theme: { ...scaled, text: { ...scaled.text, pageTitle: "70px" } } };
        const page = { id: "p", slug: "about", title: "About us", body: "" };
        const rendered = await render(await PageView({ config: themed, page, registry }));
        expect(rendered).toContain("About us");
        expect(rendered).toContain("font-size:70px");
        expect(rendered).not.toContain("4.4vw");
    });
});
