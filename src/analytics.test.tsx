import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A Umami tracking script in the page head (#179).
 *
 * Both values are a tenant's settings on their way into a script tag in every visitor's page, so the
 * tag renders only when the URL is https on an origin the operator allows and the id is a UUID. A
 * deployment that sets nothing renders the head it rendered before.
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

const CMS = "http://cms.test";
const SCRIPT = "https://playground.baryo.dev/analytics/script.js";
const ID = "0f6a1c2e-3b4d-4e5f-8a9b-1c2d3e4f5a6b";
const TAG = `<script defer="" src="${SCRIPT}" data-website-id="${ID}"></script>`;

const config = defineConfig({ sites: {}, cmsUrl: CMS });

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

async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function pageHtml(settings: Record<string, unknown>, host = "school.example"): Promise<string> {
    requestHeaders = new Headers({ host });
    vi.stubGlobal("fetch", cms(settings));
    const Layout = createSiteLayout(config);
    return render(await Layout({ children: <p>the page</p> }));
}

async function headHtml(settings: Record<string, unknown>): Promise<string> {
    const html = await pageHtml(settings);
    return html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
}

const BOTH = { Name: "The School", AnalyticsScript: SCRIPT, AnalyticsWebsiteId: ID };

/*
 * Every "absent" case first renders the tag with the one thing it varies put right, so it cannot
 * pass on a head that never renders a script at all.
 */
async function expectTagWhenAllowed(settings: Record<string, unknown> = BOTH): Promise<void> {
    vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
    expect(await headHtml(settings)).toContain(TAG);
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("the analytics script in the head", () => {
    it("renders with both settings and the script's origin allowed", async () => {
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        expect(await headHtml(BOTH)).toContain(TAG);
    });

    it("reads a bare host in the allow list as https", async () => {
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "cdn.example, playground.baryo.dev");
        expect(await headHtml(BOTH)).toContain(TAG);
    });

    it("renders from a build-time site's config, held to the same list", async () => {
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        const built = defineConfig({
            cmsUrl: CMS,
            site: { name: "Built", url: "https://built.example", analyticsScript: SCRIPT, analyticsWebsiteId: ID },
        });
        const html = await render(await createSiteLayout(built)({ children: <p>the page</p> }));
        expect(html).toContain(TAG);

        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "");
        const refused = await render(await createSiteLayout(built)({ children: <p>the page</p> }));
        expect(refused).toContain("the page");
        expect(refused).not.toContain("<script");
    });

    it("is absent when the allow list is unset or blank, which is every site today", async () => {
        await expectTagWhenAllowed();
        for (const raw of [undefined, "", "   "]) {
            if (raw === undefined) vi.unstubAllEnvs();
            else vi.stubEnv("PRESS_SCRIPT_ORIGINS", raw);
            const head = await headHtml(BOTH);
            expect(head).toContain("<style");
            expect(head).not.toContain("<script");
            expect(head).not.toContain("playground.baryo.dev");
        }
    });

    it("is absent when the script's origin is not on the list", async () => {
        await expectTagWhenAllowed();
        for (const allowed of [
            "https://cdn.example",
            "http://playground.baryo.dev",
            "https://playground.baryo.dev:8443",
            "https://baryo.dev",
        ]) {
            vi.stubEnv("PRESS_SCRIPT_ORIGINS", allowed);
            const head = await headHtml(BOTH);
            expect(head).toContain("<style");
            expect(head).not.toContain("<script");
        }
    });

    it("is absent when either setting is missing", async () => {
        await expectTagWhenAllowed();
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        for (const settings of [
            { Name: "The School", AnalyticsScript: SCRIPT },
            { Name: "The School", AnalyticsWebsiteId: ID },
            { Name: "The School" },
        ]) {
            const head = await headHtml(settings);
            expect(head).toContain("<style");
            expect(head).not.toContain("<script");
        }
    });

    it("is absent when the id is not a UUID or carries quotes", async () => {
        await expectTagWhenAllowed();
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        for (const id of ["site-1", `${ID}" onload="alert(1)`, `'${ID}'`, `${ID}"`, "", 12345]) {
            const head = await headHtml({ ...BOTH, AnalyticsWebsiteId: id });
            expect(head).toContain("<style");
            expect(head).not.toContain("<script");
            expect(head).not.toContain("onload");
        }
    });

    it("is absent for a javascript:, http: or relative script URL", async () => {
        await expectTagWhenAllowed();
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev http://playground.baryo.dev");
        for (const url of [
            "javascript:alert(1)",
            "http://playground.baryo.dev/analytics/script.js",
            "//playground.baryo.dev/analytics/script.js",
            "/analytics/script.js",
            "data:text/javascript,alert(1)",
        ]) {
            const head = await headHtml({ ...BOTH, AnalyticsScript: url });
            expect(head).toContain("<style");
            expect(head).not.toContain("<script");
            expect(head).not.toContain("alert");
        }
    });

    it("is absent from the holding page", async () => {
        await expectTagWhenAllowed();
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        const html = await pageHtml({ ...BOTH, Mode: "Holding", HoldingMessage: "Back soon" });
        expect(html).toContain("Back soon");
        expect(html).not.toContain("<script");
    });

    it("is absent from the document a request with no tenant gets", async () => {
        await expectTagWhenAllowed();
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://playground.baryo.dev");
        const html = await pageHtml(BOTH, "nobody.example");
        expect(html).toContain("the page");
        expect(html).not.toContain("<script");
    });
});
