import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Asset, renderProse } from "./assets.js";
import { resolveTheme } from "./theme.js";
import { basePath, cookieName, cookiePath, normalizeBasePath, siteBaseUrl, siteWithBase, withBase, withoutBase } from "./base-path.js";
import { defineConfig } from "./config.js";
import { renderMarkdown } from "./markdown.js";
import { localPathOf } from "./site.js";
import { createRobots } from "./routes/robots.js";
import { servedUrl } from "./routes/served-url.js";

vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
    },
    cookies: async () => {
        throw new Error("cookies() was read");
    },
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
    },
}));

const BASE = "/kape-ana";
afterEach(() => {
    delete process.env.BASE_PATH;
});

describe("normalizeBasePath", () => {
    it("gives a leading slash and no trailing slash", () => {
        for (const raw of ["kape-ana", "/kape-ana", "/kape-ana/", " //kape-ana// ", "kape-ana/"]) {
            expect(normalizeBasePath(raw)).toBe(BASE);
        }
        expect(normalizeBasePath("/a/b/")).toBe("/a/b");
    });

    it("is empty for nothing, a bare slash or a value that could climb out", () => {
        for (const raw of [undefined, null, "", "  ", "/", "//", "/../x", "/a/./b", "/a\\b", "/a?x=1", "/a#x"]) {
            expect(normalizeBasePath(raw)).toBe("");
        }
    });
});

describe("with no BASE_PATH", () => {
    it("every helper returns its input", () => {
        expect(basePath()).toBe("");
        expect(withBase("/about")).toBe("/about");
        expect(withBase("/")).toBe("/");
        expect(withoutBase("/about")).toBe("/about");
        expect(siteBaseUrl("https://s.example")).toBe("https://s.example");
        expect(cookieName("__Host-press-share")).toBe("__Host-press-share");
        expect(cookiePath()).toBe("/");
    });
});

describe("with BASE_PATH", () => {
    it("reads the prefix from the environment, normalised", () => {
        process.env.BASE_PATH = "kape-ana/";
        expect(basePath()).toBe(BASE);
        expect(withBase("/about")).toBe("/kape-ana/about");
    });

    it("prefixes a path on this site and nothing else", () => {
        expect(withBase("/about", BASE)).toBe("/kape-ana/about");
        expect(withBase("/", BASE)).toBe("/kape-ana/");
        expect(withBase("/feed.xml?x=1#y", BASE)).toBe("/kape-ana/feed.xml?x=1#y");
        for (const same of ["https://elsewhere.test/a", "//cdn.test/a", "#top", "?q=1", "mailto:a@b.test", "relative/path"]) {
            expect(withBase(same, BASE)).toBe(same);
        }
    });

    it("does not prefix twice, and does not mistake a sibling prefix for its own", () => {
        expect(withBase("/kape-ana/about", BASE)).toBe("/kape-ana/about");
        expect(withBase("/kape-ana", BASE)).toBe("/kape-ana");
        expect(withBase("/kape-ana-two/about", BASE)).toBe("/kape-ana/kape-ana-two/about");
    });

    it("takes the prefix off for comparing against a route", () => {
        expect(withoutBase("/kape-ana/about", BASE)).toBe("/about");
        expect(withoutBase("/kape-ana", BASE)).toBe("/");
        expect(withoutBase("/kape-ana-two/x", BASE)).toBe("/kape-ana-two/x");
    });

    it("puts the prefix on the site address once", () => {
        expect(siteBaseUrl("https://s.example", BASE)).toBe("https://s.example/kape-ana");
        expect(siteBaseUrl("https://s.example/", BASE)).toBe("https://s.example/kape-ana");
        expect(siteBaseUrl("https://s.example/kape-ana", BASE)).toBe("https://s.example/kape-ana");
        expect(siteBaseUrl("", BASE)).toBe("");
    });

    it("moves the session cookie off __Host- and onto the prefix path", () => {
        expect(cookieName("__Host-press-share", BASE)).toBe("__Secure-press-share");
        expect(cookieName("press-other", BASE)).toBe("press-other");
        expect(cookiePath(BASE)).toBe(BASE);
    });

    it("carries identity links and local images under the prefix", () => {
        const site = siteWithBase(
            {
                logo: "/logo.svg",
                favicon: "https://cdn.test/f.png",
                headerLinks: [{ href: "/docs", children: [{ href: "/docs/a" }] }, { href: "https://elsewhere.test" }],
                headerActions: [{ href: "/join" }],
                topBar: { links: [{ href: "/news" }] },
                footerColumns: [{ links: [{ href: "/privacy" }] }],
                socialLinks: [{ href: "/about" }, { href: "https://facebook.com/x" }],
            },
            BASE,
        );
        expect(site.logo).toBe("/logo.svg");
        expect(site.favicon).toBe("https://cdn.test/f.png");
        expect(site.headerLinks?.map((l) => l.href)).toEqual(["/kape-ana/docs", "https://elsewhere.test"]);
        expect(site.headerLinks?.[0].children?.[0].href).toBe("/kape-ana/docs/a");
        expect(site.headerActions?.[0].href).toBe("/kape-ana/join");
        expect(site.topBar?.links[0].href).toBe("/kape-ana/news");
        expect(site.footerColumns?.[0].links[0].href).toBe("/kape-ana/privacy");
        expect(site.socialLinks?.map((l) => l.href)).toEqual(["/kape-ana/about", "https://facebook.com/x"]);
    });

    it("keeps an as-supplied logo as supplied under the prefix", () => {
        process.env.BASE_PATH = BASE;
        const theme = resolveTheme({ asSupplied: [{ url: "/logo.svg" }] });
        const out = renderToStaticMarkup(Asset({ src: "/logo.svg", alt: "L", theme }) as ReactElement);
        expect(out).toContain("data-as-supplied");
        expect(out).toContain('src="/kape-ana/logo.svg"');
    });

    it("leaves the identity as it was with no prefix", () => {
        const site = { logo: "/logo.svg", headerLinks: [{ href: "/docs" }] };
        expect(siteWithBase(site, "")).toBe(site);
    });
});

