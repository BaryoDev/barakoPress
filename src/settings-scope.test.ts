import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Which build-time keys a tenant may set, and which stay with the operator (#53).
 *
 * A request-time site is one image serving every tenant, so a number baked into press.config.ts is
 * the same number for all of them. `PageSizes` and `ReservedSlugs` are that tenant's data now. The
 * pages mount is not, and the last block here is the guard on that: it must match a route file on
 * disk, so a tenant cannot move it.
 *
 * Nothing in this file reads the request. `headers()` throwing is the assertion of that.
 */
vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { isReservedPath, pageHref } = await import("./cms.js");
const { listCollection } = await import("./collections.js");
const { applySiteSettings } = await import("./site.js");

const CMS = "http://cms.test";

/** A request-time site with the blog blueprint, its pages at the root, pinned to one tenant. */
function base() {
    return defineConfig({ sites: {}, pages: "", cmsUrl: CMS, tenant: "bakery" });
}

/** The same site with a tenant's settings applied. */
function withSettings(data: Record<string, unknown>) {
    return applySiteSettings(base(), data, null);
}

type Call = string;

/** A CMS holding `count` products, recording the query each list asked for. */
function cms(count: number) {
    const calls: Call[] = [];
    const items = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        slug: `product-${i}`,
        data: { Title: `Product ${i}`, Slug: `product-${i}`, Body: "x" },
    }));
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
            const url = new URL(String(input));
            calls.push(url.pathname + url.search);
            const size = Number(url.searchParams.get("pageSize") ?? 20);
            const page = Number(url.searchParams.get("page") ?? 1);
            const slice = items.slice((page - 1) * size, page * size);
            return Response.json({
                items: slice,
                page,
                pageSize: size,
                totalItems: items.length,
                totalPages: Math.ceil(items.length / size),
                hasNextPage: page * size < items.length,
            });
        }),
    );
    return calls;
}

afterEach(() => {
    forgetCachedReads();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("PageSizes", () => {
    it("lists the tenant's index size, not the configured one", async () => {
        const calls = cms(80);

        const { items } = await listCollection(withSettings({ PageSizes: { index: 50 } }), "post");

        expect(items).toHaveLength(50);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain("pageSize=50");
    });

    it("keeps the configured sizes for the keys the tenant left out", () => {
        expect(withSettings({ PageSizes: { feed: 9 } }).pageSizes).toEqual({
            index: 20,
            feed: 9,
            sitemap: 1000,
            archive: 50,
        });
    });

    it("reads all four keys", () => {
        expect(withSettings({ PageSizes: { index: 6, feed: 7, sitemap: 8, archive: 9 } }).pageSizes).toEqual({
            index: 6,
            feed: 7,
            sitemap: 8,
            archive: 9,
        });
    });

    it("reads the setting saved as the text an editor typed", () => {
        expect(withSettings({ PageSizes: '{"index":50}' }).pageSizes.index).toBe(50);
    });

    it("keeps the configured size for a value that is not a whole number in range", () => {
        const wrong: unknown[] = [0, -1, 1.5, "50", null, 1001, Number.NaN];
        expect(wrong.length).toBeGreaterThan(0);
        for (const index of wrong) {
            expect(withSettings({ PageSizes: { index } }).pageSizes.index).toBe(20);
        }
    });

    it("keeps the configured sizes when the setting is absent or is not an object", () => {
        for (const PageSizes of [undefined, "", "not json", 50, ["index", 50]]) {
            expect(withSettings({ PageSizes }).pageSizes).toEqual({ index: 20, feed: 50, sitemap: 1000, archive: 50 });
        }
    });

    it("leaves a collection's own pageSize winning over the site's", async () => {
        const calls = cms(80);
        const config = applySiteSettings(base(), { PageSizes: { index: 50 }, Collections: {} }, null);

        await listCollection({ ...config, collections: { ...config.collections, post: { ...config.collections.post, pageSize: 7 } } }, "post");

        expect(calls[0]).toContain("pageSize=7");
    });
});

describe("ReservedSlugs", () => {
    it("adds the tenant's slugs to the configured ones", () => {
        const config = withSettings({ ReservedSlugs: ["Shop", "status"] });

        expect(config.reservedSlugs).toContain("shop");
        expect(config.reservedSlugs).toContain("status");
        expect(isReservedPath(config, "/shop")).toBe(true);
        expect(isReservedPath(config, "/status/uptime")).toBe(true);
        expect(isReservedPath(config, "/about")).toBe(false);
    });

    it("cannot drop a configured slug, whatever the tenant saves", () => {
        const configured = base().reservedSlugs;
        expect(configured).toContain("blog");
        expect(configured).toContain("api");

        for (const ReservedSlugs of [[], ["shop"], "[]", ["blog"]]) {
            const config = withSettings({ ReservedSlugs });
            for (const slug of configured) expect(config.reservedSlugs).toContain(slug);
        }
    });

    it("names a slug once, however many times it is saved", () => {
        const config = withSettings({ ReservedSlugs: ["blog", "shop", "Shop", "shop"] });

        expect(config.reservedSlugs.filter((s) => s === "shop")).toHaveLength(1);
        expect(config.reservedSlugs.filter((s) => s === "blog")).toHaveLength(1);
    });

    it("takes a slug an editor wrote with slashes around it", () => {
        expect(withSettings({ ReservedSlugs: ["/shop/"] }).reservedSlugs).toContain("shop");
    });

    it("drops anything that is not one plain path segment", () => {
        const wrong = ["a/b", "   ", "x y", "../up", "%5f", "a".repeat(65), 7, null, ["shop"]];
        const config = withSettings({ ReservedSlugs: wrong });

        expect(config.reservedSlugs).toEqual(base().reservedSlugs);
    });

    it("takes at most fifty of them", () => {
        const many = Array.from({ length: 60 }, (_, i) => `slug${i}`);
        const config = withSettings({ ReservedSlugs: many });

        expect(config.reservedSlugs).toContain("slug49");
        expect(config.reservedSlugs).not.toContain("slug50");
    });

    it("keeps the configured list when the setting is not a list", () => {
        for (const ReservedSlugs of [undefined, "shop", 7, { shop: true }]) {
            expect(withSettings({ ReservedSlugs }).reservedSlugs).toEqual(base().reservedSlugs);
        }
    });
});

/*
 * The mount is operator-only, and this is the guard that says so out loud.
 *
 * Next resolves a catch-all by where its file sits: the shared image has app/[...path]/page.tsx at
 * the root and `pages: ""` to match. A tenant that could set the mount to /info would have every
 * generated link point one segment below a route file that does not exist, and `isReservedPath`
 * stops checking at all once the mount is not the root. So nothing here reads a mount from settings,
 * and a change that starts to has to delete this block first.
 */
describe("the pages mount", () => {
    it("is not read from the tenant's settings under any of the names one might reach for", () => {
        for (const key of ["PagesMount", "Pages", "PageMount", "PagesPath", "pages"]) {
            const config = withSettings({ [key]: "/info" });
            expect(config.pages).toBe("");
            expect(pageHref(config, "/about")).toBe("/about");
        }
    });

    it("stays unset for a site that configured no page tree", () => {
        const config = applySiteSettings(defineConfig({ sites: {}, cmsUrl: CMS }), { PagesMount: "" }, null);

        expect(config.pages).toBeUndefined();
    });
});
