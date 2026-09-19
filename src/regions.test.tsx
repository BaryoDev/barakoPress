import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The header and the footer as block regions (#48), and the guarantee that came with them: a site
 * configured before regions existed renders after, with the markup it had.
 *
 * The compatibility test here is `renders the built-in chrome exactly as it did`. It is the one
 * that has to stay green whatever else changes, because barakoPress is serving sites whose own CSS
 * keys off that markup.
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
const { createSitemap } = await import("./routes/sitemap.js");

const CMS = "http://cms.test";

const CHROME = {
    TopBar: { text: "Ring 8 to 5", links: [{ label: "Call", href: "/call" }] },
    HeaderLinks: [{ label: "Services", href: "/services" }],
    FooterColumns: [{ heading: "Visit", links: [{ label: "Directions", href: "/directions" }] }],
    SocialLinks: [{ network: "facebook", href: "https://facebook.example/x" }],
    Copyright: "(c) 2026 the surgery",
};

type Tenant = {
    host: string;
    settings: Record<string, unknown>;
    pages?: Record<string, Record<string, unknown>>;
    navigation?: { contract: number; items: unknown[] };
};

const FOOTER_BLOCKS = [
    { type: "text", props: { value: "Open 8am to 5pm, Monday to Friday", variant: "heading" } },
    { type: "text", props: { value: "Written by {{site.Name}}", variant: "small" } },
];

const TENANTS: Record<string, Tenant> = {
    // Nothing new set. This tenant is the compatibility case.
    bakery: {
        host: "bakery.example",
        settings: { Name: "Corner Bakery", Url: "https://bakery.example", Tagline: "Bread since 1962", ...CHROME },
    },
    clinic: {
        host: "clinic.example",
        settings: {
            Name: "Mabini Clinic",
            Url: "https://clinic.example",
            FooterPath: "/site/footer",
            FooterTone: "surface",
            ...CHROME,
        },
        pages: {
            "/site/footer": { id: "f", slug: "footer", data: { Title: "Footer", Blocks: FOOTER_BLOCKS } },
        },
    },
    school: {
        host: "school.example",
        settings: {
            Name: "Baryo High",
            Url: "https://school.example",
            HeaderPath: "/site/header",
            HeaderTone: "inverse",
            ...CHROME,
        },
        pages: {
            "/site/header": {
                id: "h",
                slug: "header",
                data: {
                    Title: "Header",
                    Blocks: [
                        {
                            type: "callToAction",
                            props: { heading: "Enrolment is open", label: "Enrol now", href: "/enrol" },
                        },
                    ],
                },
            },
        },
    },
    // Mounts pages at the root, with the footer page in the menu the CMS returns.
    campus: {
        host: "campus.example",
        settings: { Name: "Campus", Url: "https://campus.example", FooterPath: "/site/footer" },
        navigation: {
            contract: 1,
            items: [
                { id: "a", title: "About", slug: "about", path: "/about", order: 1, children: [] },
                {
                    id: "s",
                    title: "Site",
                    slug: "site",
                    path: "/site",
                    order: 2,
                    children: [{ id: "f", title: "Footer", slug: "footer", path: "/site/footer", order: 1, children: [] }],
                },
            ],
        },
        pages: {
            "/site/footer": { id: "f", slug: "footer", data: { Title: "Footer", Blocks: FOOTER_BLOCKS } },
        },
    },
    // Names a footer page nobody has written yet.
    gap: {
        host: "gap.example",
        settings: { Name: "Gap Co", Url: "https://gap.example", FooterPath: "/site/nothing-here", ...CHROME },
    },
};

let calls: string[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push(url.pathname + url.search);

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
        if (url.pathname === "/api/public/pages/navigation") {
            return t.navigation ? Response.json(t.navigation) : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/post") {
            return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNextPage: false });
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const entry = t.pages?.[path];
            return entry
                ? Response.json({ contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });
/** The same site, mounting the Pages module at the root, so it has a menu and a sitemap. */
const withPages = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

/** A render that waits on async components. A render error is thrown rather than streamed past. */
async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function layoutHtml(host: string, base = config): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(base, { loadFonts: false });
    return render(await Layout({ children: <p>the page</p> }));
}

/** What the document holds between the end of the main element and the end of the body. */
function footerHtml(html: string): string {
    return html.slice(html.indexOf("</main>") + "</main>".length, html.indexOf("</body>"));
}

