const PLACEHOLDER = "http://site.invalid";

/**
 * A path on this site, normalised, or `fallback`. Used wherever an editor or a form field names
 * where to send a visitor. The value is parsed the way a browser would parse it and checked
 * afterwards: the origin must be unchanged and the path must not begin with `//`, which a browser
 * reads as another host. Backslashes and control characters are refused before parsing, since a
 * browser drops or rewrites them.
 */
export function sitePath(value: unknown, fallback = "/"): string {
    if (typeof value !== "string" || value.length > 512 || !value.startsWith("/")) return fallback;
    if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
    let url: URL;
    try {
        url = new URL(value, PLACEHOLDER);
    } catch {
        return fallback;
    }
    if (url.origin !== PLACEHOLDER || url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
}
