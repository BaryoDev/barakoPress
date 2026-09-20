import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Asset } from "../assets.js";
import type { PressConfig, Region } from "../config.js";
import { showsHoldingPage, siteConfigOrNull } from "../site.js";
import {
    allowedFontOrigins,
    fontLinks,
    GOOGLE_FONTS_FILES_ORIGIN,
    GOOGLE_FONTS_ORIGIN,
} from "../fonts.js";
import { SHARE_INVALID_FRAGMENT } from "../routes/share.js";
import { themeVariablesCss, type PressTheme } from "../theme.js";
import type { BlockRegistry } from "../blocks/schema.js";
import { getNavigation, getPageAtPath, isChromePath, type NavItem, type Page } from "../cms.js";
import { Navigation } from "./navigation.js";
import { PageView, pageBlocks } from "./page.js";
import { createBlockRegistry, registryFor } from "../blocks/registry.js";
import { BlockList } from "../blocks/render.js";
import { spaceOf, toneOf, widthOf } from "../blocks/tokens.js";

/*
 * The root layout and its metadata, from the site's identity and theme.
 *
 * For a request-time site these are the tenant's, read per request: the name in the header and the
 * title, the faces, the palette, the links in the header and footer. A build-time site gets the
 * same markup from its config. A request that belongs to no tenant gets a bare document, so the
 * page's own 404 renders without borrowing anybody's chrome.
 *
 * Styled inline from the theme, for the reason the post screen is (see post-view.tsx).
 */

type LayoutProps = { children: ReactNode };

/*
 * The faces, from the theme and the deployment's allow list (#54).
 *
 * A role whose family is all the theme carries is linked from Google Fonts, as it always was. A
 * role with a stylesheet of its own is linked from there instead, if the operator allows that
 * origin. `PRESS_FONT_ORIGINS` is read here rather than in the config, because a value read at
 * module scope is baked into whatever is prerendered at build.
 *
 * The preconnects go out only when something is actually loaded from Google Fonts. Nothing is
 * preconnected for another origin: the stylesheet opens that connection itself, and where it fetches
 * its font files from is not something this can know.
 */
function ThemeHead({ theme, loadFonts }: { theme: PressTheme; loadFonts: boolean }) {
    const faces = loadFonts ? fontLinks(theme, allowedFontOrigins()) : null;
    return (
        <head>
            <style dangerouslySetInnerHTML={{ __html: themeVariablesCss(theme) }} />
            {faces && (
                <>
                    {faces.google && (
                        <>
                            <link rel="preconnect" href={GOOGLE_FONTS_ORIGIN} />
                            <link rel="preconnect" href={GOOGLE_FONTS_FILES_ORIGIN} crossOrigin="" />
                        </>
                    )}
                    {faces.stylesheets.map((href) => (
                        <link key={href} rel="stylesheet" href={href} />
                    ))}
                </>
            )}
        </head>
    );
}

export interface SiteLayoutOptions {
    loadFonts?: boolean;
    /** The registry a holding page renders with. Without it, the default holding page renders. */
    blocks?: BlockRegistry;
}

/** The page at `HoldingPath`, or null for the default holding page. A failed read is the default too. */
async function holdingPage(cfg: PressConfig, registry?: BlockRegistry): Promise<Page | null> {
    const path = cfg.holding?.path;
    if (!path || !registry) return null;
    try {
        return await getPageAtPath(cfg, path);
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        return null;
    }
}

/*
 * The page menu, when the site mounts pages. A menu that cannot be read is no menu rather than a broken
 * page. While holding, the holding page leaves it, as it leaves the header links. A header or footer
 * region page leaves it too: it is chrome that is drawn on every page, not somewhere to navigate to.
 */
async function menu(cfg: PressConfig): Promise<NavItem[]> {
    if (cfg.pages === undefined) return [];
    let items: NavItem[];
    try {
        items = await getNavigation(cfg);
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`pages: navigation for tenant "${cfg.tenant ?? ""}" could not be read (${why})`);
        return [];
    }
    return withoutChrome(cfg, items);
}

function withoutChrome(cfg: PressConfig, items: NavItem[]): NavItem[] {
    return items
        .filter((item) => !isChromePath(cfg, item.path))
        .map((item) => ({ ...item, children: withoutChrome(cfg, item.children) }));
}

