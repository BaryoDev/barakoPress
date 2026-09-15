import Link from "next/link";
import type { PressConfig } from "../config.js";
import { formatDate, listPosts, type Post } from "../cms.js";
import { siteConfig } from "../site.js";

/*
 * The post list.
 *
 * A factory rather than a component, because a Next route is a file and a package cannot write
 * files into someone else's app. The consumer's page.tsx is:
 *
 *     import { createBlogIndex } from "barakopress";
 *     import { config } from "@/press.config";
 *     export default createBlogIndex(config);
 *     export const revalidate = 300;
 *
 * `Card` is exported too, so a site that wants its own list but the engine's card can have one
 * without copying the markup.
 */

export function Card({
    config,
    post,
    featured = false,
}: {
    config: PressConfig;
    post: Post;
    featured?: boolean;
}) {
    return (
        <article className={featured ? "card featured-card" : "card"}>
            {featured && <span className="chip">Featured</span>}
            <h2>
                <Link href={`${config.routes.post}/${post.slug}`}>{post.title}</Link>
            </h2>
            <p className="meta">
                {post.publishedAt && (
                    <time dateTime={post.publishedAt}>{formatDate(config, post.publishedAt)}</time>
                )}
                {post.author && config.routes.author && (
                    <>
                        {" by "}
                        <Link href={`${config.routes.author}/${post.author.slug}`}>
                            {post.author.name}
                        </Link>
                    </>
                )}
                {post.category && config.routes.category && (
                    <>
                        {" in "}
                        <Link href={`${config.routes.category}/${post.category.slug}`}>
                            {post.category.name}
                        </Link>
                    </>
                )}
            </p>
            {post.excerpt && <p className="excerpt">{post.excerpt}</p>}
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

export function createBlogIndex(base: PressConfig) {
    return async function BlogIndex() {
        const config = await siteConfig(base);
        let posts: Post[] = [];
        let failure: string | null = null;

        try {
            ({ posts } = await listPosts(config));
        } catch (e) {
            // An unreachable CMS is the likeliest thing to be wrong, so it gets a readable page
            // rather than a stack trace. This render is not cached, so the next request retries.
            failure = e instanceof Error ? e.message : String(e);
        }

        const featured = posts.filter((p) => p.featured);
        const rest = posts.filter((p) => !p.featured);

        /*
         * The screen carries its own reading column now. It used to come from a `.shell` class in
         * the consumer's layout, which meant a screen could only be placed one way and the post
         * screen, whose bands run edge to edge, could not be placed at all.
         */
        return (
            <div className="shell">
                <header className="masthead">
                    <h1>{config.site.name}</h1>
                    {config.site.tagline && <p className="tagline">{config.site.tagline}</p>}
                </header>

                {failure && (
                    <div className="notice error">
                        <p>
                            <strong>This page could not be loaded.</strong>
                        </p>
                        <p>Please try again shortly.</p>
                    </div>
                )}

                {!failure && posts.length === 0 && (
                    <div className="notice">
                        <p>
                            <strong>Nothing published yet.</strong>
                        </p>
                        <p>
                            Only published entries of a type opted into public delivery appear here.
                        </p>
                    </div>
                )}

                {featured.map((p) => (
                    <Card key={p.id} config={config} post={p} featured />
                ))}
                {rest.map((p) => (
                    <Card key={p.id} config={config} post={p} />
                ))}
            </div>
        );
    };
}
