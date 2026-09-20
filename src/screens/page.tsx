import { notFound, permanentRedirect, redirect } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { POST_COLLECTION, type PressConfig } from "../config.js";
import {
    flattenNavigation,
    getNavigation,
    getPage,
    getPageByPath,
    getPageAtPath,
    getRedirect,
    isReservedPath,
    listPages,
    pageHref,
    type Breadcrumb,
    type Page,
} from "../cms.js";
import { renderProse } from "../assets.js";
import { proseCss } from "../theme.js";
import { BLOCK_PROSE_CLASS } from "../blocks/built-in.js";
import { BlockList } from "../blocks/render.js";
import { createBlockRegistry, registryFor } from "../blocks/registry.js";
import { resolveBlocks, type BlockRegistry, type ResolvedBlock } from "../blocks/schema.js";
import { bindBlocks, pageScope, queryScope, siteScope } from "../blocks/bind.js";
import { getGlobals, routeFromParams, siteConfig } from "../site.js";
import { collectionAt, collectionOf, getItem } from "../collections.js";
import { CollectionIndexView, itemMetadata, renderCollectionDetail } from "./collection.js";
import { Breadcrumbs } from "./navigation.js";

/*
 * Two route shapes reach these factories. `app/[slug]/page.tsx` passes a slug, read from the page type
 * by slug. A catch-all under the `pages` mount (`app/[[...path]]/page.tsx` at the root) passes path
 * segments, resolved by the Pages module, which is the only thing that knows which page lives at
 * /about/team.
 */
type PageRouteParams = { slug?: string; path?: string[]; site?: string };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
/*
 * `searchParams` is taken but never awaited unless a block binds `{{query.X}}`. Awaiting it is what
 * makes a route dynamic, and `output: "export"` refuses a build outright over it, so a static site
 * with no query binding is unaffected by this existing.
 */
type PageParams = { params: Promise<PageRouteParams>; searchParams?: SearchParams };

export interface PageViewProps {
    config: PressConfig;
    page: Page;
    registry: BlockRegistry;
    /** Render blocks marked `perViewer`. Only true where the output is never cached. */
    perViewer?: boolean;
    showTitle?: boolean;
    /** From the Pages module, root first. Drawn above the title when the page has a parent. */
    breadcrumbs?: Breadcrumb[];
    /** The request's URL parameters, for `{{query.X}}`. Awaited only if a block asks for one. */
    searchParams?: SearchParams;
}

/**
 * A page's blocks: resolved against the registry, then bound and expanded.
 *
 * Every scope is a thunk, so a page that binds nothing reads nothing. That matters for `site`,
 * which is a CMS read, and for `query`, which makes the route dynamic.
 */
export async function pageBlocks(
    config: PressConfig,
    page: Page,
    registry: BlockRegistry,
    options: { perViewer?: boolean; searchParams?: SearchParams } = {},
): Promise<ResolvedBlock[]> {
    if (!Array.isArray(page.blocks) || page.blocks.length === 0) return [];
    const blocks = resolveBlocks(page.blocks, registry, { perViewer: options.perViewer === true });
    return bindBlocks(blocks, {
        config,
        registry,
        scopes: {
            site: async () => siteScope(config, await getGlobals(config)),
            page: () => pageScope(page),
            ...(options.searchParams ? { query: async () => queryScope(await options.searchParams!) } : {}),
        },
        // Reported, never thrown, and never shown to a visitor: a renamed field is something the
        // person editing the page has to see, and nothing a reader can act on. Where they see it is
        // barakoBrew, over `createBindingReportRoute`; this line is for whoever has the log.
        onProblem: (problem) =>
            console.warn(
                `blocks: ${problem.binding} on page "${page.slug || page.id}" is ${problem.reason}` +
                    (problem.block ? ` (${problem.block}.${problem.field})` : ""),
            ),
    });
}

/*
 * A page is its blocks when it has any, and its markdown body otherwise. The fallback is what keeps
 * a blueprint page, which has a Body and no Blocks field until one is added, rendering unchanged.
 */
