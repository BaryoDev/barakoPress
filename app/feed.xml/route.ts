import { listPosts } from "@/lib/cms";

/*
 * The feed is built here rather than proxied from the CMS.
 *
 * barakoCMS serves /api/public/post/feed.xml already, and it is correct, but its item links come
 * from a server-side config template (Feeds:Paths) that has to be kept in step with this site's
 * routes by hand. Building it here means the routes have one owner. It also costs nothing: the
 * post list is the same cached, tagged read the home page uses, so generating the feed does not
 * touch the database either.
 */

const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const siteName = process.env.SITE_NAME ?? "barakoPress";
const tagline = process.env.SITE_TAGLINE ?? "A blog on barakoCMS";

/** XML text escaping. Every value below is content someone typed, so none of it is trusted. */
function xml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export async function GET() {
    const { posts } = await listPosts({ pageSize: 50 });

    const items = posts
        .map((p) => {
            const url = `${siteUrl}/blog/${p.slug}`;
            const date = p.publishedAt ? new Date(p.publishedAt) : null;
            const pubDate =
                date && !Number.isNaN(date.getTime()) ? `<pubDate>${date.toUTCString()}</pubDate>` : "";
            // Description is plain text, not rendered HTML: a feed reader that trusts markup is
            // not this site's problem to create.
            const description = p.excerpt ?? "";
            return [
                "    <item>",
                `      <title>${xml(p.title)}</title>`,
                `      <link>${xml(url)}</link>`,
                `      <guid isPermaLink="true">${xml(url)}</guid>`,
                description ? `      <description>${xml(description)}</description>` : "",
                pubDate ? `      ${pubDate}` : "",
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
    <title>${xml(siteName)}</title>
    <link>${xml(siteUrl)}</link>
    <description>${xml(tagline)}</description>
    <atom:link href="${xml(`${siteUrl}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;

    return new Response(body, {
        headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            // Safe to cache at the edge: a publish drops the tag, this route re-renders, and the
            // next reader gets the new one.
            "cache-control": "public, max-age=300",
        },
    });
}
