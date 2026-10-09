import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The JSON-LD block barakoCMS 4.8 sends with a read by slug (#567), drawn on the item page.
 */
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { createCollectionDetail } = await import("./screens/collection.js");
const { structuredDataJson } = await import("./structured-data.js");

const CMS = "http://cms.test";
const SITE = { name: "Riverside", url: "https://riverside.example" };

/** What a value holding a script end tag, quotes and both line separators looks like in the API's JSON. */
const HOSTILE = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: 'Flood "waters" </script><script>alert(1)</script> recede',
    description: "line\u2028para\u2029end <!-- not a comment",
};

let structuredData: unknown;

function cms() {
    return vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/public/post/flood") {
            return Response.json({
                id: "f",
                slug: "flood",
                data: { Title: "Flood waters recede", Slug: "flood", Body: "The river is back." },
                ...(structuredData === undefined ? {} : { structuredData }),
            });
        }
        return new Response("", { status: 404 });
    });
}

async function render(config: ReturnType<typeof defineConfig>): Promise<string> {
    const page = createCollectionDetail(config, "post");
    return renderToStaticMarkup(await page({ params: Promise.resolve({ slug: "flood" }) }));
}

/** The text of every JSON-LD script in the markup. */
function blocks(html: string): string[] {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

beforeEach(() => {
    forgetCachedReads();
    structuredData = undefined;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("structured data on an item page", () => {
    it("draws the block the API sent, escaped so nothing in it can end the script element", async () => {
        structuredData = HOSTILE;
        const html = await render(defineConfig({ site: SITE, cmsUrl: CMS }));

        const found = blocks(html);
        expect(found).toHaveLength(1);
        // The only script end tag in the page is the block's own.
        expect(html.match(/<\/script/gi)).toHaveLength(1);
        expect(found[0]).not.toContain("<");
        expect(found[0]).not.toMatch(/[\u2028\u2029]/);
        expect(found[0]).toContain("\\u003c/script>");
        // And it parses back to exactly what the API sent.
        expect(JSON.parse(found[0])).toEqual(HOSTILE);
        expect(html).toContain("Flood waters recede");
    });

    it("draws nothing when the API sent no block, as an older API does", async () => {
        const html = await render(defineConfig({ site: SITE, cmsUrl: CMS }));
        expect(html).toContain("Flood waters recede");
        expect(html).not.toContain("application/ld+json");
    });

    it("draws nothing when the site turns it off", async () => {
        structuredData = HOSTILE;
        const html = await render(defineConfig({ site: SITE, cmsUrl: CMS, structuredData: false }));
        expect(html).toContain("Flood waters recede");
        expect(html).not.toContain("application/ld+json");
    });

    it("draws nothing for a value that is not an object", async () => {
        for (const value of ["</script>", ["a"], null, 3, {}]) {
            forgetCachedReads();
            structuredData = value;
            const html = await render(defineConfig({ site: SITE, cmsUrl: CMS }));
            expect(html).not.toContain("application/ld+json");
        }
    });
});

describe("structuredDataJson", () => {
    it("leaves out a block over the bound and says so once", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const big = { "@type": "WebPage", name: "x".repeat(70 * 1024) };
        expect(structuredDataJson(big)).toBeNull();
        expect(structuredDataJson(big)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
