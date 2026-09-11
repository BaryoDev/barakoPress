import type { MetadataRoute } from "next";
import type { PressConfig } from "../config";

/*
 * Generated, because the Sitemap line has to be an absolute URL and the domain is per deployment.
 * A relative Sitemap: is ignored.
 *
 * The URL comes from config rather than process.env read at module scope. That distinction is the
 * whole bug it fixes: this route is prerendered at build, so an env read baked the build
 * machine's value in permanently, and production advertised a localhost sitemap that no cache
 * purge could ever correct.
 */
export function createRobots(config: PressConfig) {
    return function robots(): MetadataRoute.Robots {
        return {
            rules: { userAgent: "*", allow: "/" },
            sitemap: `${config.site.url}/sitemap.xml`,
        };
    };
}
