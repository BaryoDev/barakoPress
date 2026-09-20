import type { CSSProperties, ReactNode } from "react";
import { renderMarkdown, type RenderMarkdownOptions } from "./markdown.js";
import { spaceOf, SPACES } from "./blocks/tokens.js";
import type { PressTheme, SuppliedAsset } from "./theme.js";

/*
 * Assets used exactly as supplied (barakoPress #29).
 *
 * Some marks arrive with an identity manual: never recoloured, never outlined, never put in a box,
 * never crowded. A renderer that rounds a corner or drops a logo into a tinted panel breaks that
 * without anyone noticing, because on screen it looks like a nice touch.
 *
 * So an asset can be marked as used as supplied. The file is drawn as it is, a minimum clear space
 * is held around it, and nothing the theme or a block asks for reaches it: no tint, no border, no
 * corner, no shadow, no filter, no crop. A block that wanted to frame it draws the mark alone.
 *
 * Two decisions worth stating.
 *
 * The list lives on the theme, next to the tokens, because the theme is the one thing every drawing
 * path already carries: a block component is handed its props, its slots and the theme, and nothing
 * else. A list a block cannot see is a rule that is silently not kept in blocks. Read it as the part
 * of the theme that says what the theme may not touch.
 *
 * The rule is kept in one place, `Asset`, rather than at each `<img>`. A rule enforced in four
 * places is a rule forgotten in the fifth, and the forgetting is invisible. `assets.test.tsx` walks
 * every path an image is drawn through and fails if a new `<img` appears outside this file.
 */

/** The clear space a marked asset gets when it names none. A name from the theme's spacing scale. */
export const DEFAULT_CLEAR_SPACE = "md";

/**
 * Everything the theme could do to a mark, turned off.
 *
 * Longhand where a shorthand would leave part of the property alone, and written once so the
 * component path and the markdown path cannot come to mean different things.
 */
export const NO_TREATMENT: CSSProperties = {
    background: "none",
    border: "0",
    borderRadius: "0",
    boxShadow: "none",
    outline: "none",
    filter: "none",
    backdropFilter: "none",
    mixBlendMode: "normal",
    opacity: "1",
    clipPath: "none",
    maskImage: "none",
    // Sizing is allowed, cropping is not: with both dimensions set the mark is fitted inside them
    // rather than filled to them.
    objectFit: "contain",
    objectPosition: "center",
    transform: "none",
};

/*
 * The style a caller asked for, filtered.
 *
 * An allowlist rather than a list of banned properties: the point is that a treatment nobody has
 * thought of yet is dropped by default. What survives is where the mark sits and how big it is.
 * `OUTER` goes on the box that holds the clear space, `INNER` on the image inside it, because the
 * clear space is outside the mark and a width belongs to the whole thing.
 */
const OUTER = new Set([
    "display",
    "width",
    "maxWidth",
    "minWidth",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "marginBlock",
    "marginInline",
    "float",
    "verticalAlign",
    "flex",
    "flexShrink",
    "flexGrow",
    "alignSelf",
]);

const INNER = new Set(["height", "maxHeight", "minHeight"]);

function only(style: CSSProperties | undefined, names: Set<string>): CSSProperties {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(style ?? {})) {
        if (names.has(name) && value !== undefined) out[name] = value;
    }
    return out as CSSProperties;
}

/** A URL without its query or fragment, so a mark resized by the CMS with `?w=480` is that mark. */
function markKey(url: string): string {
    const value = url.trim();
    const marks = [value.indexOf("?"), value.indexOf("#")].filter((i) => i !== -1);
    return marks.length > 0 ? value.slice(0, Math.min(...marks)) : value;
}

/** The entry for this image, if the site marked it as used as supplied. */
export function suppliedAssetFor(theme: PressTheme, src: string | undefined): SuppliedAsset | undefined {
    if (!src) return undefined;
    const key = markKey(src);
    return theme.asSupplied.find((asset) => markKey(asset.url) === key);
}

/*
 * The clear space is a minimum, so when the site and the block both name one the wider wins. A
 * block asking for room around a mark is honoured; a block asking for less than the site's minimum
 * is not, which is the whole point of calling it a minimum.
 */
