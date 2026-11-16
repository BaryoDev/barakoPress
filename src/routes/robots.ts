import type { MetadataRoute } from "next";
import { siteBaseUrl, withBase } from "../base-path.js";
import type { PressConfig } from "../config.js";
import { notFound } from "next/navigation";
import { siteConfigOrNull } from "../site.js";

/*
 * Generated, because the Sitemap line has to be an absolute URL and the domain is per deployment.
 * A relative Sitemap: is ignored.
 *
 * The URL comes from config rather than the environment read at module scope. That distinction is the
 * whole bug it fixes: this route is prerendered at build, so an env read baked the build
 * machine's value in permanently, and production advertised a localhost sitemap that no cache
 * purge could ever correct.
 */
const prefixed = (paths: string[]) => paths.map((p) => withBase(p));

export function createRobots(base: PressConfig) {
    return async function robots(): Promise<MetadataRoute.Robots> {
        const config = await siteConfigOrNull(base);
        if (!config) notFound();
        // Reachable while holding, but asking for nothing to be crawled and naming no sitemap.
        if (config.holding) return { rules: { userAgent: "*", disallow: withBase("/") } };
        return {
            rules: {
                userAgent: "*",
                allow: withBase("/"),
                ...(config.robots ? { disallow: prefixed(config.robots.disallow) } : {}),
            },
            sitemap: `${siteBaseUrl(config.site.url)}/sitemap.xml`,
        };
    };
}
