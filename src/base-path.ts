import { readEnv } from "./env.js";

/*
 * Serving one site under a path prefix, such as https://host.example/kape-ana/ behind a proxy that
 * strips nothing and forwards /kape-ana/ to the container. `BASE_PATH` is Next's `basePath`, and
 * Next reads it at build time, so it is a build argument and the same value is set at runtime for
 * the code here.
 *
 * Next adds the prefix itself to `<Link>`, `redirect()`, `router.push` and its own assets and
 * routes. It does not add it to a plain `<a href>`, a `<form action>`, a `Location` header written
 * by hand, an image source for a file in `public/`, or an absolute URL built from the site's address.
 * Those go through the helpers below. Unset, every helper returns its input unchanged.
 */

/** `/kape-ana` from `kape-ana`, `/kape-ana/` or ` //kape-ana// `. Empty for nothing, `/` or an unusable value. */
export function normalizeBasePath(raw: string | undefined | null): string {
    const parts = (raw ?? "")
        .trim()
        .split("/")
        .filter((p) => p !== "");
    // A segment with a dot-only name, a backslash or a control character could climb out or confuse a proxy.
    if (parts.some((p) => p === "." || p === ".." || /[\\\u0000-\u001f\u007f?#]/.test(p))) return "";
    return parts.length ? `/${parts.join("/")}` : "";
}

/** The prefix this process serves under, or an empty string. Reads the environment, so call it where it is used. */
export function basePath(): string {
    return normalizeBasePath(readEnv().basePath);
}

/**
 * A site path with the prefix in front. Only a path on this site gets one: `/about` becomes
 * `/kape-ana/about`, while `https://elsewhere.test/`, `//cdn.test/x`, `#top`, `?q=1`, `mailto:` and a
 * path already under the prefix come back as they were.
 */
export function withBase(path: string, base: string = basePath()): string {
    if (!base || !path.startsWith("/") || path.startsWith("//")) return path;
    if (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`)) return path;
    return path === "/" ? `${base}/` : `${base}${path}`;
}

/** `pathname` with the prefix taken off, for comparing a URL's path with a path the router knows. */
export function withoutBase(pathname: string, base: string = basePath()): string {
    if (!base) return pathname;
    if (pathname === base) return "/";
    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

/**
 * The site's public address with the prefix on the end, which is what a sitemap, a feed, a canonical
 * link or a robots file must name. Idempotent, so a site that already put the prefix in its address
 * is left alone. Empty stays empty.
 */
export function siteBaseUrl(url: string, base: string = basePath()): string {
    if (!url || !base) return url;
    let end = url.length;
    while (end > 0 && url[end - 1] === "/") end--;
    const bare = url.slice(0, end);
    return bare.endsWith(base) ? bare : `${bare}${base}`;
}

type Linked = { href: string };
const link = <T extends Linked>(l: T, base: string): T => ({ ...l, href: withBase(l.href, base) });
const links = <T extends Linked & { children?: Linked[] }>(list: T[] | undefined, base: string): T[] | undefined =>
    list?.map((l) => {
        const out = link(l, base);
        return l.children ? { ...out, children: l.children.map((c) => link(c, base)) } : out;
    });

/**
 * The site identity with every path on this site carried under the prefix: header, menu, top bar and
 * footer links, header actions, and the favicon and share image when they are local files. The logo
 * and footer logo are left alone: `Asset` prefixes them when it draws, after it has matched them
 * against the as-supplied list, which holds unprefixed paths.
 * Rendering reads this, so a plain `<a href>` lands inside the prefix. Matching a link against a
 * page (the header's duplicate check, the holding page) reads the identity before this.
 */
export function siteWithBase<
    S extends {
        logo?: string;
        footerLogo?: string;
        favicon?: string;
        shareImage?: string;
        topBar?: { links: Linked[] };
        headerLinks?: (Linked & { children?: Linked[] })[];
        menuLinks?: (Linked & { children?: Linked[] })[];
        headerActions?: Linked[];
        footerColumns?: { links: Linked[] }[];
    },
>(site: S, base: string = basePath()): S {
    if (!base) return site;
    const file = (v: string | undefined) => (v === undefined ? v : withBase(v, base));
    return {
        ...site,
        favicon: file(site.favicon),
        shareImage: file(site.shareImage),
        topBar: site.topBar ? { ...site.topBar, links: site.topBar.links.map((l) => link(l, base)) } : site.topBar,
        headerLinks: links(site.headerLinks, base),
        menuLinks: links(site.menuLinks, base),
        headerActions: site.headerActions?.map((a) => link(a, base)),
        footerColumns: site.footerColumns?.map((c) => ({ ...c, links: c.links.map((l) => link(l, base)) })),
    };
}

/*
 * Cookies. A `__Host-` cookie must be set with Path=/, so under a prefix it would be sent to every
 * other site on the same host and two sites would overwrite each other's session. Under a prefix
 * the cookie is renamed to `__Secure-` and scoped to the prefix instead. `__Secure-` still requires
 * Secure, and every cookie here keeps HttpOnly and SameSite=Lax. What is given up is the `__Host-`
 * guarantee that no Domain attribute was used, which a script on the same origin could defeat anyway.
 * With no prefix the name and the path are exactly what they were.
 *
 * The exported `SHARE_COOKIE`, `LINK_COOKIE` and `VIEWER_COOKIE` are the root names. A caller that
 * reads or sets one itself passes it through `cookieName` and uses `cookiePath()`.
 */
export function cookieName(name: string, base: string = basePath()): string {
    return base ? name.replace(/^__Host-/, "__Secure-") : name;
}

/** The Path attribute for a session cookie: the prefix, or `/` at the root. */
export function cookiePath(base: string = basePath()): string {
    return base || "/";
}
