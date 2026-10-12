import Link from "next/link";
import type { CSSProperties } from "react";
import { Asset } from "../assets.js";
import type { PressConfig } from "../config.js";
import { lookOr, recipeLook } from "../recipes.js";
import { HeaderLink, type HeaderLinkStyles } from "../screens/header-menu.js";
import { CURRENT_CSS, DROPDOWN_CSS, headerLinkStyles } from "../screens/header-styles.js";
import { boundToConfig } from "./built-in.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import { SPACES, spaceOf } from "./tokens.js";

/*
 * The header's own parts as blocks, for a header region (#167): the site's `HeaderLinks` and its
 * logo. A region page drawn in place of the built-in header used to have to list its links again,
 * by hand, and could not mark the current one.
 *
 * Both read the site's identity, so they are built for the config a request resolved, the same as
 * the collection block. The names carry `site` so a tenant's preset called `logo` keeps its place:
 * a preset never replaces a code block, and one shipped under that name would hide it.
 *
 * Each part takes a style recipe, and without one the part the site set in `HeaderRecipes`, so a
 * tenant that styled the built-in header gets the same look in a region with nothing set twice.
 */

type NavigationProps = {
    label?: string;
    gap?: string;
    recipe?: string;
    linkRecipe?: string;
    currentRecipe?: string;
    badgeRecipe?: string;
};

function siteNavigation(config: PressConfig, holding: boolean): BlockDefinition {
    const definition = defineBlock<NavigationProps>({
        type: "siteNavigation",
        label: "Site navigation",
        layer: "block",
        fields: [
            { name: "label", kind: "text", label: "Name it for a screen reader" },
            { name: "gap", kind: "select", label: "Gap", options: [...SPACES] },
            { name: "recipe", kind: "text", label: "Style recipe, the row" },
            { name: "linkRecipe", kind: "text", label: "Style recipe, a link" },
            { name: "currentRecipe", kind: "text", label: "Style recipe, the current link" },
            { name: "badgeRecipe", kind: "text", label: "Style recipe, a badge" },
        ],
        component: ({ props, theme }) => {
            // The holding page names nothing of the site behind it, so it draws no header links either.
            if (holding) return null;
            const links = config.site.headerLinks ?? [];
            if (links.length === 0) return null;
            const set = config.site.headerRecipes ?? {};
            const plain = { color: "inherit", textDecoration: "none" } as const;
            const link = lookOr(theme, props.linkRecipe ?? set.link, plain);
            const badge = lookOr(theme, props.badgeRecipe ?? set.badge, {
                marginLeft: spaceOf(theme, "xs"),
                fontFamily: theme.fonts.mono,
                fontSize: theme.text.meta,
                color: theme.colors.muted,
            });
            const current = recipeLook(theme, props.currentRecipe ?? set.current);
            const row = lookOr(theme, props.recipe ?? set.links, {
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spaceOf(theme, props.gap),
            });
            const styles: HeaderLinkStyles = {
                ...headerLinkStyles(theme, plain, badge.style),
                link: link.style,
                ...(link.className ? { linkClass: link.className } : {}),
                ...(badge.className ? { badgeClass: badge.className } : {}),
                ...(current ? { current: current.style } : {}),
                ...(current?.className ? { currentClass: current.className } : {}),
            };
            const follows = links.some((l) => l.activeOn || (l.children?.length ?? 0) > 0);
            return (
                <>
                    {follows && <style dangerouslySetInnerHTML={{ __html: CURRENT_CSS + DROPDOWN_CSS }} />}
                    <nav
                        aria-label={props.label ?? config.labels.menu}
                        data-press="site-navigation"
                        className={row.className}
                        style={row.style}
                    >
                        {links.map((l) =>
                            l.activeOn || l.children?.length ? (
                                <HeaderLink key={l.href} link={l} styles={styles} submenu={config.labels.submenu} />
                            ) : (
                                <a key={l.href} href={l.href} className={link.className} style={link.style}>
                                    {l.label}
                                    {l.badge && (
                                        <span data-press="badge" className={badge.className} style={badge.style}>
                                            {l.badge}
                                        </span>
                                    )}
                                </a>
                            ),
                        )}
                    </nav>
                </>
            );
        },
    });
    return boundToConfig(definition, siteNavigation);
}

const LOGO_SHOWS = ["logo", "name", "both"] as const;

type LogoProps = { show?: (typeof LOGO_SHOWS)[number]; recipe?: string };

function siteLogo(config: PressConfig): BlockDefinition {
    const definition = defineBlock<LogoProps>({
        type: "siteLogo",
        label: "Site logo",
        layer: "block",
        fields: [
            // Unset, the logo when the site has one and the name when it does not, as the built-in header.
            { name: "show", kind: "select", label: "Show", options: [...LOGO_SHOWS] },
            { name: "recipe", kind: "text", label: "Style recipe" },
        ],
        component: ({ props, theme }) => {
            const s = config.site;
            const show = props.show ?? (s.logo ? "logo" : "name");
            const image = show !== "name" ? s.logo : undefined;
            const name = show !== "logo" || !image;
            const brand = lookOr(theme, props.recipe ?? s.headerRecipes?.brand, {
                display: "inline-flex",
                alignItems: "center",
                gap: spaceOf(theme, "sm"),
                color: "inherit",
                textDecoration: "none",
                fontFamily: theme.fonts.heading,
                fontWeight: 700,
                fontSize: theme.text.subheading,
            });
            const mark: CSSProperties = { height: "1.8em", width: "auto" };
            return (
                <Link href="/" data-press="site-logo" className={brand.className} style={brand.style}>
                    {image && (
                        // Beside the name the image is decoration: the name already says it.
                        <Asset src={image} alt={name ? "" : (s.logoAlt ?? s.name)} theme={theme} style={mark} />
                    )}
                    {name && s.name}
                </Link>
            );
        },
    });
    return boundToConfig(definition, (resolved) => siteLogo(resolved));
}

export function siteBlocks(config: PressConfig): BlockDefinition[] {
    return [siteNavigation(config, false), siteLogo(config)];
}
