import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { PressConfig } from "../config.js";
import { getPost, getPostPreview, listPosts } from "../cms.js";
import { listRelated } from "../related.js";
import { PostView } from "./post-view.js";

type SlugParams = { params: Promise<{ slug: string }> };
type PreviewParams = SlugParams & { searchParams: Promise<{ preview?: string }> };

/*
 * The post page, in two shapes.
 *
 * `createBlogPost` reads only `params`, so it can be prerendered and works under
 * `output: "export"`. `createBlogPostPreview` also reads `searchParams` for a preview token,
 * which forces dynamic rendering: a static export refuses it outright with "couldn't be rendered
 * statically because it used searchParams". A static site takes the first and gives up draft
 * preview, which is the honest trade and the reason these are two exports rather than a flag.
 */

export function createBlogPost(config: PressConfig) {
    return async function PostPage({ params }: SlugParams) {
        const { slug } = await params;
        const post = await getPost(config, slug);
        if (!post) notFound();
        const related = await listRelated(config, post);
        return <PostView config={config} post={post} related={related} />;
    };
}

export function createBlogPostPreview(config: PressConfig) {
    return async function PostPreviewPage({ params, searchParams }: PreviewParams) {
        const { slug } = await params;
        const { preview } = await searchParams;

        // A token routes to the uncached read, so a draft never enters the shared cache.
        const post = preview ? await getPostPreview(config, slug, preview) : await getPost(config, slug);
        if (!post) notFound();

        // Related reads published content, so it is the same cached call here. A preview that
        // hides the band would not be showing the editor the page they are about to publish.
        const related = await listRelated(config, post);
        return (
            <PostView config={config} post={post} preview={Boolean(preview)} related={related} />
        );
    };
}

/*
 * Metadata from the API's resolved `seo` block rather than assembled here.
 *
 * A type opted into SEO fields returns title, description, canonical, social image and noIndex on
 * every public response, with the title already falling back to the entry's title. So this maps,
 * and an editor changing the meta description in the console changes the page.
 */
export function createPostMetadata(config: PressConfig) {
    return async function generateMetadata({ params }: SlugParams): Promise<Metadata> {
        const { slug } = await params;
        const post = await getPost(config, slug);
        if (!post) return { title: "Not found" };

        const seo = post.seo;
        const title = seo?.title ?? post.title;
        const description = seo?.description ?? post.excerpt;
        const image = seo?.imageUrl ?? post.coverImage;

        return {
            title,
            description,
            alternates: seo?.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
            robots: seo?.noIndex ? { index: false, follow: false } : undefined,
            openGraph: {
                title,
                description,
                type: "article",
                publishedTime: post.publishedAt,
                images: image ? [image] : undefined,
            },
            twitter: {
                card: image ? "summary_large_image" : "summary",
                title,
                description,
                images: image ? [image] : undefined,
            },
        };
    };
}

/*
 * Slugs for a static export, paged to the end rather than to one hardcoded limit.
 *
 * Every consumer of an export-mode site needs this, and every one that hand-writes it caps the
 * page size and silently drops the posts past it. Doing it once here is the difference between an
 * engine and a snippet in a README.
 */
export function createPostStaticParams(config: PressConfig) {
    return async function generateStaticParams(): Promise<{ slug: string }[]> {
        const slugs: { slug: string }[] = [];
        const pageSize = 100;

        // No page cap, for the reason in the comment above. The loop ends on the API's hasNextPage,
        // or on an empty page if that were ever wrong.
        for (let page = 1; ; page++) {
            let batch;
            try {
                batch = await listPosts(config, { page, pageSize });
            } catch {
                // A build with no CMS reachable produces no routes. Under `output: "export"` Next
                // then refuses the build, which is the correct outcome: a static site with no
                // content is not something to ship quietly.
                break;
            }
            for (const p of batch.posts) if (p.slug) slugs.push({ slug: p.slug });
            if (!batch.hasNextPage || batch.posts.length === 0) break;
        }

        return slugs;
    };
}
