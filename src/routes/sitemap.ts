import type { MetadataRoute } from "next";
import { pinnedTenant, type PressConfig } from "../config.js";
import { flattenNavigation, getNavigation, isChromePath, isReservedPath, pageHref } from "../cms.js";
import { listAllCollection } from "../collections.js";
import { notFound } from "next/navigation";
import { siteConfigOrNull } from "../site.js";

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state
 * and cannot disagree with what the site serves.
 *
 * Each collection with a route is listed, unless its `sitemap` is off, as the blog's authors and
 * categories are. An item whose SEO block says noIndex is left out: the CMS resolves that flag per
 * entry and its own sitemap honours it, so a site that ignored it here would contradict the CMS on
 * the one signal an editor set deliberately.
 *
 * Pages are the ones in the menu, since the Pages module publishes no other public list of paths,
 * less any under a reserved slug, which never render.
 *
 * A collection is paged to its end rather than asked for in one large page (#72). It used to ask for
 * `pageSizes.sitemap` entries, which defaults to a thousand, and barakoCMS answers a public list with
 * at most a hundred and no error, so every entry past the hundredth was missing and the file was
 * still valid XML with a 200 on it. `pageSizes.sitemap` is now what it reads as, the most entries one
 * collection puts in the file, and the reading is done a page at a time at whatever size the API
 * allows.
 *
 * The whole file is bounded by the sitemap standard: 50,000 URLs. Reaching it stops the file there
 * and says so, because the standard's own answer past that point is several files behind a sitemap
 * index, and a route file is where a consumer builds those with Next's `generateSitemaps`. Serving a
 * file over the limit would be serving one crawlers are entitled to ignore whole.
 */

/** The most URLs one sitemap file may hold, from sitemaps.org. */
export const SITEMAP_MAX_URLS = 50_000;

export function createSitemap(base: PressConfig) {
    return async function sitemap(): Promise<MetadataRoute.Sitemap> {
        const config = await siteConfigOrNull(base);
        // Not served while holding, session or not.
        if (!config || config.holding) notFound();

        const items: MetadataRoute.Sitemap = [];
        // The home page takes the first slot, so the rest of the file is one URL shorter than the cap.
        const room = () => SITEMAP_MAX_URLS - 1 - items.length;
        for (const [key, col] of Object.entries(config.collections)) {
            if (col.route === undefined || col.sitemap === false) continue;
            const limit = Math.min(config.pageSizes.sitemap, room());
            if (limit <= 0) {
                sayOnce(sitemapFull(config));
                break;
            }
            try {
                const listed = await listAllCollection(config, key, { limit });
                if (listed.truncated) {
                    sayOnce(
                        limit < config.pageSizes.sitemap
                            ? sitemapFull(config)
                            : `sitemap: "${key}" for tenant "${pinnedTenant(config) ?? ""}" holds more than the ${limit} entries this site lists, so the rest are not in the sitemap`,
                    );
                }
                for (const item of listed.items) {
                    if (item.seo?.noIndex) continue;
                    items.push({
                        url: `${config.site.url}${col.route}/${item.slug}`,
                        lastModified: item.date ? new Date(item.date) : undefined,
                        changeFrequency: "monthly" as const,
                        priority: 0.7,
                    });
                }
            } catch {
                // A sitemap that throws is worse than a short one: it fails the build when
                // prerendered, and serves a crawler a 500 at runtime.
            }
        }

        let pagePaths: string[] = [];
        if (config.pages !== undefined) {
            try {
                pagePaths = flattenNavigation(await getNavigation(config)).filter(
                    (p) => !isReservedPath(config, p) && !isChromePath(config, p),
                );
            } catch {
                pagePaths = [];
            }
        }

        const home = config.site.url;
        const pages = [...new Set(pagePaths.map((p) => pageHref(config, p)))]
            .map((href) => `${home}${href === "/" ? "" : href}`)
            .filter((url) => url !== home)
            .map((url) => ({ url, changeFrequency: "monthly" as const, priority: 0.5 }));

        if (pages.length > room()) sayOnce(sitemapFull(config));
        return [{ url: home, changeFrequency: "daily" as const, priority: 1 }, ...items, ...pages.slice(0, room())];
    };
}

/*
 * Said once rather than on every render, the way a font or a preset warning is. What it names is a
 * number somebody changes once, or a site that has outgrown one file, so a line per page view would
 * only bury it.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

function sitemapFull(config: PressConfig): string {
    return `sitemap: tenant "${pinnedTenant(config) ?? ""}" fills a sitemap of ${SITEMAP_MAX_URLS} URLs, the most one file may hold, so the rest are left out. Split it with Next's generateSitemaps.`;
}

/** For tests: say every message again. */
export function forgetSitemapWarnings(): void {
    said.clear();
}