describe("the places that build a URL by hand", () => {
    const config = () => defineConfig({ site: { name: "S", url: "https://s.example" } });

    it("robots names the sitemap and the rules under the prefix", async () => {
        process.env.BASE_PATH = BASE;
        const withDisallow = defineConfig({ site: { name: "S", url: "https://s.example" }, robots: { disallow: ["/api/"] } });
        expect(await createRobots(withDisallow)()).toEqual({
            rules: { userAgent: "*", allow: "/kape-ana/", disallow: ["/kape-ana/api/"] },
            sitemap: "https://s.example/kape-ana/sitemap.xml",
        });
    });

    it("robots is unchanged with no prefix", async () => {
        expect(await createRobots(config())()).toEqual({
            rules: { userAgent: "*", allow: "/" },
            sitemap: "https://s.example/sitemap.xml",
        });
    });

    it("a sitemap or feed URL is the prefixed address plus the path", () => {
        expect(servedUrl(siteBaseUrl("https://s.example", BASE), "/blog/a")).toBe("https://s.example/kape-ana/blog/a");
    });

    it("a link to this site is recognised whether or not it carries the prefix", () => {
        process.env.BASE_PATH = BASE;
        expect(localPathOf("/about", "https://s.example/kape-ana")).toBe("/about");
        expect(localPathOf("https://s.example/kape-ana/about", "https://s.example/kape-ana")).toBe("/about");
    });

    it("markdown links and images to this site land inside the prefix", () => {
        process.env.BASE_PATH = BASE;
        const html = renderMarkdown("[About](/about) ![x](/pic.png) [Out](https://elsewhere.test/a)");
        expect(html).toContain('href="/kape-ana/about"');
        expect(html).toContain('src="/kape-ana/pic.png"');
        expect(html).toContain('href="https://elsewhere.test/a"');
    });

    it("a prose image registered under its prefixed path keeps its protection", () => {
        process.env.BASE_PATH = BASE;
        const theme = resolveTheme({ asSupplied: [{ url: "/kape-ana/logo.svg" }, { url: "/mark.svg" }] });
        const exact = renderProse("![x](/kape-ana/logo.svg)", theme);
        const plain = renderProse("![x](/mark.svg)", theme);
        const other = renderProse("![x](/other.svg)", theme);
        expect(exact).toContain("style=");
        expect(plain).toContain("style=");
        expect(other).not.toContain("style=");
    });

    it("markdown is unchanged with no prefix", () => {
        expect(renderMarkdown("[About](/about)")).toContain('href="/about"');
    });
});
