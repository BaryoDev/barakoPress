/*
 * Images and files, as the delivery API answers them.
 *
 * A field that points at an image used to be text: a URL or a path. barakoCMS 4.6 adds two shapes
 * that are objects instead:
 *
 *   file          { id, url, fileName, contentType, size, alt, caption }, for a public stored file.
 *                 Any other file is left out of the entry, so a missing field is the normal case.
 *   inlineimage   { url: "data:image/png;base64,...", alt }, a small image kept in the entry.
 *
 * Everything that draws an image or links a file reads it through here, so the rule about what may
 * reach an image src is kept once: an http or https URL, a path on this site, or an inline image
 * whose prefix is one the API allows. The API already refuses anything else on write and leaves it
 * out on delivery; this is the second check, for a value that came from somewhere else.
 *
 * No module imports: `site.ts` reads its logos through this, and this reads nothing back.
 */

/** The prefixes barakoCMS lets through, lower case and with no other parameter, then plain base64. */
const INLINE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** The longest inline image the API accepts on write: the longest prefix plus the base64 of 64 KB. */
const MAX_INLINE_IMAGE_CHARS = 87_407;

/** True for a data URI the API would deliver as an inline image, and for nothing else. */
export function isInlineImage(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_INLINE_IMAGE_CHARS && INLINE_IMAGE.test(value);
}

/** A path on the site, or an absolute http or https URL: the rule `siteHref` keeps. */
function webHref(value: string): string | undefined {
    if (!value || /[\s\\<>"']/.test(value)) return undefined;
    if (value.startsWith("/")) return value.startsWith("//") ? undefined : value;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
    } catch {
        return undefined;
    }
}

/** True for a value an image src may carry. */
export function isImageSrc(value: unknown): value is string {
    if (typeof value !== "string") return false;
    return isInlineImage(value) || webHref(value) !== undefined;
}

/**
 * A URL a share card may carry: an http or https URL, or a path on the site. Never an inline image,
 * since a crawler fetches `og:image` by address and a data URI is not one.
 */
export function shareImageUrl(value: unknown): string | undefined {
    return typeof value === "string" ? webHref(value.trim()) : undefined;
}

export interface DeliveredFile {
    id?: string;
    /** An absolute URL, or a path the API answered relative to itself. */
    url: string;
    fileName?: string;
    contentType?: string;
    size?: number;
    alt?: string;
    caption?: string;
}

export interface DeliveredImage {
    src: string;
    alt?: string;
    /** Only when the value says so. The API records neither for a file or an inline image today. */
    width?: number;
    height?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function dimension(v: unknown): number | undefined {
    return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 100_000 ? v : undefined;
}

/**
 * A file field's value, when it is one. An inline image is not a file, and an object with no URL is
 * not one either: the API leaves a file it will not serve out of the entry rather than half there.
 */
export function readFile(value: unknown): DeliveredFile | undefined {
    if (!isRecord(value) || typeof value.url !== "string") return undefined;
    const url = value.url.trim();
    if (!url || url.startsWith("data:")) return undefined;
    if (typeof value.fileName !== "string" && typeof value.contentType !== "string" && typeof value.id !== "string") {
        return undefined;
    }
    return {
        ...(typeof value.id === "string" ? { id: value.id } : {}),
        url,
        ...(text(value.fileName) ? { fileName: value.fileName as string } : {}),
        ...(text(value.contentType) ? { contentType: (value.contentType as string).toLowerCase() } : {}),
        ...(typeof value.size === "number" && Number.isFinite(value.size) ? { size: value.size } : {}),
        ...(text(value.alt) ? { alt: value.alt as string } : {}),
        ...(text(value.caption) ? { caption: value.caption as string } : {}),
    };
}

/**
 * The image a field holds: text naming one, an inline image, or a file that is an image. Undefined
 * for anything else, a file that is not an image included, so a caller treats it as absent.
 */
export function readImage(value: unknown): DeliveredImage | undefined {
    if (typeof value === "string") {
        const src = value.trim();
        return isImageSrc(src) ? { src } : undefined;
    }
    if (!isRecord(value) || typeof value.url !== "string") return undefined;
    const src = value.url.trim();
    const size = {
        ...(dimension(value.width) ? { width: value.width as number } : {}),
        ...(dimension(value.height) ? { height: value.height as number } : {}),
    };
    const alt = text(value.alt);
    if (src.startsWith("data:")) return isInlineImage(src) ? { src, ...(alt ? { alt } : {}), ...size } : undefined;
    const file = readFile(value);
    if (!file) return undefined;
    // A file with no type is taken at its word as an image, since the field it sits in says so.
    if (file.contentType && !file.contentType.startsWith("image/")) return undefined;
    return isImageSrc(src) ? { src, ...(alt ? { alt } : {}), ...size } : undefined;
}

export interface FileLink {
    href: string;
    /** The file's name, for the link text. */
    label?: string;
}

/** A link to a delivered file, for a field that holds one that is not drawn as an image. */
export function readFileLink(value: unknown): FileLink | undefined {
    const file = readFile(value);
    if (!file) return undefined;
    const href = webHref(file.url);
    return href ? { href, ...(file.fileName ? { label: file.fileName } : {}) } : undefined;
}
