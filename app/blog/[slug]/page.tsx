import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPost, getPostPreview, formatDate } from "@/lib/cms";
import { renderMarkdown } from "@/lib/markdown";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { slug } = await params;
    const post = await getPost(slug);
    if (!post) return { title: "Not found" };

    /*
     * The SEO block is resolved by the API, not assembled here. A type that has opted into SEO
     * fields gets title, description, canonical, social image and noIndex back on every public
     * response, with the title already falling back to the entry's Title. So this maps rather than
     * decides, and an editor changing the meta description in the console changes the page.
     */
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
}

export default async function PostPage({ params, searchParams }: Params) {
    const { slug } = await params;
    const { preview } = await searchParams;

    /*
     * A preview token routes to the uncached client. Everything else is the cached path, so a
     * visitor never pays for a draft lookup and a draft is never stored in the shared cache.
     */
    const post = preview ? await getPostPreview(slug, preview) : await getPost(slug);
    if (!post) notFound();

    return (
        <article>
            {preview && (
                <div className="notice preview-banner">
                    Preview. This is how the post will look; it is not published and search engines
                    will not see it.
                </div>
            )}

            <p className="meta">
                <Link href="/">Back</Link>
            </p>

            <h1>{post.title}</h1>

            <p className="meta">
                <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                {post.author && (
                    <>
                        {" by "}
                        <Link href={`/authors/${post.author.slug}`}>{post.author.name}</Link>
                    </>
                )}
                {post.category && (
                    <>
                        {" in "}
                        <Link href={`/categories/${post.category.slug}`}>{post.category.name}</Link>
                    </>
                )}
            </p>

            {post.coverImage && (
                // Not next/image: the CMS resizes on request with ?w= and the optimiser would be a
                // second resizer in front of the first.
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cover" src={post.coverImage} alt={post.coverImageAlt ?? ""} />
            )}

            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }} />

            {post.tags.length > 0 && (
                <p className="tags">
                    {post.tags.map((t) => (
                        <span key={t} className="tag">
                            {t}
                        </span>
                    ))}
                </p>
            )}
        </article>
    );
}