/*
 * The header and the footer as block regions (barakoPress #48).
 *
 * A region is the page at `HeaderPath` or `FooterPath`, rendered from its blocks the way the page
 * route renders a page, inside a `<header>` or a `<footer>` with a tone behind it. That is what
 * gives a clinic a light footer with opening hours and a map, or a school an enrolment banner with
 * a button, without a barakoPress release: the arrangement is the tenant's data and the image is
 * the same everywhere (barakoCMS D22). The sticky bar planned in #24 is a block in the header
 * region rather than a second kind of setting.
 *
 * With no region set, or nothing served at its path, the built-in header, top bar and footer render
 * from `TopBar`, `HeaderLinks`, `FooterColumns` and the rest, with the markup they always had. A
 * site whose own CSS keys off that markup keeps rendering.
 */
async function regionPage(cfg: PressConfig, region: Region | undefined): Promise<Page | null> {
    if (!region) return null;
    try {
        return await getPageAtPath(cfg, region.path);
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`regions: the page at ${region.path} could not be read (${why})`);
        return null;
    }
}

/*
 * A region's band. Every value comes from a token helper, never a colour or a pixel size, for the
 * reason the primitives do (#49): the theme's colour slots are still named after one site's design,
 * and a tone is the one place that renaming has to reach.
 */
async function RegionBand({
    cfg,
    region,
    page,
    registry,
    tag,
}: {
    cfg: PressConfig;
    region: Region;
    page: Page;
    registry: BlockRegistry;
    tag: "header" | "footer";
}) {
    const t = cfg.theme;
    const tone = toneOf(t, region.tone);
    const blocks = await pageBlocks(cfg, page, registry);
    const Tag = tag;

    return (
        <Tag
            data-press={tag}
            style={{
                background: tone.bg,
                color: tone.ink,
                ...(tag === "footer" ? { marginTop: spaceOf(t, "xl") } : {}),
            }}
        >
            <div
                style={{
                    maxWidth: widthOf(t, "wide"),
                    margin: "0 auto",
                    padding: `${spaceOf(t, "lg")} ${t.layout.gutter}`,
                }}
            >
                <BlockList blocks={blocks} theme={t} />
            </div>
        </Tag>
    );
}

/*
 * The holding page, rendered in place of the whole site while holding (#28). The page
 * under it has already stopped at a 404 in `siteConfig`, so `children` holds nothing of the site and
 * is not rendered either. No header, footer or feed link: those would name the site's structure.
 *
 * With `HoldingPath` set it is that page, rendered as the page route renders it. Unset, or not
 * served there, it is the name, the tagline and the tenant's `HoldingMessage`, in the tenant's theme.
 * No message shows no line: a fixed one would tell a site closed for a break that it is coming soon,
 * and in English whatever the tenant's locale.
 *
 * A share link that did not redeem lands on `/#share-invalid`. The notice is shown by CSS `:target`
 * alone, so nothing is stored and no script runs for it.
 */
async function HoldingDocument({ cfg, registry, loadFonts }: { cfg: PressConfig; registry?: BlockRegistry; loadFonts: boolean }) {
    const t = cfg.theme;
    const s = cfg.site;
    const page = await holdingPage(cfg, registry);

    return (
        <html lang={cfg.locale}>
            <ThemeHead theme={t} loadFonts={loadFonts} />
            <body style={{ margin: 0, background: t.colors.pageBg, color: t.colors.ink, fontFamily: t.fonts.body }}>
                <style dangerouslySetInnerHTML={{ __html: `#${SHARE_INVALID_FRAGMENT}{display:none}#${SHARE_INVALID_FRAGMENT}:target{display:block}` }} />
                <p
                    id={SHARE_INVALID_FRAGMENT}
                    role="status"
                    style={{ margin: 0, padding: `12px ${t.layout.gutter}`, background: t.colors.darkPanel, color: t.colors.darkPanelInk }}
                >
                    This link is not valid or has expired.
                </p>
                {page && registry ? (
                    <div data-press="holding">
                        {await PageView({ config: cfg, page, registry: registryFor(cfg, registry) })}
                    </div>
                ) : (
                    <main
                        data-press="holding"
                        style={{ maxWidth: t.layout.wide, margin: "0 auto", padding: `80px ${t.layout.gutter}` }}
                    >
                        <div style={{ maxWidth: t.layout.prose }}>
                            {s.logo && (
                                <Asset src={s.logo} alt={s.logoAlt ?? s.name} theme={t} style={{ height: "48px", width: "auto" }} />
                            )}
                            <h1 style={{ margin: "24px 0 0", fontFamily: t.fonts.heading, fontSize: "clamp(32px, 4.4vw, 52px)", lineHeight: 1.08 }}>
                                {s.name}
                            </h1>
                            {s.tagline && <p style={{ margin: "12px 0 0", color: t.colors.secondaryInk }}>{s.tagline}</p>}
                            {cfg.holding?.message && (
                                <p style={{ margin: "32px 0 0", fontFamily: t.fonts.mono, color: t.colors.accent }}>{cfg.holding.message}</p>
                            )}
                        </div>
                    </main>
                )}
            </body>
        </html>
    );
}

