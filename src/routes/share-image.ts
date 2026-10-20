import { readFile } from "node:fs/promises";
import type { PressConfig } from "../config.js";
import { getPageByPath } from "../cms.js";
import { readEnv } from "../env.js";
import { siteConfigOrNull } from "../site.js";

/*
 * A 1200 by 630 share image drawn from a page's title and the site's name, with a font the
 * consumer supplies (`PRESS_SHARE_IMAGE_FONT`, see share-image.ts). Not configured, or the font
 * cannot be read, it answers 404 and the page's tags are unchanged.
 *
 * The title is read from the page at `?path=`, never from the query, so the route cannot be made to
 * print text a site did not publish.
 */

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const MAX_TITLE = 140;

const fonts = new Map<string, Promise<ArrayBuffer>>();

/** The font file's bytes, read once per path. A failed read is not kept, so a fixed file works without a restart. */
export function loadFont(path: string): Promise<ArrayBuffer> {
    let font = fonts.get(path);
    if (!font) {
        font = readFile(path).then((buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
        fonts.set(path, font);
        font.catch(() => fonts.delete(path));
    }
    return font;
}

/** The title as drawn: one line of text, cut short with an ellipsis. */
export function shareTitle(title: string): string {
    const flat = title.replace(/\s+/g, " ").trim();
    return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1).trimEnd()}…` : flat;
}

export function createShareImage(base: PressConfig) {
    return async function GET(request: Request) {
        const fontPath = readEnv().shareImageFont;
        if (!fontPath) return new Response("Not found", { status: 404 });
        const config = await siteConfigOrNull(base);
        if (!config || config.holding) return new Response("Not found", { status: 404 });

        const path = new URL(request.url).searchParams.get("path");
        if (!path || !path.startsWith("/")) return new Response("Not found", { status: 404 });
        const found = await getPageByPath(config, path).catch(() => null);
        if (!found) return new Response("Not found", { status: 404 });

        let font: ArrayBuffer;
        try {
            font = await loadFont(fontPath);
        } catch {
            console.warn("share image: the font named by PRESS_SHARE_IMAGE_FONT could not be read");
            return new Response("Not found", { status: 404 });
        }

        const { ImageResponse } = await import("next/og");
        return new ImageResponse(
            {
                type: "div",
                props: {
                    style: {
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        padding: 80,
                        background: "#ffffff",
                        color: "#111111",
                        fontFamily: "Press",
                    },
                    children: [
                        { type: "div", props: { style: { fontSize: 72, lineHeight: 1.15, display: "flex" }, children: shareTitle(found.page.title) } },
                        { type: "div", props: { style: { fontSize: 36, display: "flex" }, children: config.site.name } },
                    ],
                },
                key: null,
            },
            { ...SHARE_IMAGE_SIZE, fonts: [{ name: "Press", data: font, weight: 400, style: "normal" }] },
        );
    };
}
