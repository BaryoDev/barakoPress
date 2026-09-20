import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Assets used exactly as supplied (#29).
 *
 * The test that matters is `every path an image is drawn through`. A mark that must not be
 * recoloured, outlined, boxed or crowded is protected in the header and broken in a card, and the
 * breakage looks like a nice touch, so a rule kept in four of five places is worth very little. The
 * list below is meant to hold every path, and the source scan under it fails when a new one appears
 * that does not go through `Asset`.
 */

let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { NO_TREATMENT, renderProse, suppliedAssetOn } = await import("./assets.js");
const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { applySiteSettings } = await import("./site.js");
const { resolveTheme } = await import("./theme.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { BlockList } = await import("./blocks/render.js");
const { resolveBlocks } = await import("./blocks/schema.js");
const { bindBlocks } = await import("./blocks/bind.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { PostView } = await import("./screens/post-view.js");
const { ItemView } = await import("./screens/collection.js");
import type { Item } from "./collections.js";
import type { Post } from "./cms.js";
import type { PressConfig } from "./config.js";
import type { PressTheme } from "./theme.js";

/** A mark with an identity manual behind it. Any client's: nothing here knows whose. */
const MARK = "https://files.test/signature.svg";
/** An image with no manual, which keeps the look the theme gives it. */
const PHOTO = "https://files.test/photo.jpg";

const config = defineConfig({
    site: {
        name: "The club",
        url: "https://club.example",
        logo: MARK,
        footerLogo: MARK,
        logoAlt: "The club signature",
    },
    theme: { asSupplied: [{ url: MARK, clearSpace: "lg" }] },
});

/** The clear space the fixture asks for, in the theme's own terms. */
const CLEAR = config.theme.space.lg;

/* --------------------------------------------------------- reading the drawn mark */

function declarationsOf(tag: string): Map<string, string> {
    const style = /style="([^"]*)"/.exec(tag)?.[1] ?? "";
    return new Map(
        style
            .split(";")
            .filter(Boolean)
            .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
    );
}

/**
 * The mark as it was drawn: its own tag, and the box holding its clear space when there is one.
 * The markdown path has no box, because there the image is a string of HTML and not a component.
 */
function drawn(html: string, src: string = MARK): { tag: string; img: Map<string, string>; box: Map<string, string> } {
    const at = html.indexOf(`src="${src}`);
    expect(at, `no image with src ${src} was drawn`).toBeGreaterThan(-1);
    const start = html.lastIndexOf("<img", at);
    const tag = html.slice(start, html.indexOf(">", at) + 1);

    const boxStart = html.lastIndexOf("<span data-as-supplied", start);
    const boxTag = boxStart === -1 ? "" : html.slice(boxStart, html.indexOf(">", boxStart) + 1);
    // Only the box it sits directly inside counts, not one further up the page.
    const holds = boxTag !== "" && html.slice(boxStart + boxTag.length, start).trim() === "";

    return { tag, img: declarationsOf(tag), box: holds ? declarationsOf(boxTag) : new Map() };
}

/** Fails unless the mark carries no treatment at all and keeps its clear space. */
function expectAsSupplied(html: string, clearSpace: string = CLEAR, src: string = MARK): void {
    const { tag, img, box } = drawn(html, src);

    for (const [name, value] of Object.entries(NO_TREATMENT)) {
        const property = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        expect(img.get(property), `${property} on the mark`).toBe(String(value));
        if (box.size > 0) expect(box.get(property), `${property} on the clear space`).toBe(String(value));
    }

    // Nothing of the theme's own look reached it, said in the theme's terms rather than in CSS.
    expect(tag).not.toContain(config.theme.radii.panel);
    expect(tag).not.toContain(config.theme.colors.hairline);
    expect(tag).not.toContain(config.theme.colors.accentTint);

    const space = box.size > 0 ? box : img;
    expect(space.get("padding"), "the clear space").toBe(clearSpace);
    // Held at any width: the padding is inside the width the caller asked for, so a phone shrinks
    // the mark rather than the space around it.
    expect(space.get("box-sizing")).toBe("border-box");
    expect(space.get("max-width")).toBe("100%");
}

/* ------------------------------------------------------------------ the paths */

/** A stored page, resolved, bound and drawn, exactly as the page route does it. */
async function blocks(raw: unknown, cfg: PressConfig = config): Promise<string> {
    const registry = createBlockRegistry(cfg);
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config: cfg, registry, scopes: {} });
    return renderToStaticMarkup(<BlockList blocks={bound} theme={cfg.theme} />);
}

