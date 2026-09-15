import { POST_COLLECTION, type PressConfig } from "../config.js";
import { collectionOf, listCollection, type Item } from "../collections.js";
import { siteConfigOrNull, tenantVary } from "../site.js";

/*
 * RSS, built here rather than proxied from the CMS.
 *
 * barakoCMS serves /api/public/{type}/feed.xml and it is correct, but its item links come from a
 * server-side config template that has to be kept in step with the site's routes by hand. Built
 * here, the routes have one owner: the collection's route. It also costs nothing, because it is the
 * same cached, tagged read the index uses.
 *
 * The posts by default; `createFeed(config, key)` serves any collection whose `feed` is on.
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

export function createFeed(base: PressConfig, collection: string = POST_COLLECTION) {
    return async function GET() {
        // Outside the try below: resolving reads the request, and Next signals that with a throw.
        const config = await siteConfigOrNull(base);
        // Not served while holding, to anyone, session or not: a feed is public and cached in front of the site.
        if (!config || config.holding) return new Response("Not found", { status: 404 });
        const col = collectionOf(config, collection);
        if (!col?.feed) return new Response("Not found", { status: 404 });

        let items: Item[] = [];
        try {
            ({ items } = await listCollection(config, collection, { pageSize: config.pageSizes.feed }));
        } catch {
            // An unreachable CMS yields an empty channel, not a failure. This route is prerendered
            // when the consumer gives it a revalidate window, so a throw fails their build, and at
            // runtime it would hand a feed reader a 500.
            items = [];
        }

        const categories = Object.entries(col.references ?? {})
            .filter(([, ref]) => ref.inFeed)
            .map(([field]) => field);

        const entries = items
            .map((item) => {
                const url = `${config.site.url}${col.route ?? ""}/${item.slug}`;
                const date = item.date ? new Date(item.date) : null;
                const pubDate =
                    date && !Number.isNaN(date.getTime())
                        ? `      <pubDate>${date.toUTCString()}</pubDate>`
                        : "";
                return [
                    "    <item>",
                    `      <title>${xml(item.title)}</title>`,
                    `      <link>${xml(url)}</link>`,
                    `      <guid isPermaLink="true">${xml(url)}</guid>`,
                    // Plain text, not rendered HTML: a feed reader that trusts markup is not this
                    // site's problem to create.
                    item.summary ? `      <description>${xml(item.summary)}</description>` : "",
                    pubDate,
                    ...categories.map((field) => {
                        const ref = item.refs[field];
                        return ref ? `      <category>${xml(ref.name)}</category>` : "";
                    }),
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
${entries}
  </channel>
</rss>
`;

        const headers = new Headers({
            "content-type": "application/rss+xml; charset=utf-8",
            "cache-control": "public, max-age=300",
        });
        // The URL names the host, but not a tenant picked by a header, so a shared cache has to key on it.
        const vary = tenantVary(config);
        if (vary) headers.set("vary", vary);
        return new Response(body, { headers });
    };
}
