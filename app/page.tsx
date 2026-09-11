import Link from "next/link";
import { listPosts, formatDate, type Post } from "@/lib/cms";

/*
 * Re-rendered at most this often even if no webhook ever arrives. The image is built without a
 * CMS on purpose, so this page is prerendered empty; without a backstop it would stay empty until
 * something invalidated it.
 */
export const revalidate = 300;


export default async function Home() {
    let posts: Post[] = [];
    let failure: string | null = null;

    try {
        ({ posts } = await listPosts({ pageSize: 20 }));
    } catch (e) {
        // The CMS being unreachable is the most likely thing to be wrong, so it gets a readable
        // page rather than a stack trace. Note this render is not cached on failure, so the next
        // request retries rather than serving the error for as long as the tag lives.
        failure = e instanceof Error ? e.message : String(e);
    }

    const featured = posts.filter((p) => p.featured);
    const rest = posts.filter((p) => !p.featured);

    return (
        <>
            <header className="masthead">
                <h1>{process.env.SITE_NAME ?? "barakoPress"}</h1>
                <p className="tagline">{process.env.SITE_TAGLINE ?? "A blog on barakoCMS"}</p>
            </header>

            {failure && (
                <div className="notice error">
                    <p>
                        <strong>The CMS did not answer.</strong>
                    </p>
                    <p>
                        <code>{failure}</code>
                    </p>
                </div>
            )}

            {!failure && posts.length === 0 && (
                <div className="notice">
                    <p>
                        <strong>Nothing published yet.</strong>
                    </p>
                    <p>
                        Write a post in the console and publish it. Only published entries of a type
                        opted into public delivery appear here.
                    </p>
                </div>
            )}

            {featured.length > 0 && (
                <section className="featured">
                    {featured.map((p) => (
                        <Card key={p.id} post={p} featured />
                    ))}
                </section>
            )}

            {rest.map((p) => (
                <Card key={p.id} post={p} />
            ))}
        </>
    );
}

function Card({ post, featured = false }: { post: Post; featured?: boolean }) {
    return (
        <article className={featured ? "card featured-card" : "card"}>
            {featured && <span className="chip">Featured</span>}
            <h2>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </h2>
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
