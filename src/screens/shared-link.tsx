import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { PressConfig } from "../config.js";
import { readEnv } from "../env.js";
import { openShareLink } from "../delivery.js";
import { toPage } from "../cms.js";
import { collectionOf, toItem } from "../collections.js";
import { LINK_COOKIE, openLinkCookie, routeFromParams, samePath, shareSecret, siteFromRoute } from "../site.js";
import { createBlockRegistry, registryFor } from "../blocks/registry.js";
import type { BlockRegistry } from "../blocks/schema.js";
import { ItemView } from "./collection.js";
import { PageView } from "./page.js";

/*
 * What a link to one entry or one page opens (barakoCMS #1089).
 *
 * The redeem route seals the key into a cookie and sends the visitor to the path the link opens at.
 * The proxy sends a request for that path, from a visitor holding that cookie, here. This route asks
 * barakoCMS again on every request, with the key, and draws what it answers: the entry, whatever its
 * status, or the page. Nothing here is kept. It reads a cookie, which makes it dynamic, and that is
 * why it is a route file of its own: the catch-all is one Next keeps, and reading a cookie there
 * would fail it. A revoked or expired link is a 404 on the next request.
 *
 * Mount it under the tenant segment, with no `generateStaticParams`:
 *
 *     // app/%5Fpress/[site]/%5Flink/[[...path]]/page.tsx
 *     import { createSharedLinkPage, sharedLinkMetadata } from "barakopress";
 *     import { blocks, config } from "@/press.config";
 *
 *     export default createSharedLinkPage(config, blocks);
 *     export const metadata = sharedLinkMetadata;
 */

type LinkParams = { params: Promise<{ site?: string; path?: string[] }> };

/** Never indexed, and no address handed on: what a link opens may be a draft. */
export const sharedLinkMetadata: Metadata = {
    robots: { index: false, follow: false },
    referrer: "no-referrer",
};

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

/** The collection that renders entries of a type at a route, if this site has one. */
function collectionFor(config: PressConfig, type: string | undefined): string | undefined {
    if (!type) return undefined;
    return Object.keys(config.collections).find((key) => {
        const col = collectionOf(config, key);
        return col?.type === type && col.route !== undefined;
    });
}

export function createSharedLinkPage(base: PressConfig, registry?: BlockRegistry) {
    let blocks = registry;
    return async function SharedLinkPage({ params }: LinkParams) {
        const route = await routeFromParams(params);
        // Only the proxy sends a request here, and only with the link gate. Anything else opens nothing.
        if (!route || route.gate !== "link") notFound();
        const config = await siteFromRoute(base, route);
        const path = pathOf((await params).path);

        const link = openLinkCookie((await cookies()).get(LINK_COOKIE)?.value, route.tenant, shareSecret());
        if (!link || !samePath(link.path, path)) notFound();

        const named = config.sites?.visitorIpHeader;
        const visitorIp = named ? ((await headers()).get(named) ?? undefined) : undefined;
        const opened = await openShareLink(config, link.key, Date.now(), {
            rendererKey: readEnv().rendererKey?.trim() || undefined,
            visitorIp,
        });

        if (opened.kind === "entry") {
            const key = collectionFor(config, opened.entry.contentType);
            if (!key) notFound();
            return ItemView({ config, item: toItem(config, key, opened.entry), preview: true });
        }
        if (opened.kind === "page" && samePath(opened.path, path)) {
            blocks ??= createBlockRegistry(base);
            return PageView({ config, page: toPage(config, opened.entry), registry: registryFor(config, blocks) });
        }
        notFound();
    };
}
