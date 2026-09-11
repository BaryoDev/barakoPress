import type { MetadataRoute } from "next";

/*
 * Generated rather than a static file, because the sitemap line has to be an absolute URL and the
 * domain is per deployment. A relative Sitemap: is ignored.
 */
const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
