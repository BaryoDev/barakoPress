import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { PressConfig } from "../config.js";
import { showsHoldingPage, siteConfigOrNull, themeFamilies } from "../site.js";
import { SHARE_INVALID_FRAGMENT } from "../routes/share.js";
import { themeVariablesCss, type PressTheme } from "../theme.js";
import type { BlockRegistry } from "../blocks/schema.js";
import { getPageAtPath, type Page } from "../cms.js";
import { PageView } from "./page.js";

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

function fontHref(family: string): string {
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
}

function ThemeHead({ theme, loadFonts }: { theme: PressTheme; loadFonts: boolean }) {
    return (
        <head>
            <style dangerouslySetInnerHTML={{ __html: themeVariablesCss(theme) }} />
            {loadFonts && (
                <>
                    <link rel="preconnect" href="https://fonts.googleapis.com" />
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                    {themeFamilies(theme).map((family) => (
                        <link key={family} rel="stylesheet" href={fontHref(family)} />
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
 * The holding page, rendered in place of the whole site while holding (#28). The page
 * under it has already stopped at a 404 in `siteConfig`, so `children` holds nothing of the site and
 * is not rendered either. No header, footer or feed link: those would name the site's structure.
 *
 * With `HoldingPath` set it is that page, rendered as the page route renders it. Unset, or not
 * served there, it is the name, tagline and "Coming soon." in the tenant's theme.
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
                        <PageView config={cfg} page={page} registry={registry} />
                    </div>
                ) : (
                    <main
                        data-press="holding"
                        style={{ maxWidth: t.layout.wide, margin: "0 auto", padding: `80px ${t.layout.gutter}` }}
                    >
                        <div style={{ maxWidth: t.layout.prose }}>
                            {s.logo && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={s.logo} alt={s.logoAlt ?? s.name} style={{ height: "48px", width: "auto" }} />
                            )}
                            <h1 style={{ margin: "24px 0 0", fontFamily: t.fonts.heading, fontSize: "clamp(32px, 4.4vw, 52px)", lineHeight: 1.08 }}>
                                {s.name}
                            </h1>
                            {s.tagline && <p style={{ margin: "12px 0 0", color: t.colors.secondaryInk }}>{s.tagline}</p>}
                            <p style={{ margin: "32px 0 0", fontFamily: t.fonts.mono, color: t.colors.accent }}>Coming soon.</p>
                        </div>
                    </main>
                )}
            </body>
        </html>
    );
}

export function createSiteLayout(config: PressConfig, options: SiteLayoutOptions = {}) {
    const loadFonts = options.loadFonts ?? true;

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

        const t = cfg.theme;
        const c = t.colors;
        const s = cfg.site;
        const band = { maxWidth: t.layout.wide, margin: "0 auto", padding: `0 ${t.layout.gutter}` } as const;
        const linkStyle = { color: "inherit", textDecoration: "none" } as const;

        return (
            <html lang={cfg.locale}>
                <ThemeHead theme={t} loadFonts={loadFonts} />
                <body style={{ margin: 0, background: c.pageBg, color: c.ink, fontFamily: t.fonts.body }}>
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
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={s.logo} alt={s.logoAlt ?? s.name} style={{ height: "36px", width: "auto" }} />
                                ) : (
                                    s.name
                                )}
                            </Link>
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

                    <main>{children}</main>

                    <footer style={{ background: c.darkPanel, color: c.darkPanelInk, marginTop: "48px" }}>
                        <div style={{ ...band, paddingTop: "40px", paddingBottom: "40px" }}>
                            {s.footerLogo && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={s.footerLogo} alt={s.logoAlt ?? s.name} style={{ height: "40px", width: "auto" }} />
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
