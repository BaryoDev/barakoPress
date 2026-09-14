import Link from "next/link";
import { notFound } from "next/navigation";
import type { PressConfig } from "../config.js";
import { getTerm, listPostsBy, type Post } from "../cms.js";
import { renderMarkdown } from "../markdown.js";
import { siteConfig } from "../site.js";
import { Card } from "./blog-index.js";

type SlugParams = { params: Promise<{ slug: string }> };

/*
 * Posts by author, or by category.
 *
 * One screen for both, because they differ only in which type is resolved and which reference is
 * filtered on, and both of those are in the config. A site with no author type simply never
 * mounts the route; the factory still refuses cleanly if it is mounted anyway.
 */
export function createArchive(base: PressConfig, which: "author" | "category") {
    return async function ArchivePage({ params }: SlugParams) {
        if (!base.types[which]) notFound();
        const config = await siteConfig(base);

        const { slug } = await params;
        const [term, posts] = await Promise.all([
            getTerm(config, which, slug),
            listPostsBy(config, which, slug),
        ]);
        if (!term || !posts) notFound();

        return (
            <div className="shell">
                <p className="meta">
                    <Link href="/">Back</Link>
                </p>
                <h1>{term.name}</h1>

                {term.description && (
                    <div
                        className="prose"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(term.description) }}
                    />
                )}

                {which === "author" && term.website && (
                    <p className="meta">
                        <a href={term.website} rel="noopener noreferrer">
                            {term.website}
                        </a>
                    </p>
                )}

                <h2 style={{ marginTop: "2.5rem" }}>
                    {posts.length} {posts.length === 1 ? "post" : "posts"}
                </h2>

                {posts.map((p: Post) => (
                    <Card key={p.id} config={config} post={p} />
                ))}
            </div>
        );
    };
}

/** Slugs for a static export of an archive route. */
export function createArchiveStaticParams(config: PressConfig, which: "author" | "category") {
    return async function generateStaticParams(): Promise<{ slug: string }[]> {
        const type = config.types[which];
        if (!type || config.sites) return [];

        const { list } = await import("../delivery.js");
        try {
            const res = await list(config, type, { pageSize: 100 });
            return res.items
                .map((c) => c.slug ?? "")
                .filter(Boolean)
                .map((slug) => ({ slug }));
        } catch {
            return [];
        }
    };
}
