import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The opt-in reveal on scroll (#167): every section band of a page, in CSS, in place of a script an
 * overlay adds to the layout. It keeps the rule every motion block keeps: nothing is parked hidden.
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
    usePathname: () => "/",
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
const { revealOnScrollCss } = await import("./blocks/motion.js");

const CMS = "http://cms.test";

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    rises: { host: "rises.example", settings: { Name: "Rises", Url: "https://rises.example", RevealOnScroll: "Rise" } },
    still: { host: "still.example", settings: { Name: "Still", Url: "https://still.example" } },
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
        if (t && url.pathname === "/api/public/site") {
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
const base = { ...config, tenant: "t" };

async function bodyAt(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    const errors: unknown[] = [];
    const page = await Layout({ children: <p>the page</p> });
    const { prelude } = await prerender(page, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    const html = await new Response(prelude).text();
    const body = html.indexOf("<body");
    return html.slice(html.indexOf(">", body) + 1);
}

/** The stylesheet with every reduced-motion guard taken out, which is what a visitor who turned motion down gets. */
function unguarded(css: string): string {
    const guard = /@media \(prefers-reduced-motion:no-preference\)\{/;
    let out = css;
    for (let found = out.search(guard); found !== -1; found = out.search(guard)) {
        let depth = 0;
        let i = out.indexOf("{", found);
        for (; i < out.length; i++) {
            if (out[i] === "{") depth++;
            else if (out[i] === "}" && --depth === 0) break;
        }
        out = out.slice(0, found) + out.slice(i + 1);
    }
    return out.replace(/@supports[^{]*\{\s*\}/g, "");
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

describe("reading RevealOnScroll", () => {
    it("reads rise and fade in any case, and nothing else", () => {
        const read = (v: unknown) => applySiteSettings(base, { RevealOnScroll: v }, null).site.revealOnScroll;
        expect(read("rise")).toBe("rise");
        expect(read("FADE")).toBe("fade");
        expect(read("spin")).toBeUndefined();
        expect(read(true)).toBeUndefined();
    });

    it("keeps a configured reveal over a value it cannot read, and turns it off on off", () => {
        const configured = { ...base, site: { ...base.site, revealOnScroll: "fade" as const } };
        expect(applySiteSettings(configured, {}, null).site.revealOnScroll).toBe("fade");
        expect(applySiteSettings(configured, { RevealOnScroll: "spin" }, null).site.revealOnScroll).toBe("fade");
        expect(applySiteSettings(configured, { RevealOnScroll: "off" }, null).site.revealOnScroll).toBeUndefined();
    });
});

describe("the reveal on the page", () => {
    it("animates every section band of the main column as it comes into view", async () => {
        const body = await bodyAt("rises.example");
        const css = [...body.matchAll(/<style>([^<]*)<\/style>/g)].map((m) => m[1]).find((s) => s.includes("bp-reveal")) ?? "";
        expect(css.length).toBeGreaterThan(0);
        expect(css).toContain('main [data-block="section"]>*{animation:bp-reveal ');
        expect(css).toContain("animation-timeline:view()");
        expect(css).toContain("@supports (animation-timeline:view())");
    });

    it("fades rather than lifts when the site asks for fade", () => {
        expect(revealOnScrollCss("fade")).toContain('main [data-block="section"]>*{animation:bp-reveal-fade ');
    });

    it("never parks a band hidden", () => {
        for (const style of ["rise", "fade"] as const) {
            const css = revealOnScrollCss(style);
            expect(css).toContain("opacity:0");
            const rest = unguarded(css);
            expect(rest).not.toContain("animation");
            expect(rest).not.toContain("opacity:0");
        }
    });

    it("writes nothing for a site that did not ask for it", async () => {
        const body = await bodyAt("still.example");
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain("bp-reveal");
    });
});
