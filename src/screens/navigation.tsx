import Link from "next/link";
import type { PressConfig } from "../config.js";
import { pageHref, type Breadcrumb, type NavItem } from "../cms.js";

/*
 * The page menu and the breadcrumb trail, drawn from what the Pages module answered.
 *
 * Both draw their items in the order received and link to the paths received, under the mount. They
 * do not sort, nest, filter or derive anything: the CMS already did, and a second opinion here is how
 * a menu ends up disagreeing with the tree an editor arranged.
 *
 * Styled inline from the theme, for the reason the post screen is (see post-view.tsx).
 */

export interface NavigationProps {
    config: PressConfig;
    items: NavItem[];
    /** The accessible name of the menu. */
    label?: string;
}

export function Navigation({ config, items, label = "Pages" }: NavigationProps) {
    if (items.length === 0) return null;
    return (
        <nav aria-label={label} data-press="navigation">
            <NavList config={config} items={items} depth={0} />
        </nav>
    );
}

function NavList({ config, items, depth }: { config: PressConfig; items: NavItem[]; depth: number }) {
    const top = depth === 0;
    return (
        <ul
            style={{
                listStyle: "none",
                margin: 0,
                padding: top ? 0 : "6px 0 0 14px",
                display: top ? "flex" : "block",
                flexWrap: "wrap",
                gap: top ? "8px 22px" : undefined,
                fontSize: top ? "15px" : "13.5px",
            }}
        >
            {items.map((item, i) => (
                <li key={item.id || `${item.path}-${i}`} style={top ? undefined : { margin: "4px 0" }}>
                    <Link href={pageHref(config, item.path)} style={{ color: "inherit", textDecoration: "none" }}>
                        {item.title}
                    </Link>
                    {item.children.length > 0 && <NavList config={config} items={item.children} depth={depth + 1} />}
                </li>
            ))}
        </ul>
    );
}

export interface BreadcrumbsProps {
    config: PressConfig;
    /** From the root down to the current page, which is the last item and is not a link. */
    items: Breadcrumb[];
}

export function Breadcrumbs({ config, items }: BreadcrumbsProps) {
    if (items.length === 0) return null;
    const t = config.theme;
    return (
        <nav aria-label="Breadcrumb" data-press="breadcrumbs">
            <ol
                style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px",
                    fontFamily: t.fonts.mono,
                    fontSize: "12.5px",
                    color: t.colors.muted,
                }}
            >
                {items.map((crumb, i) => {
                    const last = i === items.length - 1;
                    return (
                        <li key={crumb.id || `${crumb.path}-${i}`} style={{ display: "flex", gap: "6px" }}>
                            {last ? (
                                <span aria-current="page">{crumb.title}</span>
                            ) : (
                                <>
                                    <Link href={pageHref(config, crumb.path)} style={{ color: "inherit" }}>
                                        {crumb.title}
                                    </Link>
                                    <span aria-hidden>/</span>
                                </>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
