import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { PressConfig } from "../config.js";
import { showsHoldingPage, siteConfigOrNull, themeFamilies } from "../site.js";
import { proseCss, themeVariablesCss, type PressTheme } from "../theme.js";
import { BLOCK_PROSE_CLASS } from "../blocks/built-in.js";
import { BlockList } from "../blocks/render.js";
import { resolveBlocks, type BlockRegistry } from "../blocks/schema.js";

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
    /** The registry a coming soon holding page's blocks render with. Without it, the default page renders. */
    blocks?: BlockRegistry;
}

/*
 * The holding page, rendered in place of the whole site while coming soon is on (#28). The page
 * under it has already stopped at a 404 in `siteConfig`, so `children` holds nothing of the site and
 * is not rendered either. No header, footer or feed link: those would name the site's structure.
 */
function HoldingDocument({ cfg, registry, loadFonts }: { cfg: PressConfig; registry?: BlockRegistry; loadFonts: boolean }) {
    const t = cfg.theme;
    const s = cfg.site;
    const blocks = registry ? resolveBlocks(cfg.comingSoon?.blocks, registry, { perViewer: false }) : [];

    return (
        <html lang={cfg.locale}>
            <ThemeHead theme={t} loadFonts={loadFonts} />
            <body style={{ margin: 0, background: t.colors.pageBg, color: t.colors.ink, fontFamily: t.fonts.body }}>
                <main
                    data-press="coming-soon"
                    style={{ maxWidth: t.layout.wide, margin: "0 auto", padding: `80px ${t.layout.gutter}` }}
                >
                    {blocks.length > 0 ? (
                        <>
                            <style dangerouslySetInnerHTML={{ __html: proseCss(t, BLOCK_PROSE_CLASS) }} />
                            <BlockList blocks={blocks} theme={t} />
                        </>
                    ) : (
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
                    )}
                </main>
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
            return <HoldingDocument cfg={cfg} registry={options.blocks} loadFonts={loadFonts} />;
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
                                {!cfg.comingSoon && (
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
            // While coming soon is on nothing is indexed, key or not, and there is no feed to point at.
            alternates: s.url && !cfg.comingSoon ? { types: { "application/rss+xml": `${s.url}/feed.xml` } } : undefined,
            robots: cfg.comingSoon ? { index: false, follow: false } : undefined,
        };
    };
}
