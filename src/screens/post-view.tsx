import Link from "next/link";
import type { PressConfig } from "../config.js";
import { formatDate, type Post } from "../cms.js";
import { renderMarkdown } from "../markdown.js";

/*
 * The rendering, shared by the static screen and the preview screen.
 *
 * It is its own component because reading `searchParams` forces a route to render dynamically,
 * and a site built with `output: "export"` is refused outright for it. Preview needs the query
 * string; a published post does not. Splitting the fetch from the render is what lets one set of
 * markup serve a static site and a server-rendered one.
 *
 * Every link is built from `config.routes`, so a site that mounts posts at /writing gets /writing
 * links here, in the feed and in the sitemap, instead of three files disagreeing.
 */
export function PostView({
    config,
    post,
    preview = false,
}: {
    config: PressConfig;
    post: Post;
    preview?: boolean;
}) {
    return (
        <article>
            {preview && (
                <div className="notice preview-banner">
                    Preview. This is how the post will look. It is not published, and it is served
                    uncached so nothing here reaches another reader.
                </div>
            )}

            <p className="meta">
                <Link href="/">Back</Link>
            </p>

            <h1>{post.title}</h1>

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
                {post.author && !config.routes.author && <>{` by ${post.author.name}`}</>}
                {post.category && config.routes.category && (
                    <>
                        {" in "}
                        <Link href={`${config.routes.category}/${post.category.slug}`}>
                            {post.category.name}
                        </Link>
                    </>
                )}
            </p>

            {post.coverImage && (
                // Not next/image: the CMS resizes on request with ?w=, so the optimiser would be a
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
