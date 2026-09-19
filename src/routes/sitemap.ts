import type { MetadataRoute } from "next";
import type { PressConfig } from "../config.js";
import { flattenNavigation, getNavigation, isChromePath, isReservedPath, pageHref } from "../cms.js";
import { listCollection } from "../collections.js";
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
 */
export function createSitemap(base: PressConfig) {
    return async function sitemap(): Promise<MetadataRoute.Sitemap> {
        const config = await siteConfigOrNull(base);
        // Not served while holding, session or not.
        if (!config || config.holding) notFound();

        const items: MetadataRoute.Sitemap = [];
        for (const [key, col] of Object.entries(config.collections)) {
            if (col.route === undefined || col.sitemap === false) continue;
            try {
                const listed = await listCollection(config, key, { pageSize: config.pageSizes.sitemap });
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

        return [{ url: home, changeFrequency: "daily", priority: 1 }, ...items, ...pages];
    };
}
