import type { PressConfig, SiteLink } from "../config.js";
import { pageHref, type NavItem } from "../cms.js";
import { samePath } from "../site.js";

/** A page the header already links to is drawn by the header, not twice. */
export function withoutHeaderDuplicates(config: PressConfig, items: NavItem[], links: SiteLink[]): NavItem[] {
    return items.filter((i) => i.children.length > 0 || !links.some((l) => samePath(l.href, pageHref(config, i.path))));
}