/** A render that waits on async components. A render error is thrown rather than streamed past. */
async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

const REGION_PAGES: Record<string, unknown> = {
    "/site/header": {
        id: "h",
        slug: "header",
        data: {
            Title: "Header",
            Blocks: [{ type: "image", props: { src: MARK, alt: "The club signature", radius: "pill" } }],
        },
    },
    "/site/footer": {
        id: "f",
        slug: "footer",
        data: {
            Title: "Footer",
            Blocks: [
                {
                    type: "panel",
                    props: {
                        tone: "accent",
                        content: [[{ type: "image", props: { src: MARK, alt: "The club signature" } }]],
                    },
                },
            ],
        },
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const entry = REGION_PAGES[path];
            return entry
                ? Response.json({ contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        return new Response("", { status: 404 });
    });
}

async function layout(cfg: PressConfig): Promise<string> {
    const Layout = createSiteLayout(cfg, { loadFonts: false });
    return render(await Layout({ children: <p>the page</p> }));
}

const post = (body: string, coverImage?: string): Post => ({
    id: "p1",
    slug: "a-post",
    title: "A post",
    body,
    featured: false,
    tags: [],
    ...(coverImage ? { coverImage, coverImageAlt: "The club signature" } : {}),
});

const item = (body: string, image?: string): Item => ({
    id: "i1",
    collection: "projects",
    slug: "a-project",
    title: "A project",
    body,
    featured: false,
    tags: [],
    refs: {},
    content: { id: "i1", data: {} },
    ...(image ? { image, imageAlt: "The club signature" } : {}),
});

const markdown = `A line.\n\n![The club signature](${MARK})\n`;

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("every path an image is drawn through", () => {
    it("draws it as supplied in a block, whatever the block asked for", async () => {
        const html = await blocks([{ type: "image", props: { src: MARK, alt: "x", radius: "panel", frame: true } }]);
        expectAsSupplied(html);
    });

    it("draws it as supplied through a preset, which asks for a corner of its own", async () => {
        const html = await blocks([
            { type: "hero", props: { heading: "Welcome", image: MARK, imageAlt: "The club signature" } },
        ]);
        expectAsSupplied(html);
    });

    it("draws it as supplied in the built-in header", async () => {
        const html = await layout(config);
        expectAsSupplied(html.slice(0, html.indexOf("<main>")));
    });

    it("draws it as supplied in the built-in footer", async () => {
        const html = await layout(config);
        expectAsSupplied(html.slice(html.indexOf("</main>")));
    });

    it("draws it as supplied on the holding page", async () => {
        const held = { ...config, holding: { message: "Back on Monday." } };
        expectAsSupplied(await layout(held));
    });

    it("draws it as supplied in a header region", async () => {
        const banded = { ...config, regions: { header: { path: "/site/header" as const } } };
        const html = await layout(banded);
        expectAsSupplied(html.slice(0, html.indexOf("<main>")));
    });

    it("draws it as supplied in a footer region, tinted panel and all", async () => {
        const banded = { ...config, regions: { footer: { path: "/site/footer", tone: "inverse" as const } } };
        const html = await layout(banded);
        expectAsSupplied(html.slice(html.indexOf("</main>")));
    });

    it("draws it as supplied as a post's cover", () => {
        expectAsSupplied(renderToStaticMarkup(<PostView config={config} post={post("Words.", MARK)} />));
    });

    it("draws it as supplied as a collection item's image", () => {
        expectAsSupplied(renderToStaticMarkup(<ItemView config={config} item={item("Words.", MARK)} />));
    });

    it("draws it as supplied inside markdown, where the prose stylesheet would frame it", async () => {
        expectAsSupplied(renderProse(markdown, config.theme));
        expectAsSupplied(await blocks([{ type: "richText", props: { markdown } }]));
        expectAsSupplied(renderToStaticMarkup(<PostView config={config} post={post(markdown)} />));
        expectAsSupplied(renderToStaticMarkup(<ItemView config={config} item={item(markdown)} />));
    });

    it("draws every image through the one component that keeps the rule", () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) walk(path);
                else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
            }
        };
        walk("src");

        // markdown.ts writes the tag as text, which renderProse styles on the way past.
        const allowed = new Set([join("src", "assets.tsx"), join("src", "markdown.ts")]);
        const drawing = files.filter((f) => !allowed.has(f) && readFileSync(f, "utf8").includes("<img"));

        expect(files.length).toBeGreaterThan(20);
        expect(drawing, "these draw an image without going through Asset").toEqual([]);
    });
});

