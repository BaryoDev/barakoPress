import Link from "next/link";
import { notFound } from "next/navigation";
import { listPostsBy, getOne, formatDate } from "@/lib/cms";
import { renderMarkdown } from "@/lib/markdown";

export default async function AuthorPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const [author, posts] = await Promise.all([
        getOne("author", slug),
        listPostsBy("Author", "author", slug),
    ]);
    if (!author || !posts) notFound();

    return (
        <>
            <p className="meta">
                <Link href="/">Back</Link>
            </p>
            <h1>{author.name}</h1>
            {author.description && (
                <div
                    className="prose"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(author.description) }}
                />
            )}
            {author.website && (
                <p className="meta">
                    <a href={author.website} rel="noopener noreferrer">
                        {author.website}
                    </a>
                </p>
            )}

            <h2 style={{ marginTop: "2.5rem" }}>
                {posts.length} {posts.length === 1 ? "post" : "posts"}
            </h2>
            {posts.map((p) => (
                <article key={p.id} className="card">
                    <h2>
                        <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                    </h2>
                    <p className="meta">
                        <time dateTime={p.publishedAt}>{formatDate(p.publishedAt)}</time>
                    </p>
                    {p.excerpt && <p className="excerpt">{p.excerpt}</p>}
                </article>
            ))}
        </>
    );
}
