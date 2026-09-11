import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const siteName = process.env.SITE_NAME ?? "barakoPress";
const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: { default: siteName, template: `%s | ${siteName}` },
    description: process.env.SITE_TAGLINE ?? "A blog on barakoCMS",
    alternates: {
        types: { "application/rss+xml": `${siteUrl}/feed.xml` },
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Manrope:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>
                <nav className="topbar">
                    <Link href="/" className="brand">
                        {siteName}
                    </Link>
                    <a href="/feed.xml" className="meta">
                        RSS
                    </a>
                </nav>
                <main className="shell">{children}</main>
                <footer className="foot">
                    <p className="meta">
                        Published with{" "}
                        <a href="https://github.com/BaryoDev/barakoCMS">barakoCMS</a>.
                    </p>
                </footer>
            </body>
        </html>
    );
}
