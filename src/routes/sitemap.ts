import type { MetadataRoute } from "next";
import { pinnedTenant, type PressConfig, type SiteLink } from "../config.js";
import { type NavItem, flattenNavigation, getNavigation, isChromePath, isReservedPath, listPages, pageHref } from "../cms.js";
import { pageAtPath } from "../delivery.js";
import { RESERVED_AT_ROOT } from "../config.js";
import { servedUrl } from "./served-url.js";
import { listAllCollection } from "../collections.js";
import { treeItemHref } from "../tree.js";
import { notFound } from "next/navigation";
import { siteConfigOrNull } from "../site.js";

/*
 * Built from the same cached read as every other page, so it costs nothing in the steady state
 * and cannot disagree with what the site serves.
 *
 * Each collection with a route is listed, unless its `sitemap` is off, as the blog's authors and
 * categories are. An item whose SEO block says noIndex is left out: the CMS resolves that flag per
 * entry and its own sitemap honours it, so a site that ignored it here would contradict the CMS on
 * the one signal an editor set deliberately.
 *
 * Pages are the ones in the menu, since the Pages module publishes no other public list of paths,
 * less any under a reserved slug, which never render.
 *
 * A collection is paged to its end rather than asked for in one large page (#72). It used to ask for
 * `pageSizes.sitemap` entries, which defaults to a thousand, and barakoCMS answers a public list with
 * at most a hundred and no error, so every entry past the hundredth was missing and the file was
 * still valid XML with a 200 on it. `pageSizes.sitemap` is now what it reads as, the most entries one
 * collection puts in the file, and the reading is done a page at a time at whatever size the API
 * allows.
 *
 * The whole file is bounded by the sitemap standard: 50,000 URLs. Reaching it stops the file there
 * and says so, because the standard's own answer past that point is several files behind a sitemap
 * index, and a route file is where a consumer builds those with Next's `generateSitemaps`. Serving a
 * file over the limit would be serving one crawlers are entitled to ignore whole.
 */

/** The most URLs one sitemap file may hold, from sitemaps.org. */
export const SITEMAP_MAX_URLS = 50_000;

export function createSitemap(base: PressConfig) {
    return async function sitemap(): Promise<MetadataRoute.Sitemap> {
        const config = await siteConfigOrNull(base);
        // Not served while holding, session or not.
        if (!config || config.holding) notFound();

        const items: MetadataRoute.Sitemap = [];
        const home = config.site.url;
        // Home is listed first on its own, so an entry or a page that names "/" is not listed again.
        const listedUrls = new Set<string>([home]);
        // The home page takes the first slot, so the rest of the file is one URL shorter than the cap.
        const room = () => SITEMAP_MAX_URLS - 1 - items.length;
        for (const [key, col] of Object.entries(config.collections)) {
            if (col.route === undefined || col.sitemap === false) continue;
            const limit = Math.min(config.pageSizes.sitemap, room());
            if (limit <= 0) {
                sayOnce(sitemapFull(config));
                break;
            }
            try {
                const listed = await listAllCollection(config, key, { limit });
                if (listed.truncated) {
                    sayOnce(
                        limit < config.pageSizes.sitemap
                            ? sitemapFull(config)
                            : `sitemap: "${key}" for tenant "${pinnedTenant(config) ?? ""}" holds more than the ${limit} entries this site lists, so the rest are not in the sitemap`,
                    );
                }
                for (const item of listed.items) {
                    if (item.seo?.noIndex) continue;
                    // A tree's item is read where the tree links it. Any other collection's `href` is
                    // where its card sends a reader, not where the item is served.
                    const at = col.tree ? pagePart(treeItemHref(item, col.route)) : undefined;
                    // An entry with no slug has no page of its own (barakoCMS #1100), so it is not listed.
                    const path = at ?? (item.slug ? `${col.route}/${item.slug}` : undefined);
                    if (path === undefined) continue;
                    const url = servedUrl(home, path);
                    if (listedUrls.has(url)) continue;
                    listedUrls.add(url);
                    items.push({
                        url,
                        lastModified: item.date ? new Date(item.date) : undefined,
                        changeFrequency: "monthly" as const,
                        priority: 0.7,
                    });
                }
            } catch {
                // A sitemap that throws is worse than a short one: it fails the build when
                // prerendered, and serves a crawler a 500 at runtime.
            }
        }

        const pages = (await pageUrls(config, home, listedUrls, room()))
            .filter((url) => !listedUrls.has(url))
            .map((url) => ({ url, changeFrequency: "monthly" as const, priority: 0.5 }));

        if (pages.length > room()) sayOnce(sitemapFull(config));
        const all = [{ url: home, changeFrequency: "daily" as const, priority: 1 }, ...items, ...pages.slice(0, room())];
        // Next writes `url` into <loc> as it is, so a path from content with `&` or `<` would break the file.
        return all.map((e) => ({ ...e, url: escapeXml(e.url) }));
    };
}

