import type { MetadataRoute } from "next";
import type { PressConfig } from "../config.js";
import { listPosts } from "../cms.js";

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state
 * and cannot disagree with what the site serves.
 *
 * A post whose SEO block says noIndex is left out: the CMS resolves that flag per entry and its
 * own sitemap honours it, so a site that ignored it here would contradict the CMS on the one
 * signal an editor set deliberately.
 */
export function createSitemap(config: PressConfig) {
    return async function sitemap(): Promise<MetadataRoute.Sitemap> {
        let indexable: Awaited<ReturnType<typeof listPosts>>["posts"] = [];
        try {
            const { posts } = await listPosts(config, { pageSize: config.pageSizes.sitemap });
            indexable = posts.filter((p) => !p.seo?.noIndex);
        } catch {
            // A sitemap that throws is worse than a short one: it fails the build when
            // prerendered, and serves a crawler a 500 at runtime.
            indexable = [];
        }

        return [
            { url: config.site.url, changeFrequency: "daily", priority: 1 },
            ...indexable.map((p) => ({
                url: `${config.site.url}${config.routes.post}/${p.slug}`,
                lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined,
                changeFrequency: "monthly" as const,
                priority: 0.7,
            })),
        ];
    };
}
