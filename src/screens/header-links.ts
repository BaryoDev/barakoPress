import type { PressConfig, SiteLink } from "../config.js";
import { pageHref, type NavItem } from "../cms.js";
import { localPathOf, samePath } from "../site.js";

/**
 * A page the header already links to is drawn by the header, not twice. A link counts however it is
 * written: absolute to this site, with a query or a hash. A page with children stays, but a child the
 * header links to leaves the page's list.
 */
export function withoutHeaderDuplicates(config: PressConfig, items: NavItem[], links: SiteLink[]): NavItem[] {
    const siteUrl = config.site?.url ?? "";
    const linked = links.map((l) => localPathOf(l.href, siteUrl)).filter((p): p is string => p !== null);
    const drawn = (i: NavItem) => linked.some((p) => samePath(p, pageHref(config, i.path)));
    const prune = (list: NavItem[]): NavItem[] =>
        list
            .filter((i) => i.children.length > 0 || !drawn(i))
            .map((i) => (i.children.length > 0 ? { ...i, children: prune(i.children) } : i));
    return prune(items);
}
