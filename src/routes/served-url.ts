import { readEnv } from "../env.js";

/*
 * The URL a path is served at. A build that sets `PRESS_TRAILING_SLASH=true` sets Next's
 * `trailingSlash`, and then every path without the slash answers 308 to the one with it, so a
 * sitemap or feed that wrote the bare path would send every crawler and reader through a redirect.
 *
 * Read when called, not at module load, because the sitemap and feed are prerendered and the build
 * decides the policy.
 */
/** `path` without its trailing slashes. A loop, not a regex, because a regex here backtracks on a long run of slashes. */
export function trimTrailingSlashes(path: string): string {
    let end = path.length;
    while (end > 0 && path[end - 1] === "/") end--;
    return path.slice(0, end);
}

export function servedUrl(origin: string, path: string): string {
    const trimmed = trimTrailingSlashes(path);
    if (trimmed === "") return origin;
    const rooted = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    const slashed = readEnv().trailingSlash === "true";
    return `${origin}${rooted}${slashed ? "/" : ""}`;
}
