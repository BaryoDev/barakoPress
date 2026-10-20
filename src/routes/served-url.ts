/*
 * The URL a path is served at. A build that sets `PRESS_TRAILING_SLASH=true` sets Next's
 * `trailingSlash`, and then every path without the slash answers 308 to the one with it, so a
 * sitemap or feed that wrote the bare path would send every crawler and reader through a redirect.
 *
 * Read when called, not at module load, because the sitemap and feed are prerendered and the build
 * decides the policy.
 */
export function servedUrl(origin: string, path: string): string {
    if (path === "" || path === "/") return origin;
    const rooted = path.startsWith("/") ? path : `/${path}`;
    const slashed = process.env.PRESS_TRAILING_SLASH === "true" && !rooted.endsWith("/");
    return `${origin}${rooted}${slashed ? "/" : ""}`;
}