function widerSpace(a: string | undefined, b: string | undefined): string | undefined {
    const rank = (name: string | undefined) => (SPACES as readonly string[]).indexOf(name ?? "");
    if (rank(a) === -1) return rank(b) === -1 ? undefined : b;
    if (rank(b) === -1) return a;
    return rank(a) >= rank(b) ? a : b;
}

/** What a block says about its own image: `asSupplied` marks it, `clearSpace` widens the space. */
export interface SuppliedProps {
    asSupplied?: boolean;
    clearSpace?: string;
}

/** The protection this image gets: the site's entry for it, the block's own mark, or neither. */
export function suppliedAssetOn(
    theme: PressTheme,
    src: string | undefined,
    block: SuppliedProps = {},
): SuppliedAsset | undefined {
    if (!src) return undefined;
    const site = suppliedAssetFor(theme, src);
    if (!site && block.asSupplied !== true) return undefined;
    const clearSpace = widerSpace(site?.clearSpace, block.clearSpace);
    return { url: src, ...(clearSpace ? { clearSpace } : {}) };
}

export function clearSpaceOf(theme: PressTheme, asset: SuppliedAsset): string {
    return spaceOf(theme, asset.clearSpace, DEFAULT_CLEAR_SPACE);
}

export interface AssetProps {
    src: string;
    alt?: string;
    theme: PressTheme;
    /** What the caller would draw. Everything but position and size is dropped for a marked asset. */
    style?: CSSProperties;
    loading?: "lazy" | "eager";
    /** A block's own marking, when it has one. The site's list is read either way. */
    supplied?: SuppliedProps;
}

/**
 * Every image the engine draws. An asset the site has not marked renders exactly as the caller
 * asked, which is why nothing about an existing site changes.
 */
export function Asset({ src, alt, theme, style, loading, supplied }: AssetProps): ReactNode {
    const asset = suppliedAssetOn(theme, src, supplied);
    if (!asset) {
        return <img src={src} alt={alt ?? ""} loading={loading} style={style} />;
    }

    return (
        <span
            data-as-supplied=""
            style={{
                // Inline-block so the box is the mark's own, and border-box so the clear space is
                // inside whatever width the caller asked for instead of overflowing it on a phone.
                display: "inline-block",
                boxSizing: "border-box",
                maxWidth: "100%",
                ...only(style, OUTER),
                padding: clearSpaceOf(theme, asset),
                // An inline-block sits on the text baseline, and the descender gap under it would
                // make the clear space uneven.
                lineHeight: 0,
                ...NO_TREATMENT,
            }}
        >
            <img
                src={src}
                alt={alt ?? ""}
                loading={loading}
                style={{ display: "block", maxWidth: "100%", ...only(style, INNER), ...NO_TREATMENT }}
            />
        </span>
    );
}

/* ------------------------------------------------------------------- markdown */

/*
 * Markdown is the one path where the image is a string of HTML rather than a component, and the
 * generated prose stylesheet gives every image in it a corner and a hairline. An inline style is
 * what beats that, and it beats a consumer's own stylesheet too, which is why the declarations go on
 * the tag rather than into another rule.
 */
function declarations(style: CSSProperties): string {
    return Object.entries(style)
        .map(([name, value]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${css(String(value))}`)
        .join(";");
}

/** A token is a configured string rather than a constant, so it cannot close the attribute early. */
function css(value: string): string {
    return value.replace(/["'<>;]/g, "");
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&lt;": "<", "&gt;": ">" };

function unescapeHtml(value: string): string {
    return value.replace(/&(amp|quot|#x27|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Markdown, with any marked asset in it drawn as supplied. */
export function renderProse(source: string, theme: PressTheme, options?: RenderMarkdownOptions): string {
    const html = renderMarkdown(source, options);
    if (theme.asSupplied.length === 0 || !html.includes("<img")) return html;

    return html.replace(/<img src="([^"]*)"/g, (tag, src: string) => {
        const asset = suppliedAssetFor(theme, unescapeHtml(src));
        if (!asset) return tag;
        const style = declarations({
            ...NO_TREATMENT,
            boxSizing: "border-box",
            maxWidth: "100%",
            padding: clearSpaceOf(theme, asset),
        });
        return `<img style="${style}" src="${src}"`;
    });
}
