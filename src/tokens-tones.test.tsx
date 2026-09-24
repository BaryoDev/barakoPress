import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Tokens and tones a tenant names (#125).
 *
 * A theme was a fixed set of slots and six tones, so a design with its own palette kept it as hex
 * literals in code. `Tokens` and `Tones` make that palette settings. The case that has to hold
 * whatever else changes is a tenant that sets neither: it renders exactly as it did.
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
const { DEFAULT_THEME, resolveTheme, themeVariablesCss } = await import("./theme.js");
const { TONES, toneOf } = await import("./blocks/tokens.js");
const { createBlockRegistry, registryFor } = await import("./blocks/registry.js");
const { blockSchema, resolveBlocks } = await import("./blocks/schema.js");
const { bindBlocks } = await import("./blocks/bind.js");
const { BlockList } = await import("./blocks/render.js");

const CMS = "http://cms.test";

const PALETTE = {
    Tokens: {
        accent: "#E4572E",
        "cms-ink": "#1D3A8A",
        "cms-bg": "#E8EEFD",
        gutter: "24px",
        display: "clamp(32px, 4vw, 48px)",
        serif: "'Zilla Slab', Georgia, serif",
    },
    Tones: {
        cms: { ink: "cms-ink", bg: "cms-bg", edge: "#B9C8F5" },
        brew: { ink: "#5B3A1A", bg: "#F6EBDD", edge: "accentTintBorder" },
    },
};

const HEADER_BLOCKS = [
    {
        type: "section",
        props: {
            tone: "cms",
            content: [[{ type: "text", props: { value: "Now on 4.3", variant: "small" } }]],
        },
    },
];

const TENANTS: Record<string, { host: string; settings: Record<string, unknown>; pages?: Record<string, unknown> }> = {
    press: {
        host: "press.example",
        settings: {
            Name: "Press",
            Url: "https://press.example",
            HeaderPath: "/site/header",
            HeaderTone: "brew",
            ...PALETTE,
        },
        pages: {
            "/site/header": { id: "h", slug: "header", data: { Title: "Header", Blocks: HEADER_BLOCKS } },
        },
    },
    plain: {
        host: "plain.example",
        settings: { Name: "Plain", Url: "https://plain.example" },
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
const base = { ...config, tenant: "t" };

async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function layoutHtml(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    return render(await Layout({ children: <p>the page</p> }));
}

/** Blocks resolved, bound and rendered the way a page route does, against this config's registry. */
async function renderBlocks(cfg: typeof config, raw: unknown): Promise<string> {
    const registry = registryFor(cfg, createBlockRegistry(cfg));
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config: cfg, registry, scopes: {} });
    return renderToStaticMarkup(<BlockList blocks={bound} theme={cfg.theme} />);
}

function toneOptions(schema: ReturnType<typeof blockSchema>): string[][] {
    return schema.blocks.flatMap((b) =>
        b.fields
            .filter((f) => f.kind === "select" && TONES.every((t) => f.options?.includes(t)))
            .map((f) => f.options ?? []),
    );
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

describe("Tokens", () => {
    it("reads named colours, lengths and font stacks", () => {
        const theme = applySiteSettings(base, PALETTE, null).theme;
        expect(theme.tokens).toEqual(PALETTE.Tokens);
    });

    it("drops a value or a name that fails its check and keeps the rest", () => {
        const theme = applySiteSettings(
            base,
            {
                Tokens: {
                    accent: "#E4572E",
                    gutter: "24px",
                    injected: "red;}body{display:none",
                    script: "</style><script>",
                    calc: "calc(100% - 2px)",
                    "bad name": "#fff",
                    "--double": "#fff",
                    empty: "",
                    number: 5,
                    nested: { value: "#fff" },
                },
            },
            null,
        ).theme;
        expect(theme.tokens).toEqual({ accent: "#E4572E", gutter: "24px" });
    });

    it("emits each token as a custom property on the root", () => {
        const css = themeVariablesCss(applySiteSettings(base, PALETTE, null).theme);
        expect(css).toContain("--t-accent:#E4572E");
        expect(css).toContain("--t-cms-ink:#1D3A8A");
        expect(css).toContain("--t-gutter:24px");
        expect(css).toContain("--t-display:clamp(32px, 4vw, 48px)");
        expect(css).toContain("--t-serif:'Zilla Slab', Georgia, serif");
        expect(css.startsWith(":root{")).toBe(true);
    });

    it("merges a tenant's tokens over the configured ones, one at a time", () => {
        const configured = defineConfig({
            sites: {},
            cmsUrl: CMS,
            theme: { tokens: { accent: "#111111", rule: "1px" } },
        });
        expect(configured.theme.tokens).toEqual({ accent: "#111111", rule: "1px" });

        const theme = applySiteSettings({ ...configured, tenant: "t" }, { Tokens: { accent: "#222222", rule: "1 px" } }, null).theme;
        expect(theme.tokens).toEqual({ accent: "#222222", rule: "1px" });
    });

    it("holds a build-time token to the same checks", () => {
        const theme = resolveTheme({ tokens: { ok: "#fff", bad: "url(x)" } });
        expect(theme.tokens).toEqual({ ok: "#fff" });
    });
});

describe("Tones", () => {
    it("reads a tone whose colours are tokens, theme slots or colours written out", () => {
        const theme = applySiteSettings(base, PALETTE, null).theme;
        expect(Object.keys(theme.tones ?? {})).toEqual(["cms", "brew"]);

        const cms = toneOf(theme, "cms");
        expect(cms.ink).toBe("#1D3A8A");
        expect(cms.bg).toBe("#E8EEFD");
        expect(cms.hairline).toBe("#B9C8F5");

        const brew = toneOf(theme, "brew");
        expect(brew.bg).toBe("#F6EBDD");
        expect(brew.hairline).toBe(DEFAULT_THEME.colors.accentTintBorder);
    });

    it("drops a tone with a colour that resolves to nothing, or a built-in name, and keeps the rest", () => {
        const theme = applySiteSettings(
            base,
            {
                Tones: {
                    good: { ink: "#000", bg: "#fff", edge: "#ccc" },
                    missing: { ink: "#000", bg: "#fff" },
                    unknown: { ink: "no-such-token", bg: "#fff", edge: "#ccc" },
                    injected: { ink: "red;}", bg: "#fff", edge: "#ccc" },
                    accent: { ink: "#000", bg: "#fff", edge: "#ccc" },
                    "Bad Name": { ink: "#000", bg: "#fff", edge: "#ccc" },
                    flat: "#fff",
                },
            },
            null,
        ).theme;
        expect(Object.keys(theme.tones ?? {})).toEqual(["good"]);
        expect(toneOf(theme, "accent").bg).toBe(DEFAULT_THEME.colors.accentTint);
    });

    it("falls back to the page tone for a name the theme does not have", () => {
        const theme = applySiteSettings(base, PALETTE, null).theme;
        expect(toneOf(theme, "nope")).toEqual(toneOf(theme, "page"));
        expect(toneOf(theme, "constructor")).toEqual(toneOf(theme, "page"));
    });

    it("lets HeaderTone and FooterTone name a tenant tone", () => {
        const regions = applySiteSettings(
            base,
            { ...PALETTE, HeaderPath: "/h", HeaderTone: "CMS", FooterPath: "/f", FooterTone: "nope" },
            null,
        ).regions;
        expect(regions).toEqual({ header: { path: "/h", tone: "cms" }, footer: { path: "/f" } });
    });

    it("renders a block in a tenant tone", async () => {
        const cfg = applySiteSettings(base, PALETTE, null);
        const html = await renderBlocks(cfg, [{ type: "section", props: { tone: "cms", content: [[]] } }]);
        expect(html).toContain("background:#E8EEFD");
        expect(html).toContain("color:#1D3A8A");
    });

    it("renders a shipped preset in a tenant tone", async () => {
        const cfg = applySiteSettings(base, PALETTE, null);
        const html = await renderBlocks(cfg, [
            { type: "band", props: { tone: "cms", heading: "Ship it", label: "Go", href: "/go" } },
        ]);
        expect(html).toContain("Ship it");
        expect(html).toContain("background:#E8EEFD");
    });

    it("still refuses a tone the tenant does not have", async () => {
        const cfg = applySiteSettings(base, PALETTE, null);
        const html = await renderBlocks(cfg, [{ type: "section", props: { tone: "nope", content: [[]] } }]);
        expect(html).not.toContain("<section");
    });

    it("offers the tenant's tones in every tone field of the request's registry", () => {
        const cfg = applySiteSettings(base, PALETTE, null);
        const options = toneOptions(blockSchema(registryFor(cfg, createBlockRegistry(config))));
        expect(options.length).toBeGreaterThan(10);
        for (const list of options) expect(list).toEqual([...TONES, "cms", "brew"]);
    });

    it("offers a build-time site's tones in the schema it serves", () => {
        const built = defineConfig({
            site: { name: "Test", url: "https://test.example" },
            theme: { tones: { cms: { ink: "#1D3A8A", bg: "#E8EEFD", edge: "#B9C8F5" } } },
        });
        const options = toneOptions(blockSchema(createBlockRegistry(built)));
        expect(options.length).toBeGreaterThan(10);
        for (const list of options) expect(list).toEqual([...TONES, "cms"]);
    });

    it("leaves the tone fields as they were for a tenant with no tones", () => {
        const cfg = applySiteSettings(base, {}, null);
        const options = toneOptions(blockSchema(registryFor(cfg, createBlockRegistry(config))));
        expect(options.length).toBeGreaterThan(10);
        for (const list of options) expect(list).toEqual([...TONES]);
    });
});

describe("a site with tokens and tones", () => {
    it("draws the header region and the blocks in it in the tenant's tones, with the tokens on the root", async () => {
        const html = await layoutHtml("press.example");
        expect(html).toContain("--t-accent:#E4572E");
        const header = html.slice(0, html.indexOf("<main>"));
        expect(header).toContain('data-press="header"');
        expect(header).toContain("background:#F6EBDD");
        expect(header).toContain("background:#E8EEFD");
        expect(header).toContain("Now on 4.3");
    });

    it("emits no token property for a tenant that sets none", async () => {
        const html = await layoutHtml("plain.example");
        expect(html).toContain("--background:");
        expect(html).not.toContain("--t-");
        expect(applySiteSettings(base, TENANTS.plain.settings, null).theme).not.toHaveProperty("tokens");
        expect(applySiteSettings(base, TENANTS.plain.settings, null).theme).not.toHaveProperty("tones");
        expect(themeVariablesCss(DEFAULT_THEME)).not.toContain("--t-");
    });
});
