import { notFound, permanentRedirect, redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import type { PressConfig } from "../config.js";
import {
    flattenNavigation,
    getNavigation,
    getPage,
    getPageByPath,
    getRedirect,
    isReservedPath,
    listPages,
    pageHref,
    type Breadcrumb,
    type Page,
} from "../cms.js";
import { renderMarkdown } from "../markdown.js";
import { proseCss } from "../theme.js";
import { siteConfig } from "../site.js";
import { BLOCK_PROSE_CLASS } from "../blocks/built-in.js";
import { BlockList } from "../blocks/render.js";
import { createBlockRegistry } from "../blocks/registry.js";
import { resolveBlocks, type BlockRegistry } from "../blocks/schema.js";
import { Breadcrumbs } from "./navigation.js";

/*
 * Two route shapes reach these factories. `app/[slug]/page.tsx` passes a slug, read from the page type
 * by slug. A catch-all under the `pages` mount (`app/[[...path]]/page.tsx` at the root) passes path
 * segments, resolved by the Pages module, which is the only thing that knows which page lives at
 * /about/team.
 */
type PageRouteParams = { slug?: string; path?: string[] };
type PageParams = { params: Promise<PageRouteParams> };

export interface PageViewProps {
    config: PressConfig;
    page: Page;
    registry: BlockRegistry;
    /** Render blocks marked `perViewer`. Only true where the output is never cached. */
    perViewer?: boolean;
    showTitle?: boolean;
    /** From the Pages module, root first. Drawn above the title when the page has a parent. */
    breadcrumbs?: Breadcrumb[];
}

/*
 * A page is its blocks when it has any, and its markdown body otherwise. The fallback is what keeps
 * a blueprint page, which has a Body and no Blocks field until one is added, rendering unchanged.
 */
export function PageView({ config, page, registry, perViewer = false, showTitle = true, breadcrumbs = [] }: PageViewProps) {
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
                {breadcrumbs.length > 1 && (
                    <div style={{ marginBottom: "20px" }}>
                        <Breadcrumbs config={config} items={breadcrumbs} />
                    </div>
                )}
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

const bySlugRoute = (p: PageRouteParams) => p.slug !== undefined && p.path === undefined;

/** The path the catch-all segments name, relative to the mount. */
function pathOf(segments: string[] | undefined): string {
    const parts = (segments ?? []).map((segment) => {
        try {
            return decodeURIComponent(segment);
        } catch {
            return segment;
        }
    });
    return `/${parts.join("/")}`;
}

interface Found {
    page: Page;
    breadcrumbs: Breadcrumb[];
}

async function findPage(config: PressConfig, p: PageRouteParams): Promise<Found | null> {
    if (bySlugRoute(p)) {
        const page = await getPage(config, p.slug as string);
        return page ? { page, breadcrumbs: [] } : null;
    }
    if (config.pages === undefined) return null;
    const path = pathOf(p.path);
    // A page under a reserved slug renders nowhere, not only where Next happens to leave a gap in the
    // app's routes, so it is not asked for.
    if (isReservedPath(config, path)) return null;
    const found = await getPageByPath(config, path);
    return found ? { page: found.page, breadcrumbs: found.breadcrumbs } : null;
}

/*
 * A miss on the catch-all asks the redirects map before it is a 404, because a catch-all is where a
 * rebuilt site's old URLs arrive. A slug route knows no site path to ask about, so it 404s directly.
 */
async function missing(config: PressConfig, p: PageRouteParams): Promise<never> {
    if (config.pages !== undefined && !bySlugRoute(p)) {
        let target = null;
        try {
            target = await getRedirect(config, pageHref(config, pathOf(p.path)));
        } catch (e) {
            if (e && typeof e === "object" && "digest" in e) throw e;
        }
        if (target) (target.permanent ? permanentRedirect : redirect)(target.to);
    }
    notFound();
}

/*
 * The page route, in two shapes, for the same reason the post route has two.
 *
 * `createPage` output is shared by every visitor: prerendered, cached, purged by the webhook. So
 * it leaves out any block marked `perViewer`, because rendering one there would put one visitor's
 * view into everyone's cache. `createViewerPage` calls `connection()` first, which makes the route
 * dynamic whatever its segment config says, and then renders every block. A site mounts the second
 * only where a page holds such a block, and gives up caching for that route.
 *
 * Without a registry, both render with the built-in blocks.
 */
export function createPage(base: PressConfig, registry?: BlockRegistry) {
    let blocks = registry;
    return async function BlockPage({ params }: PageParams) {
        const config = await siteConfig(base);
        const p = await params;
        const found = await findPage(config, p);
        if (!found) return missing(config, p);
        blocks ??= createBlockRegistry(base);
        return <PageView config={config} page={found.page} breadcrumbs={found.breadcrumbs} registry={blocks} />;
    };
}

export function createViewerPage(base: PressConfig, registry?: BlockRegistry) {
    let blocks = registry;
    return async function ViewerPage({ params }: PageParams) {
        await connection();
        const config = await siteConfig(base);
        const p = await params;
        const found = await findPage(config, p);
        if (!found) return missing(config, p);
        blocks ??= createBlockRegistry(base);
        return (
            <PageView config={config} page={found.page} breadcrumbs={found.breadcrumbs} registry={blocks} perViewer />
        );
    };
}

export function createPageMetadata(base: PressConfig) {
    return async function generateMetadata({ params }: PageParams): Promise<Metadata> {
        const config = await siteConfig(base);
        const found = await findPage(config, await params);
        if (!found) return { title: "Not found" };

        const page = found.page;
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

/*
 * Params for a static export. With `pages` set they are the catch-all's path segments for every page
 * in the menu, because the Pages module publishes no other public list of paths; a page outside the
 * menu renders on request. Without it they are slugs from the page type, paged to the end.
 */
export function createPageStaticParams(config: PressConfig) {
    return async function generateStaticParams(): Promise<{ slug: string }[] | { path: string[] }[]> {
        if (config.sites) return [];
        if (config.pages !== undefined) return pathParams(config);

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

async function pathParams(config: PressConfig): Promise<{ path: string[] }[]> {
    let paths: string[];
    try {
        paths = flattenNavigation(await getNavigation(config));
    } catch {
        return [];
    }
    const params: { path: string[] }[] = [];
    for (const path of paths) {
        if (isReservedPath(config, path)) {
            console.warn(`pages: the page at ${path} is under a reserved slug and is never rendered`);
            continue;
        }
        params.push({ path: path.split("/").filter(Boolean) });
    }
    return params;
}
