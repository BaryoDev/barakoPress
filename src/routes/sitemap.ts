import type { MetadataRoute } from "next";
import type { PressConfig } from "../config.js";
import { flattenNavigation, getNavigation, isReservedPath, listPosts, pageHref } from "../cms.js";
import { notFound } from "next/navigation";
import { siteConfigOrNull } from "../site.js";

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state
 * and cannot disagree with what the site serves.
 *
 * A post whose SEO block says noIndex is left out: the CMS resolves that flag per entry and its
 * own sitemap honours it, so a site that ignored it here would contradict the CMS on the one
 * signal an editor set deliberately.
 *
 * Pages are the ones in the menu, since the Pages module publishes no other public list of paths,
 * less any under a reserved slug, which never render.
 */
export function createSitemap(base: PressConfig) {
    return async function sitemap(): Promise<MetadataRoute.Sitemap> {
        const config = await siteConfigOrNull(base);
        // Not served while holding, session or not.
        if (!config || config.holding) notFound();
        let indexable: Awaited<ReturnType<typeof listPosts>>["posts"] = [];
        try {
            const { posts } = await listPosts(config, { pageSize: config.pageSizes.sitemap });
            indexable = posts.filter((p) => !p.seo?.noIndex);
        } catch {
            // A sitemap that throws is worse than a short one: it fails the build when
            // prerendered, and serves a crawler a 500 at runtime.
            indexable = [];
        }

        let pagePaths: string[] = [];
        if (config.pages !== undefined) {
            try {
                pagePaths = flattenNavigation(await getNavigation(config)).filter((p) => !isReservedPath(config, p));
            } catch {
                pagePaths = [];
            }
        }

        const home = config.site.url;
        const pages = [...new Set(pagePaths.map((p) => pageHref(config, p)))]
            .map((href) => `${home}${href === "/" ? "" : href}`)
            .filter((url) => url !== home)
            .map((url) => ({ url, changeFrequency: "monthly" as const, priority: 0.5 }));

        return [
            { url: home, changeFrequency: "daily", priority: 1 },
            ...indexable.map((p) => ({
                url: `${config.site.url}${config.routes.post}/${p.slug}`,
                lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined,
                changeFrequency: "monthly" as const,
                priority: 0.7,
            })),
            ...pages,
        ];
    };
}