/*
 * The built-in header and footer: what renders when the site names no region.
 *
 * Moved here whole rather than rewritten. barakoPress is serving sites whose own CSS keys off this
 * markup, so `TopBar`, `HeaderLinks`, `FooterColumns` and `SocialLinks` keep meaning exactly what
 * they meant and produce exactly what they produced.
 */
function BuiltInHeader({ cfg, nav }: { cfg: PressConfig; nav: NavItem[] }) {
    const t = cfg.theme;
    const c = t.colors;
    const s = cfg.site;
    const band = { maxWidth: t.layout.wide, margin: "0 auto", padding: `0 ${t.layout.gutter}` } as const;
    const linkStyle = { color: "inherit", textDecoration: "none" } as const;

    return (
        <>
            {s.topBar && (
                <div style={{ background: c.darkPanel, color: c.darkPanelInk, fontSize: "13px" }}>
                    <div style={{ ...band, display: "flex", flexWrap: "wrap", gap: "8px 20px", padding: `8px ${t.layout.gutter}` }}>
                        {s.topBar.text && <span>{s.topBar.text}</span>}
                        {s.topBar.links.map((l) => (
                            <a key={l.href} href={l.href} style={linkStyle}>
                                {l.label}
                            </a>
                        ))}
                    </div>
                </div>
            )}

            <header style={{ background: c.surface, borderBottom: `1px solid ${c.hairline}` }}>
                <nav
                    style={{
                        ...band,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px 28px",
                        paddingTop: "18px",
                        paddingBottom: "18px",
                    }}
                >
                    <Link
                        href="/"
                        style={{ ...linkStyle, display: "flex", alignItems: "center", gap: "12px", fontFamily: t.fonts.heading, fontWeight: 700, fontSize: "20px" }}
                    >
                        {s.logo ? (
                            <Asset src={s.logo} alt={s.logoAlt ?? s.name} theme={t} style={{ height: "36px", width: "auto" }} />
                        ) : (
                            s.name
                        )}
                    </Link>
                    <Navigation config={cfg} items={nav} />
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px", fontSize: "15px" }}>
                        {(s.headerLinks ?? []).map((l) => (
                            <a key={l.href} href={l.href} style={linkStyle}>
                                {l.label}
                            </a>
                        ))}
                        {!cfg.holding && (
                            <a href="/feed.xml" style={{ ...linkStyle, fontFamily: t.fonts.mono, fontSize: "13px", color: c.muted }}>
                                RSS
                            </a>
                        )}
                    </span>
                </nav>
            </header>
        </>
    );
}

