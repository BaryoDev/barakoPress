import type { PressConfig } from "../config.js";
import { listPosts } from "../cms.js";
import { siteConfigOrNull } from "../site.js";

/*
 * RSS, built here rather than proxied from the CMS.
 *
 * barakoCMS serves /api/public/{type}/feed.xml and it is correct, but its item links come from a
 * server-side config template that has to be kept in step with the site's routes by hand. Built
 * here, the routes have one owner: config.routes. It also costs nothing, because it is the same
 * cached, tagged read the index uses.
 */

/** XML text escaping. Every value below is content someone typed, so none of it is trusted. */
function xml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export function createFeed(base: PressConfig) {
    return async function GET() {
        // Outside the try below: resolving reads the request, and Next signals that with a throw.
        const config = await siteConfigOrNull(base);
        // Not served while holding, to anyone, session or not: a feed is public and cached in front of the site.
        if (!config || config.holding) return new Response("Not found", { status: 404 });

        let posts: Awaited<ReturnType<typeof listPosts>>["posts"] = [];
        try {
            ({ posts } = await listPosts(config, { pageSize: config.pageSizes.feed }));
        } catch {
            // An unreachable CMS yields an empty channel, not a failure. This route is prerendered
            // when the consumer gives it a revalidate window, so a throw fails their build, and at
            // runtime it would hand a feed reader a 500.
            posts = [];
        }

        const items = posts
            .map((p) => {
                const url = `${config.site.url}${config.routes.post}/${p.slug}`;
                const date = p.publishedAt ? new Date(p.publishedAt) : null;
                const pubDate =
                    date && !Number.isNaN(date.getTime())
                        ? `      <pubDate>${date.toUTCString()}</pubDate>`
                        : "";
                return [
                    "    <item>",
                    `      <title>${xml(p.title)}</title>`,
                    `      <link>${xml(url)}</link>`,
                    `      <guid isPermaLink="true">${xml(url)}</guid>`,
                    // Plain text, not rendered HTML: a feed reader that trusts markup is not this
                    // site's problem to create.
                    p.excerpt ? `      <description>${xml(p.excerpt)}</description>` : "",
                    pubDate,
                    p.category ? `      <category>${xml(p.category.name)}</category>` : "",
                    "    </item>",
                ]
                    .filter(Boolean)
                    .join("\n");
            })
            .join("\n");

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(config.site.name)}</title>
    <link>${xml(config.site.url)}</link>
    <description>${xml(config.site.tagline ?? config.site.name)}</description>
    <atom:link href="${xml(`${config.site.url}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

        return new Response(body, {
            headers: {
                "content-type": "application/rss+xml; charset=utf-8",
                "cache-control": "public, max-age=300",
            },
        });
    };
}