export async function PageView({
    config,
    page,
    registry,
    perViewer = false,
    showTitle = true,
    breadcrumbs = [],
    searchParams,
}: PageViewProps) {
    const t = config.theme;
    const hasBlocks = Array.isArray(page.blocks) && page.blocks.length > 0;
    const blocks = await pageBlocks(config, page, registry, { perViewer, searchParams });

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
                            fontSize: t.text.pageTitle,
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
                            dangerouslySetInnerHTML={{ __html: renderProse(page.body, t) }}
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

/*
 * At the root, the catch-all also serves every collection with a route: its index at the route and an
 * item one segment below. That is how a tenant's collections, which come from its settings, render with
 * no route file each. A route file for a collection still wins, since Next resolves it first.
 */
function collectionHit(config: PressConfig, p: PageRouteParams): { key: string; slug?: string } | null {
    if (bySlugRoute(p) || (config.pages ?? "") !== "") return null;
    return collectionAt(config, pathOf(p.path));
}

async function collectionMetadata(config: PressConfig, hit: { key: string; slug?: string }): Promise<Metadata> {
    if (hit.slug === undefined) {
        const label = collectionOf(config, hit.key)?.label;
        return label ? { title: label } : {};
    }
    const item = await getItem(config, hit.key, hit.slug);
    return item ? itemMetadata(item) : { title: "Not found" };
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
/*
 * `{{query.X}}` and the render cache (barakoPress #55).
 *
 * Awaiting the query is what makes a route dynamic, and a route that exports `generateStaticParams`
 * is one Next has been told to keep: asking there is not a bail-out to a dynamic render, it fails
 * the route, and catching the throw does not help because Next records the usage either way. So a
 * page served through a rewritten path is not handed the query at all, and a binding for it is
 * reported as an unbound scope and renders as nothing, the same as any other binding that cannot be
 * resolved.
 *
 * A site that wants query bindings says so, in the route file that would carry
 * `generateStaticParams` and now does not:
 *
 *     export default createPage(config, blocks, { query: true });
 *
 * which is the same division as `revalidate`: whether a route may be kept is the consumer's call,
 * made in the consumer's file.
 */
export interface PageOptions {
    /** Hand blocks the request's query. The route must then be dynamic: no `generateStaticParams`. */
    query?: boolean;
}

export function createPage(base: PressConfig, registry?: BlockRegistry, options: PageOptions = {}) {
    let blocks = registry;
    return async function BlockPage({ params, searchParams }: PageParams) {
        const config = await siteConfig(base, params);
        const p = await params;
        const query = options.query ?? (await routeFromParams(params)) === null;
        const hit = collectionHit(config, p);
        if (hit) {
            return hit.slug === undefined
                ? CollectionIndexView({ config, collection: hit.key })
                : renderCollectionDetail(config, hit.key, hit.slug);
        }
        const found = await findPage(config, p);
        if (!found) return missing(config, p);
        blocks ??= createBlockRegistry(base);
        return PageView({
            config,
            page: found.page,
            breadcrumbs: found.breadcrumbs,
            registry: registryFor(config, blocks),
            searchParams: query ? searchParams : undefined,
        });
    };
}

export function createViewerPage(base: PressConfig, registry?: BlockRegistry) {
    let blocks = registry;
    return async function ViewerPage({ params, searchParams }: PageParams) {
        await connection();
        const config = await siteConfig(base, params);
        const p = await params;
        const hit = collectionHit(config, p);
        if (hit) {
            return hit.slug === undefined
                ? CollectionIndexView({ config, collection: hit.key })
                : renderCollectionDetail(config, hit.key, hit.slug);
        }
        const found = await findPage(config, p);
        if (!found) return missing(config, p);
        blocks ??= createBlockRegistry(base);
        return PageView({
            config,
            page: found.page,
            breadcrumbs: found.breadcrumbs,
            registry: registryFor(config, blocks),
            searchParams,
            perViewer: true,
        });
    };
}

/*
 * The home page (barakoPress #44).
 *
 * The root used to be the post index for every site, because that is what the route file mounted and
 * nothing else could be named. A tenant picks it now: `HomePath` is a page, `HomeCollection` is a
 * collection's index, and neither is the post index, so a site that says nothing renders what it
 * always did.
 *
 * Nothing served at the named path falls back to the index rather than 404ing the front page. That
 * is the same call `HoldingPath` makes, and for the same reason: naming a page before writing it
 * should leave the site standing.
 */
async function homePage(config: PressConfig, path: string): Promise<Page | null> {
    try {
        return await getPageAtPath(config, path);
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`home: the page at ${path} could not be read (${why})`);
        return null;
    }
}

/** The collection the root lists: the one the tenant named, else the posts. */
function homeCollection(config: PressConfig): string {
    const named = config.home?.collection;
    return named && collectionOf(config, named) ? named : POST_COLLECTION;
}

export function createHome(base: PressConfig, registry?: BlockRegistry, options: PageOptions = {}) {
    let blocks = registry;
    return async function Home({ params, searchParams }: PageParams) {
        const config = await siteConfig(base, params);
        const path = config.home?.path;
        const page = path ? await homePage(config, path) : null;
        if (page) {
            const query = options.query ?? (await routeFromParams(params)) === null;
            blocks ??= createBlockRegistry(base);
            return PageView({
                config,
                page,
                registry: registryFor(config, blocks),
                searchParams: query ? searchParams : undefined,
            });
        }
        return CollectionIndexView({ config, collection: homeCollection(config) });
    };
}

/** The home page's metadata: the page the tenant named, else whatever the layout already says. */
export function createHomeMetadata(base: PressConfig) {
    return async function generateMetadata({ params }: PageParams): Promise<Metadata> {
        const config = await siteConfig(base, params);
        const path = config.home?.path;
        const page = path ? await homePage(config, path) : null;
        if (!page) {
            const label = collectionOf(config, homeCollection(config))?.label;
            return label ? { title: label } : {};
        }
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

export function createPageMetadata(base: PressConfig) {
    return async function generateMetadata({ params }: PageParams): Promise<Metadata> {
        const config = await siteConfig(base, params);
        const p = await params;
        const hit = collectionHit(config, p);
        if (hit) return collectionMetadata(config, hit);
        const found = await findPage(config, p);
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

/**
 * No paths at build for a request-time site: the tenant is named by a request, not by the build.
 *
 * A page route still exports one, because that is how Next is told a route with a dynamic segment
 * may be rendered on demand and then kept. Without it the route is dynamic and every visitor pays
 * for a render of their own (barakoPress #55).
 */
export function createSiteStaticParams() {
    return async function generateStaticParams(): Promise<Record<string, never>[]> {
        return [];
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
