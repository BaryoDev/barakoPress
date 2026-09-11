import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/cms";

const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");


/*
 * Re-rendered at most this often even if no webhook ever arrives. The image is built without a
 * CMS on purpose, so this page is prerendered empty; without a backstop it would stay empty until
 * something invalidated it.
 */
export const revalidate = 300;

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state and
 * cannot disagree with what the site actually serves.
 *
 * A post whose SEO block says noIndex is left out. The CMS resolves that flag per entry and its own
 * sitemap honours it, so a site that ignored it here would contradict the CMS on the one signal an
 * editor set deliberately.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    /*
     * A sitemap that throws is worse than a short one.
     *
     * This is prerendered at build, and the image is built with no CMS reachable, so an
     * unhandled failure here fails the whole build. At runtime the same throw would serve a 500
     * to a crawler. Either way the right answer is the home page on its own until the next
     * revalidation fills the rest in.
     */
    let indexable: Awaited<ReturnType<typeof listPosts>>["posts"] = [];
    try {
        const { posts } = await listPosts({ pageSize: 100 });
        indexable = posts.filter((p) => !p.seo?.noIndex);
    } catch {
        indexable = [];
    }

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