function escapeXml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Where a page the menu does not list is served, found by asking the Pages module for its slug at the root. */
const PAGE_LOOKUPS_AT_ONCE = 10;
const PAGE_LIST_SIZE = 100;

function internalPath(href: string): string | undefined {
    const path = pagePart(href);
    if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\s]/.test(path)) return undefined;
    return path;
}

function linkPaths(links: readonly SiteLink[] | undefined): string[] {
    return (links ?? []).flatMap((l) => [internalPath(l.href), ...linkPaths(l.children)]).filter((p): p is string => p !== undefined);
}

/*
 * Every URL a page is served at: the menu, then the targets of `HeaderLinks`, then each published
 * page of the page type the menu did not list. The Pages module publishes no list of paths beyond
 * its menu, so such a page is asked for at `/slug` and listed at the path the module answers with. A
 * nested page that is not in the menu does not answer there and is left out rather than listed at a
 * URL that 404s. A page whose SEO block says noIndex, a region page and a collection's `indexPage`
 * are never listed.
 */
async function pageUrls(config: PressConfig, home: string, listed: Set<string>, room: number): Promise<string[]> {
    if (config.pages === undefined || room <= 0) return [];
    const paths: string[] = [];
    let navSlugs = new Set<string>();
    try {
        const nav = await getNavigation(config);
        navSlugs = new Set(flatSlugs(nav));
        paths.push(...flattenNavigation(nav));
    } catch {
        // A short sitemap beats a failed one.
    }
    const mount = config.pages;
    const urls = new Set<string>();
    const reserved = (p: string) => {
        const first = p.split("/").filter(Boolean)[0]?.toLowerCase();
        return first !== undefined && RESERVED_AT_ROOT.includes(first);
    };
    const keep = (p: string) => {
        if (isChromePath(config, p) || isReservedPath(config, p) || reserved(p)) return;
        urls.add(servedUrl(home, pageHref(config, p)));
    };
    paths.forEach(keep);
    // A header link is a site path. Under the mount it is a page path; elsewhere it is some other route.
    for (const p of linkPaths(config.site.headerLinks)) {
        if (mount && p.startsWith(`${mount}/`)) keep(p.slice(mount.length));
        else if (mount && p === mount) keep("/");
        else if (!mount) keep(p);
        else if (!reserved(p)) urls.add(servedUrl(home, p));
    }

    const type = config.types.page;
    if (type) {
        const slugs: string[] = [];
        try {
            for (let page = 1; slugs.length + urls.size < room; page++) {
                const res = await listPages(config, { page, pageSize: PAGE_LIST_SIZE });
                for (const p of res.pages) {
                    if (p.slug && !p.seo?.noIndex && !navSlugs.has(p.slug)) slugs.push(p.slug);
                }
                if (!res.hasNextPage || res.pages.length === 0) break;
            }
        } catch {
            // Same: what was read is listed.
        }
        for (let i = 0; i < slugs.length && urls.size < room; i += PAGE_LOOKUPS_AT_ONCE) {
            const found = await Promise.all(
                slugs.slice(i, i + PAGE_LOOKUPS_AT_ONCE).map(async (slug) => {
                    try {
                        return (await pageAtPath(config, `/${slug}`))?.path;
                    } catch {
                        return undefined;
                    }
                }),
            );
            for (const path of found) if (typeof path === "string") keep(path);
        }
    }
    return [...urls];
}

function flatSlugs(items: NavItem[]): string[] {
    return items.flatMap((i) => [i.slug, ...flatSlugs(i.children)]);
}

/*
 * Said once rather than on every render, the way a font or a preset warning is. What it names is a
 * number somebody changes once, or a site that has outgrown one file, so a line per page view would
 * only bury it.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

function sitemapFull(config: PressConfig): string {
    return `sitemap: tenant "${pinnedTenant(config) ?? ""}" fills a sitemap of ${SITEMAP_MAX_URLS} URLs, the most one file may hold, so the rest are left out. Split it with Next's generateSitemaps.`;
}

/** For tests: say every message again. */
export function forgetSitemapWarnings(): void {
    said.clear();
}

/** A path without its fragment or query, which name a place on a page and not a page. */
function pagePart(href: string | undefined): string | undefined {
    if (!href) return undefined;
    const end = [href.indexOf("#"), href.indexOf("?")].filter((i) => i >= 0);
    return end.length > 0 ? href.slice(0, Math.min(...end)) : href;
}