/** What the document holds before the main element opens. */
function headerHtml(html: string): string {
    const body = html.indexOf("<body");
    return html.slice(html.indexOf(">", body) + 1, html.indexOf("<main>"));
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("reading the region settings", () => {
    const base = { ...config, tenant: "t" };

    it("is unset when neither path is set", () => {
        expect(applySiteSettings(base, {}, null).regions).toBeUndefined();
        expect(applySiteSettings(base, { FooterTone: "surface" }, null).regions).toBeUndefined();
    });

    it("reads a path and its tone, each region on its own", () => {
        expect(applySiteSettings(base, { FooterPath: "/site/footer" }, null).regions).toEqual({
            footer: { path: "/site/footer" },
        });
        expect(
            applySiteSettings(base, { HeaderPath: "/site/header", HeaderTone: "Inverse" }, null).regions,
        ).toEqual({ header: { path: "/site/header", tone: "inverse" } });
        expect(
            applySiteSettings(
                base,
                { HeaderPath: "/a", HeaderTone: "accent", FooterPath: "/b", FooterTone: "page" },
                null,
            ).regions,
        ).toEqual({ header: { path: "/a", tone: "accent" }, footer: { path: "/b", tone: "page" } });
    });

    it("drops a path that is not a plain site path, which leaves the built-in chrome", () => {
        for (const path of ["footer", "//evil.example/x", "https://evil.example/", "/a b", "/a?b=1", "/a\\b", 5]) {
            expect(applySiteSettings(base, { FooterPath: path }, null).regions).toBeUndefined();
        }
    });

    it("drops a tone the theme does not have, and keeps the region", () => {
        for (const tone of ["darkPanel", "", "  ", 5, { name: "surface" }]) {
            expect(applySiteSettings(base, { FooterPath: "/f", FooterTone: tone }, null).regions).toEqual({
                footer: { path: "/f" },
            });
        }
    });

    it("merges the path and the tone one at a time over the configured region", () => {
        const configured = { ...base, regions: { footer: { path: "/built/in", tone: "inverse" as const } } };
        // Only a tone set: the configured path stays and the tenant's tone wins.
        expect(applySiteSettings(configured, { FooterTone: "surface" }, null).regions).toEqual({
            footer: { path: "/built/in", tone: "surface" },
        });
        // Only a path set: the configured tone stays.
        expect(applySiteSettings(configured, { FooterPath: "/tenant/footer" }, null).regions).toEqual({
            footer: { path: "/tenant/footer", tone: "inverse" },
        });
    });

    it("keeps the configured region when the setting is unset or wrong", () => {
        const configured = { ...base, regions: { footer: { path: "/built/in" as string } } };
        expect(applySiteSettings(configured, {}, null).regions).toEqual({ footer: { path: "/built/in" } });
        expect(applySiteSettings(configured, { FooterPath: "not a path" }, null).regions).toEqual({
            footer: { path: "/built/in" },
        });
        expect(applySiteSettings(configured, { FooterPath: "/tenant/footer" }, null).regions).toEqual({
            footer: { path: "/tenant/footer" },
        });
    });
});

describe("a site that set no region", () => {
    /*
     * The compatibility test. These sites are deployed, and a site's own CSS may key off this
     * markup, so this asserts the elements and their inline styles rather than just the words in
     * them. It has to pass against the code before #48 as well as after.
     */
    it("renders the built-in chrome exactly as it did", async () => {
        const html = await layoutHtml("bakery.example");

        expect(headerHtml(html)).toBe(
            '<div style="background:#101223;color:#DED8FB;font-size:13px">' +
                '<div style="max-width:1160px;margin:0 auto;padding:8px 40px;display:flex;flex-wrap:wrap;gap:8px 20px">' +
                "<span>Ring 8 to 5</span>" +
                '<a href="/call" style="color:inherit;text-decoration:none">Call</a>' +
                "</div></div>" +
                '<header style="background:#FFFFFF;border-bottom:1px solid #E7E8F1">' +
                '<nav style="max-width:1160px;margin:0 auto;padding:0 40px;display:flex;flex-wrap:wrap;' +
                'align-items:center;justify-content:space-between;gap:12px 28px;padding-top:18px;padding-bottom:18px">' +
                '<a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:12px;' +
                "font-family:&#x27;Sora&#x27;, ui-sans-serif, system-ui, sans-serif;font-weight:700;font-size:20px\">" +
                "Corner Bakery</a>" +
                '<span style="display:flex;flex-wrap:wrap;gap:8px 22px;font-size:15px">' +
                '<a href="/services" style="color:inherit;text-decoration:none">Services</a>' +
                '<a href="/feed.xml" style="color:#63687D;text-decoration:none;font-family:&#x27;JetBrains Mono&#x27;, ' +
                'ui-monospace, &#x27;SFMono-Regular&#x27;, Menlo, monospace;font-size:13px">RSS</a>' +
                "</span></nav></header>",
        );

        expect(footerHtml(html)).toBe(
            '<footer style="background:#101223;color:#DED8FB;margin-top:48px">' +
                '<div style="max-width:1160px;margin:0 auto;padding:0 40px;padding-top:40px;padding-bottom:40px">' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(180px, 100%), 1fr));' +
                'gap:24px;margin-top:24px"><div>' +
                '<p style="margin:0;font-weight:600;color:#A99BF7">Visit</p>' +
                '<ul style="list-style:none;margin:10px 0 0;padding:0">' +
                '<li style="margin:6px 0"><a href="/directions" style="color:inherit;text-decoration:none">' +
                "Directions</a></li></ul></div></div>" +
                '<p style="display:flex;flex-wrap:wrap;gap:8px 18px;margin:24px 0 0">' +
                '<a href="https://facebook.example/x" rel="noopener noreferrer" ' +
                'style="color:inherit;text-decoration:none;text-transform:capitalize">facebook</a></p>' +
                '<p style="margin:24px 0 0;font-family:&#x27;JetBrains Mono&#x27;, ui-monospace, ' +
                '&#x27;SFMono-Regular&#x27;, Menlo, monospace;font-size:12.5px">(c) 2026 the surgery</p>' +
                "</div></footer>",
        );
    });

    it("asks the CMS for no region page", async () => {
        await layoutHtml("bakery.example");
        expect(calls.some((c) => c.startsWith("/api/public/pages/resolve"))).toBe(false);
    });
});