describe("an asset nobody marked", () => {
    it("keeps the look the theme gives it", async () => {
        const html = await blocks([{ type: "image", props: { src: PHOTO, alt: "x" } }]);
        const { tag } = drawn(html, PHOTO);

        expect(tag).toContain(`border-radius:${config.theme.radii.panel}`);
        expect(tag).toContain(`border:1px solid ${config.theme.colors.hairline}`);
        expect(html).not.toContain("data-as-supplied");
    });

    it("keeps the frame the prose stylesheet gives it in markdown", () => {
        const html = renderProse(`![a photo](${PHOTO})`, config.theme);
        expect(html).toBe(`<p><img src="${PHOTO}" alt="a photo" loading="lazy"></p>\n`);
    });
});

describe("marking an asset", () => {
    const theme = (): PressTheme => resolveTheme({ asSupplied: [{ url: MARK, clearSpace: "sm" }] });

    it("matches the mark however the CMS resized it", () => {
        expect(suppliedAssetOn(theme(), `${MARK}?w=480`)).toEqual({ url: `${MARK}?w=480`, clearSpace: "sm" });
        expect(suppliedAssetOn(theme(), PHOTO)).toBeUndefined();
    });

    it("takes a block's own marking for an asset the site did not list", () => {
        expect(suppliedAssetOn(theme(), PHOTO, { asSupplied: true, clearSpace: "xl" })).toEqual({
            url: PHOTO,
            clearSpace: "xl",
        });
        expect(suppliedAssetOn(theme(), PHOTO, { asSupplied: false })).toBeUndefined();
    });

    it("keeps the wider clear space, because the site's is a minimum", () => {
        expect(suppliedAssetOn(theme(), MARK, { clearSpace: "xxl" })?.clearSpace).toBe("xxl");
        expect(suppliedAssetOn(theme(), MARK, { clearSpace: "xs" })?.clearSpace).toBe("sm");
        expect(suppliedAssetOn(theme(), MARK, { clearSpace: "nonsense" })?.clearSpace).toBe("sm");
    });

    it("honours a block that marks its own image, with the space it asked for", async () => {
        const plain = defineConfig({ site: { name: "T", url: "https://t.example" } });
        const html = await blocks(
            [{ type: "image", props: { src: PHOTO, radius: "panel", asSupplied: true, clearSpace: "xl" } }],
            plain,
        );
        expectAsSupplied(html, plain.theme.space.xl, PHOTO);
    });
});

describe("reading the setting", () => {
    const base = { ...config, tenant: "t", theme: resolveTheme({}) };
    const supplied = (d: Record<string, unknown>) => applySiteSettings(base, d, null).theme.asSupplied;

    it("reads a list of URLs, and a clear space where one is written", () => {
        expect(supplied({ AssetsAsSupplied: [MARK, { url: PHOTO, clearSpace: "xl" }] })).toEqual([
            { url: MARK },
            { url: PHOTO, clearSpace: "xl" },
        ]);
    });

    it("drops an entry that is not a URL this site would serve, and a space that is not one", () => {
        expect(supplied({ AssetsAsSupplied: ["javascript:alert(1)", 7, { url: MARK, clearSpace: "huge" }] })).toEqual([
            { url: MARK },
        ]);
    });

    it("marks both logos when the tenant says the logo is used as supplied", () => {
        const d = { Logo: MARK, FooterLogo: PHOTO, LogoAsSupplied: true, LogoClearSpace: "xl" };
        expect(supplied(d)).toEqual([
            { url: MARK, clearSpace: "xl" },
            { url: PHOTO, clearSpace: "xl" },
        ]);
    });

    it("leaves a site that says nothing exactly as it was", () => {
        expect(supplied({})).toEqual([]);
        expect(applySiteSettings({ ...config, tenant: "t" }, {}, null).theme.asSupplied).toEqual(
            config.theme.asSupplied,
        );
    });
});
