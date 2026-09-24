/*
 * Whether a header link is the current one (#127).
 *
 * The header's client component imports this, so nothing here may import anything that cannot run
 * in a browser. That is why `PRESS_PREFIX` lives here and site-route.ts, which reaches `node:net`,
 * re-exports it.
 */

/** The first segment of a rewritten path. A request that arrives under it is refused. */
export const PRESS_PREFIX = "_press";

/** At most this many paths are kept from one `activeOn`. */
export const ACTIVE_ON_MAX = 12;

function withoutTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
    return value.slice(0, end);
}

/*
 * Next can hand a component the rewritten path (`/_press/<site>/docs`) rather than the one the
 * visitor asked for, so the prefix and the site segment are dropped before comparing.
 */
function visitorPath(pathname: string): string {
    const prefix = `/${PRESS_PREFIX}`;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return pathname;
    const rest = pathname.slice(prefix.length + 1);
    const slash = rest.indexOf("/");
    return slash < 0 ? "/" : rest.slice(slash);
}

/**
 * Whether `pathname` is one of the paths in `activeOn`, a space separated list. `/` is the home page
 * alone; any other path matches itself and everything below it. A trailing slash on either side is
 * ignored.
 */
export function isCurrentPath(pathname: string | null | undefined, activeOn: string | undefined): boolean {
    if (!pathname || !activeOn) return false;
    const path = withoutTrailingSlashes(visitorPath(pathname));
    return activeOn
        .split(/\s+/)
        .filter(Boolean)
        .some((raw) => {
            const on = withoutTrailingSlashes(raw);
            if (on === "") return path === "";
            return path === on || path.startsWith(`${on}/`);
        });
}

/** A link is current when its own `activeOn` matches, or a child's does. */
export function isCurrentLink(
    pathname: string | null | undefined,
    link: { activeOn?: string; children?: { activeOn?: string }[] },
): boolean {
    return (
        isCurrentPath(pathname, link.activeOn) || (link.children ?? []).some((c) => isCurrentPath(pathname, c.activeOn))
    );
}