function BuiltInFooter({ cfg }: { cfg: PressConfig }) {
    const t = cfg.theme;
    const c = t.colors;
    const s = cfg.site;
    const band = { maxWidth: t.layout.wide, margin: "0 auto", padding: `0 ${t.layout.gutter}` } as const;
    const linkStyle = { color: "inherit", textDecoration: "none" } as const;

    return (
        <footer style={{ background: c.darkPanel, color: c.darkPanelInk, marginTop: "48px" }}>
            <div style={{ ...band, paddingTop: "40px", paddingBottom: "40px" }}>
                {s.footerLogo && (
                    <Asset src={s.footerLogo} alt={s.logoAlt ?? s.name} theme={t} style={{ height: "40px", width: "auto" }} />
                )}
                {(s.footerColumns ?? []).length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: "24px", marginTop: "24px" }}>
                        {(s.footerColumns ?? []).map((col, i) => (
                            <div key={`${col.heading}-${i}`}>
                                {col.heading && <p style={{ margin: 0, fontWeight: 600, color: c.darkPanelAccent }}>{col.heading}</p>}
                                <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
                                    {col.links.map((l) => (
                                        <li key={l.href} style={{ margin: "6px 0" }}>
                                            <a href={l.href} style={linkStyle}>
                                                {l.label}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
                {(s.socialLinks ?? []).length > 0 && (
                    <p style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", margin: "24px 0 0" }}>
                        {(s.socialLinks ?? []).map((l) => (
                            <a key={l.href} href={l.href} rel="noopener noreferrer" style={{ ...linkStyle, textTransform: "capitalize" }}>
                                {l.network}
                            </a>
                        ))}
                    </p>
                )}
                <p style={{ margin: "24px 0 0", fontFamily: t.fonts.mono, fontSize: "12.5px" }}>
                    {s.copyright ?? s.name}
                </p>
            </div>
        </footer>
    );
}

export function createSiteLayout(config: PressConfig, options: SiteLayoutOptions = {}) {
    const loadFonts = options.loadFonts ?? true;
    /*
     * The registry the regions render with, built once and kept. The site's own if it passed one,
     * and the built-in blocks otherwise: a tenant that names a region page in its settings should
     * see that page, not a setting that quietly does nothing. The holding page still renders only
     * with a registry the site passed, which is what it did before this.
     */
    let regionBlocks: BlockRegistry | undefined;
    const blocksForRegions = () => (regionBlocks ??= options.blocks ?? createBlockRegistry(config));

    return async function SiteLayout({ children }: LayoutProps) {
        const cfg = await siteConfigOrNull(config);
        if (!cfg) {
            return (
                <html lang="en">
                    <body>{children}</body>
                </html>
            );
        }
        if (await showsHoldingPage(cfg)) {
            return await HoldingDocument({ cfg, registry: options.blocks, loadFonts });
        }

        const nav = await menu(cfg);
        const headerRegion = cfg.regions?.header;
        const footerRegion = cfg.regions?.footer;
        const headerPage = await regionPage(cfg, headerRegion);
        const footerPage = await regionPage(cfg, footerRegion);
        const registry = headerPage || footerPage ? registryFor(cfg, blocksForRegions()) : undefined;
        const t = cfg.theme;
        const c = t.colors;

        return (
            <html lang={cfg.locale}>
                <ThemeHead theme={t} loadFonts={loadFonts} />
                <body style={{ margin: 0, background: c.pageBg, color: c.ink, fontFamily: t.fonts.body }}>
                    {headerPage && headerRegion && registry ? (
                        await RegionBand({ cfg, region: headerRegion, page: headerPage, registry, tag: "header" })
                    ) : (
                        <BuiltInHeader cfg={cfg} nav={nav} />
                    )}

                    <main>{children}</main>

                    {footerPage && footerRegion && registry ? (
                        await RegionBand({ cfg, region: footerRegion, page: footerPage, registry, tag: "footer" })
                    ) : (
                        <BuiltInFooter cfg={cfg} />
                    )}
                </body>
            </html>
        );
    };
}

export function createSiteMetadata(config: PressConfig) {
    return async function generateMetadata(): Promise<Metadata> {
        const cfg = await siteConfigOrNull(config);
        if (!cfg) return { title: "Not found" };

        const s = cfg.site;
        let metadataBase: URL | undefined;
        try {
            metadataBase = s.url ? new URL(s.url) : undefined;
        } catch {
            metadataBase = undefined;
        }

        return {
            metadataBase,
            title: { default: s.name, template: `%s | ${s.name}` },
            description: s.tagline,
            icons: s.favicon ? { icon: s.favicon } : undefined,
            openGraph: { siteName: s.name, images: s.shareImage ? [s.shareImage] : undefined },
            // While holding nothing is indexed, session or not, and there is no feed to point at.
            alternates: s.url && !cfg.holding ? { types: { "application/rss+xml": `${s.url}/feed.xml` } } : undefined,
            robots: cfg.holding ? { index: false, follow: false } : undefined,
        };
    };
}
