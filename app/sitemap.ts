import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/cms";

const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state and
 * cannot disagree with what the site actually serves.
 *
 * A post whose SEO block says noIndex is left out. The CMS resolves that flag per entry and its own
 * sitemap honours it, so a site that ignored it here would contradict the CMS on the one signal an
 * editor set deliberately.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const { posts } = await listPosts({ pageSize: 100 });

    const indexable = posts.filter((p) => !p.seo?.noIndex);

    return [
        { url: siteUrl, changeFrequency: "daily", priority: 1 },
        ...indexable.map((p) => ({
            url: `${siteUrl}/blog/${p.slug}`,
            lastModified: p.publishedAt ? new Date(p.publishedAt) : undefined,
            changeFrequency: "monthly" as const,
            priority: 0.7,
        })),
    ];
}