describe("a footer region", () => {
    it("renders the page at FooterPath as the footer, in place of the built-in one", async () => {
        const html = await layoutHtml("clinic.example");
        const footer = footerHtml(html);

        expect(footer).toContain('data-press="footer"');
        expect(footer).toContain("Open 8am to 5pm, Monday to Friday");
        // The built-in footer's own settings are not rendered as well as the region.
        expect(footer).not.toContain("Visit");
        expect(footer).not.toContain("Directions");
        expect(footer).not.toContain("(c) 2026 the surgery");
    });

    it("leaves the header alone", async () => {
        const header = headerHtml(await layoutHtml("clinic.example"));
        expect(header).toContain("Ring 8 to 5");
        expect(header).toContain("Services");
    });

    it("binds in the region the way a page binds", async () => {
        expect(footerHtml(await layoutHtml("clinic.example"))).toContain("Written by Mabini Clinic");
    });

    it("takes its background from the tone it names, not the dark panel slot", async () => {
        const footer = footerHtml(await layoutHtml("clinic.example"));
        // surface, not darkPanel, which is what the built-in footer is locked to.
        expect(footer).toContain("background:#FFFFFF");
        expect(footer).not.toContain("background:#101223");
    });

    it("falls back to the built-in footer when nothing is served at the path", async () => {
        const footer = footerHtml(await layoutHtml("gap.example"));
        expect(footer).not.toContain('data-press="footer"');
        expect(footer).toContain("Directions");
        expect(footer).toContain("background:#101223");
    });
});

describe("a header region", () => {
    it("renders the page at HeaderPath as the header, in place of the top bar and the header band", async () => {
        const header = headerHtml(await layoutHtml("school.example"));

        expect(header).toContain('data-press="header"');
        expect(header).toContain("Enrolment is open");
        expect(header).toContain('href="/enrol"');
        expect(header).not.toContain("Ring 8 to 5");
        expect(header).not.toContain("Services");
        expect(header).not.toContain("RSS");
    });

    it("leaves the footer alone", async () => {
        const footer = footerHtml(await layoutHtml("school.example"));
        expect(footer).toContain("Directions");
        expect(footer).toContain("(c) 2026 the surgery");
    });
});

describe("a region page is chrome, not a destination", () => {
    it("is left out of the menu, and its parent is not", async () => {
        const header = headerHtml(await layoutHtml("campus.example", withPages));
        expect(header).toContain('href="/about"');
        expect(header).toContain('href="/site"');
        expect(header).not.toContain('href="/site/footer"');
    });

    it("is left out of the sitemap", async () => {
        requestHeaders = new Headers({ host: "campus.example" });
        const urls = (await createSitemap(withPages)()).map((e) => e.url);
        expect(urls).toContain("https://campus.example");
        expect(urls).toContain("https://campus.example/about");
        expect(urls).toContain("https://campus.example/site");
        expect(urls).not.toContain("https://campus.example/site/footer");
    });
});
