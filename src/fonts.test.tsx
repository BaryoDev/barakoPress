import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Font stylesheets from an allow list (#54).
 *
 * Two things have to hold at once. A tenant whose settings name a stylesheet on an origin the
 * operator allows gets that link, and a tenant that names anything else gets no link to it: the
 * URL is untrusted input on its way into every visitor's page. The third thing, quieter but the
 * one that breaks sites if it goes wrong, is that a deployment that sets nothing renders the
 * Google Fonts links it rendered before any of this existed.
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
const { allowedFontOrigins, fontLinks, fontStylesheetHref, forgetFontWarnings, GOOGLE_FONTS_ORIGIN } = await import(
    "./fonts.js"
);
const { resolveTheme } = await import("./theme.js");
const { createSiteLayout } = await import("./screens/site-layout.js");

const CMS = "http://cms.test";
const SCHOOL = "https://type.school.example/inter.css";

const config = defineConfig({ sites: {}, cmsUrl: CMS });
const base = { ...config, tenant: "t" };

function cms(settings: Record<string, unknown>) {
    return vi.fn(async (input: string | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === "/api/tenants/by-host/school.example") {
            return Response.json({ handle: "school" });
        }
        if (url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: settings }],
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

/** A render that waits on async components. A render error is thrown rather than streamed past. */
async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function headHtml(settings: Record<string, unknown>): Promise<string> {
    requestHeaders = new Headers({ host: "school.example" });
    vi.stubGlobal("fetch", cms(settings));
    const Layout = createSiteLayout(config);
    const html = await render(await Layout({ children: <p>the page</p> }));
    return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
}

beforeEach(() => {
    forgetCachedReads();
    forgetFontWarnings();
    requestHeaders = null;
    vi.unstubAllEnvs();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("the allow list", () => {
    it("is Google Fonts alone when PRESS_FONT_ORIGINS is unset or blank", () => {
        for (const raw of [undefined, "", "   "]) {
            expect([...allowedFontOrigins(raw)]).toEqual([GOOGLE_FONTS_ORIGIN]);
        }
    });

    it("replaces the default rather than adding to it, so an operator can drop Google Fonts", () => {
        const allowed = allowedFontOrigins("https://type.school.example");
        expect([...allowed]).toEqual(["https://type.school.example"]);
        expect(allowed.has(GOOGLE_FONTS_ORIGIN)).toBe(false);
    });

    it("reads a list separated by commas or spaces, and a bare host as https", () => {
        const allowed = allowedFontOrigins("https://use.typekit.net, type.school.example  https://fonts.googleapis.com");
        expect([...allowed]).toHaveLength(3);
        expect([...allowed]).toEqual([
            "https://use.typekit.net",
            "https://type.school.example",
            GOOGLE_FONTS_ORIGIN,
        ]);
    });

    it("drops an entry that is not an https origin, and keeps the ones that are", () => {
        const allowed = allowedFontOrigins("http://type.school.example javascript:alert(1) /fonts type.school.example");
        expect([...allowed]).toEqual(["https://type.school.example"]);
    });

    it("allows nothing when every entry was junk, rather than falling back to Google Fonts", () => {
        expect([...allowedFontOrigins("http://type.school.example")]).toEqual([]);
    });

    it("keeps the port, so two origins on one host are two entries", () => {
        const allowed = allowedFontOrigins("https://type.school.example:8443, https://type.school.example");
        expect([...allowed]).toEqual(["https://type.school.example:8443", "https://type.school.example"]);
    });
});

describe("reading a stylesheet URL", () => {
    it("keeps an absolute https URL", () => {
        expect(fontStylesheetHref(SCHOOL)).toBe(SCHOOL);
        expect(fontStylesheetHref(`  ${SCHOOL}  `)).toBe(SCHOOL);
    });

    it("drops anything that is not one", () => {
        for (const value of [
            "http://type.school.example/i.css",
            "//type.school.example/i.css",
            "/fonts/inter.css",
            "javascript:alert(1)",
            "data:text/css,body{}",
            "https://user:pw@type.school.example/i.css",
            'https://type.school.example/i.css" onload="x',
            "https://type.school.example/i.css\n<script>",
            `https://type.school.example/${"a".repeat(600)}.css`,
            "",
            "   ",
            5,
            { url: SCHOOL },
            null,
        ]) {
            expect(fontStylesheetHref(value)).toBeUndefined();
        }
    });
});

describe("the Fonts setting", () => {
    it("reads a family and its stylesheet", () => {
        const out = applySiteSettings(base, { Fonts: { body: { family: "Inter", url: SCHOOL } } }, null);
        expect(out.theme.fonts.body.startsWith("'Inter',")).toBe(true);
        expect(out.theme.fontSources).toEqual({ body: SCHOOL });
    });

    it("reads a role saved as a JSON string, which is how a settings field arrives", () => {
        const out = applySiteSettings(base, { Fonts: `{"heading":{"family":"Inter","url":"${SCHOOL}"}}` }, null);
        expect(out.theme.fonts.heading.startsWith("'Inter',")).toBe(true);
        expect(out.theme.fontSources).toEqual({ heading: SCHOOL });
    });

    it("keeps a family name on its own working, with no source", () => {
        const out = applySiteSettings(base, { Fonts: { heading: "Zilla Slab" } }, null);
        expect(out.theme.fonts.heading.startsWith("'Zilla Slab',")).toBe(true);
        expect(out.theme.fontSources).toBeUndefined();
    });

    it("drops a url that is not absolute https, and keeps the family", () => {
        for (const url of ["http://type.school.example/i.css", "/i.css", "javascript:alert(1)", 5]) {
            const out = applySiteSettings(base, { Fonts: { heading: { family: "Inter", url } } }, null);
            expect(out.theme.fonts.heading.startsWith("'Inter',")).toBe(true);
            expect(out.theme.fontSources).toBeUndefined();
        }
    });

    it("takes the url of a role whose family is not a family name", () => {
        const out = applySiteSettings(base, { Fonts: { mono: { family: "x'</style>", url: SCHOOL } } }, null);
        expect(out.theme.fonts.mono).toBe(base.theme.fonts.mono);
        expect(out.theme.fontSources).toEqual({ mono: SCHOOL });
    });

    it("clears a configured stylesheet when the tenant names that role's family alone", () => {
        const configured = {
            ...base,
            theme: resolveTheme({ fonts: { heading: "'Inter', sans-serif" }, fontSources: { heading: SCHOOL } }),
        };
        expect(configured.theme.fontSources).toEqual({ heading: SCHOOL });
        const out = applySiteSettings(configured, { Fonts: { heading: "Zilla Slab" } }, null);
        expect(out.theme.fonts.heading.startsWith("'Zilla Slab',")).toBe(true);
        expect(out.theme.fontSources).toBeUndefined();
    });

    it("leaves a configured stylesheet alone for a role the tenant does not name", () => {
        const configured = { ...base, theme: resolveTheme({ fontSources: { heading: SCHOOL } }) };
        const out = applySiteSettings(configured, { Fonts: { body: "Inter" } }, null);
        expect(out.theme.fontSources).toEqual({ heading: SCHOOL });
    });

    it("drops a configured stylesheet that is not absolute https", () => {
        expect(resolveTheme({ fontSources: { heading: "http://type.school.example/i.css" } }).fontSources).toBeUndefined();
    });
});

describe("what the head links", () => {
    const theme = (sources: Record<string, string>) =>
        resolveTheme({ fonts: { heading: "'Inter', sans-serif" }, fontSources: sources });

    it("links an allowed stylesheet instead of the Google Fonts one for that role", () => {
        const head = fontLinks(theme({ heading: SCHOOL }), allowedFontOrigins("type.school.example fonts.googleapis.com"));
        expect(head.stylesheets).toHaveLength(3);
        expect(head.stylesheets[0]).toBe(SCHOOL);
        expect(head.stylesheets.some((href) => href.includes("family=Inter"))).toBe(false);
        expect(head.google).toBe(true);
    });

    it("refuses an origin the operator did not allow and falls back to the family name", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const head = fontLinks(theme({ heading: SCHOOL }), allowedFontOrigins(undefined));
        expect(head.stylesheets.every((href) => href.startsWith(GOOGLE_FONTS_ORIGIN))).toBe(true);
        expect(head.stylesheets.some((href) => href.includes("family=Inter"))).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("PRESS_FONT_ORIGINS");
    });

    it("says a refusal once, however many pages are rendered", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        for (let i = 0; i < 5; i++) fontLinks(theme({ heading: SCHOOL }), allowedFontOrigins(undefined));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("links nothing to Google Fonts when the operator leaves it out", () => {
        const head = fontLinks(theme({ heading: SCHOOL }), allowedFontOrigins("type.school.example"));
        expect(head.stylesheets).toEqual([SCHOOL]);
        expect(head.google).toBe(false);
    });

    it("refuses a host that only looks like an allowed one", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const allowed = allowedFontOrigins("type.school.example fonts.googleapis.com");
        for (const url of [
            "https://type.school.example.evil.example/i.css",
            "https://eviltype.school.example/i.css",
            "https://type.school.example:8443/i.css",
            "https://evil.example/type.school.example/i.css",
        ]) {
            const head = fontLinks(resolveTheme({ fontSources: { heading: url } }), allowed);
            // The three Google Fonts links the roles fall back to, and nothing from the lookalike.
            expect(head.stylesheets).toHaveLength(3);
            expect(head.stylesheets.every((href) => href.startsWith(`${GOOGLE_FONTS_ORIGIN}/`))).toBe(true);
        }
    });

    it("links one stylesheet once when two roles share it", () => {
        const head = fontLinks(
            theme({ heading: SCHOOL, body: SCHOOL, mono: SCHOOL }),
            allowedFontOrigins("type.school.example"),
        );
        expect(head.stylesheets).toEqual([SCHOOL]);
    });
});

describe("the rendered document", () => {
    // React hoists a preconnect to the top of the head, so the two halves are asserted apart.
    const PRECONNECT =
        '<link rel="preconnect" href="https://fonts.googleapis.com"/>' +
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>';
    const GOOGLE_SHEETS =
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&amp;display=swap"/>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&amp;display=swap"/>' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&amp;display=swap"/>';

    it("links the faces from Google Fonts for a site that names families, as it always did", async () => {
        const head = await headHtml({ Name: "The School", Fonts: { heading: "Sora" } });
        expect(head).toContain(PRECONNECT);
        expect(head).toContain(GOOGLE_SHEETS);
    });

    it("links a tenant's own stylesheet when the operator allows its origin", async () => {
        vi.stubEnv("PRESS_FONT_ORIGINS", "https://type.school.example https://fonts.googleapis.com");
        const head = await headHtml({ Name: "The School", Fonts: { body: { family: "Inter", url: SCHOOL } } });
        expect(head).toContain(`<link rel="stylesheet" href="${SCHOOL}"/>`);
        expect(head).not.toContain("family=Inter");
    });

    it("does not reach an origin the operator did not allow", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const head = await headHtml({ Name: "The School", Fonts: { body: { family: "Inter", url: SCHOOL } } });
        expect(head).not.toContain("type.school.example");
        expect(head).toContain("family=Inter");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("sends nothing to Google Fonts, preconnect included, when the operator leaves it out", async () => {
        vi.stubEnv("PRESS_FONT_ORIGINS", "https://type.school.example");
        const head = await headHtml({ Name: "The School", Fonts: { body: { family: "Inter", url: SCHOOL } } });
        expect(head).toContain(`<link rel="stylesheet" href="${SCHOOL}"/>`);
        expect(head).not.toContain("fonts.googleapis.com");
        expect(head).not.toContain("fonts.gstatic.com");
    });

    it("links no stylesheet at all with loadFonts off", async () => {
        requestHeaders = new Headers({ host: "school.example" });
        vi.stubGlobal("fetch", cms({ Name: "The School", Fonts: { body: { family: "Inter", url: SCHOOL } } }));
        const Layout = createSiteLayout(config, { loadFonts: false });
        const html = await render(await Layout({ children: <p>the page</p> }));
        expect(html).not.toContain("<link");
    });
});
