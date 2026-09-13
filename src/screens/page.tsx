import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import type { PressConfig } from "../config.js";
import { getPage, listPages, type Page } from "../cms.js";
import { renderMarkdown } from "../markdown.js";
import { proseCss } from "../theme.js";
import { BLOCK_PROSE_CLASS } from "../blocks/built-in.js";
import { BlockList } from "../blocks/render.js";
import { resolveBlocks, type BlockRegistry } from "../blocks/schema.js";

type SlugParams = { params: Promise<{ slug: string }> };

export interface PageViewProps {
    config: PressConfig;
    page: Page;
    registry: BlockRegistry;
    /** Render blocks marked `perViewer`. Only true where the output is never cached. */
    perViewer?: boolean;
    showTitle?: boolean;
}

/*
 * A page is its blocks when it has any, and its markdown body otherwise. The fallback is what keeps
 * a blueprint page, which has a Body and no Blocks field until one is added, rendering unchanged.
 */
export function PageView({ config, page, registry, perViewer = false, showTitle = true }: PageViewProps) {
    const t = config.theme;
    const hasBlocks = Array.isArray(page.blocks) && page.blocks.length > 0;
    const blocks = hasBlocks ? resolveBlocks(page.blocks, registry, { perViewer }) : [];

    return (
        <div style={{ background: t.colors.pageBg, color: t.colors.ink, fontFamily: t.fonts.body }}>
            <style dangerouslySetInnerHTML={{ __html: proseCss(t, BLOCK_PROSE_CLASS) }} />
            <main
                style={{
                    maxWidth: t.layout.wide,
                    margin: "0 auto",
                    padding: `56px ${t.layout.gutter} 80px`,
                }}
            >
                {showTitle && (
                    <h1
                        style={{
                            margin: "0 0 40px",
                            fontFamily: t.fonts.heading,
                            fontWeight: 600,
                            fontSize: "clamp(32px, 4.4vw, 52px)",
                            lineHeight: 1.08,
                            letterSpacing: "-.035em",
                        }}
                    >
                        {page.title}
                    </h1>
                )}
                {hasBlocks ? (
                    <BlockList blocks={blocks} theme={t} />
                ) : (
                    page.body && (
                        <div
                            className={BLOCK_PROSE_CLASS}
                            style={{ maxWidth: t.layout.prose }}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }}
                        />
                    )
                )}
            </main>
        </div>
    );
}

/*
 * The page route, in two shapes, for the same reason the post route has two.
 *
 * `createPage` output is shared by every visitor: prerendered, cached, purged by the webhook. So
 * it leaves out any block marked `perViewer`, because rendering one there would put one visitor's
 * view into everyone's cache. `createViewerPage` calls `connection()` first, which makes the route
 * dynamic whatever its segment config says, and then renders every block. A site mounts the second
 * only where a page holds such a block, and gives up caching for that route.
 */
export function createPage(config: PressConfig, registry: BlockRegistry) {
    return async function BlockPage({ params }: SlugParams) {
        const { slug } = await params;
        const page = await getPage(config, slug);
        if (!page) notFound();
        return <PageView config={config} page={page} registry={registry} />;
    };
}

export function createViewerPage(config: PressConfig, registry: BlockRegistry) {
    return async function ViewerPage({ params }: SlugParams) {
        await connection();
        const { slug } = await params;
        const page = await getPage(config, slug);
        if (!page) notFound();
        return <PageView config={config} page={page} registry={registry} perViewer />;
    };
}

export function createPageMetadata(config: PressConfig) {
    return async function generateMetadata({ params }: SlugParams): Promise<Metadata> {
        const { slug } = await params;
        const page = await getPage(config, slug);
        if (!page) return { title: "Not found" };

        const seo = page.seo;
        const title = seo?.title ?? page.title;
        const description = seo?.description ?? page.summary;
        return {
            title,
            description,
            alternates: seo?.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
            robots: seo?.noIndex ? { index: false, follow: false } : undefined,
            openGraph: { title, description, images: seo?.imageUrl ? [seo.imageUrl] : undefined },
        };
    };
}

/** Slugs for a static export, paged to the end. Empty with no CMS reachable, like the post one. */
export function createPageStaticParams(config: PressConfig) {
    return async function generateStaticParams(): Promise<{ slug: string }[]> {
        const slugs: { slug: string }[] = [];
        // No page cap: a static export has no fallback, so a slug not listed here is a 404. The
        // loop ends on the API's hasNextPage, or on an empty page if that were ever wrong.
        for (let page = 1; ; page++) {
            let batch;
            try {
                batch = await listPages(config, { page, pageSize: 100 });
            } catch {
                break;
            }
            for (const p of batch.pages) if (p.slug) slugs.push({ slug: p.slug });
            if (!batch.hasNextPage || batch.pages.length === 0) break;
        }
        return slugs;
    };
}
