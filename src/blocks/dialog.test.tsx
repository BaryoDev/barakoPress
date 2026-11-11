import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A `dialog` block (#254): a trigger and a native `<dialog>` holding the block's content, drawn once a
 * row of a `repeat`. The content is in the server's markup, so a reader with no script can still
 * reach it; the trigger is put away until a script can run it.
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
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { createPage } = await import("../screens/page.js");
const { createBlockRegistry } = await import("./registry.js");
const { dialogCss } = await import("./dialog-attrs.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const PACKAGES: Entry[] = [
    { id: "p1", slug: "auth", data: { Name: "Auth", Category: "Auth", Summary: "Sign in" } },
    { id: "p2", slug: "files", data: { Name: "Files", Category: "Storage", Summary: "Uploads" } },
    { id: "p3", slug: "sso", data: { Name: "SSO", Category: "Auth", Summary: "Single sign on" } },
];

const COLLECTIONS = { packages: { type: "package", fields: { title: "Name" } } };

let pages: Record<string, Entry> = {};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            return decodeURIComponent(byHost[1]) === "academy.example"
                ? Response.json({ handle: "academy" })
                : new Response("", { status: 404 });
        }
        if (tenant !== "academy") return new Response("", { status: 404 });
        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") {
            const labels = labelsOverride ? { Labels: labelsOverride } : {};
            return paged([{ id: "s", data: { Name: "Academy", Url: "https://academy.example", Collections: COLLECTIONS, ...labels } }]);
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "";
            const found = pages[path];
            return found
                ? Response.json({ contract: 2, path, entry: found, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 2, items: [] });
        const [type] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        if (type !== "package") return new Response("", { status: 404 });
        return paged(PACKAGES);
    });
}

let labelsOverride: Record<string, string> | undefined;
const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

beforeEach(() => {
    pages = {};
    labelsOverride = undefined;
    requestHeaders = null;
    forgetCachedReads();
    vi.stubGlobal("fetch", cms());
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function page(blocks: unknown[]): Promise<string> {
    pages["/about"] = { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Blocks: blocks } };
    requestHeaders = new Headers({ host: "academy.example" });
    const Page = createPage(config, registry);
    return html(await Page({ params: Promise.resolve({ path: ["about"] }), searchParams: Promise.resolve({}) }));
}

const text = (value: string) => ({ type: "text", props: { value } });
const dialog = (props: Record<string, unknown> = {}, content: unknown[] = [text("{{item.Summary}}")]) => ({
    type: "dialog",
    props: { trigger: "Details", ...props, content: [content] },
});
const repeat = (content: unknown[]) => ({ type: "repeat", props: { content: [content] } });
const source = (content: unknown[]) => ({ type: "source", props: { collection: "packages", mode: "list", pageSize: 50, content: [content] } });

describe("dialog markup", () => {
    it("draws a visible trigger that links to the row's own dialog, a closed dialog holding that row's content", async () => {
        const out = await page([source([repeat([dialog({ trigger: "More on {{item.Title}}" })])])]);

        expect(out.match(/<dialog /g)).toHaveLength(3);
        const ids = [...out.matchAll(/<dialog id="([^"]+)"/g)].map((m) => m[1]);
        // One id a dialog, never repeated, and each trigger points at its own.
        expect(new Set(ids).size).toBe(3);
        for (const id of ids) {
            expect(out).toContain(`<a id="${id}-open" href="#${id}" aria-haspopup="dialog" data-bp-dialog-open=""`);
            expect(out).toContain(`href="#${id}-open" data-bp-dialog-close=""`);
        }
        expect(out).not.toMatch(/data-bp-dialog-open="[^"]*"[^>]*\bhidden\b/);
        expect(out).toContain("More on SSO");
        // Each row's dialog holds that row's own bound text.
        const panels = [...out.matchAll(/<dialog [^>]*>(.*?)<\/dialog>/g)].map((m) => m[1]);
        expect(panels[0]).toContain("Sign in");
        expect(panels[0]).not.toContain("Uploads");
        expect(panels[1]).toContain("Uploads");
        expect(panels[2]).toContain("Single sign on");
        expect(out).not.toMatch(/<dialog [^>]*\bopen\b/);
        // One stylesheet for every row, hoisted by React rather than written once a dialog.
        expect(out.match(/data-bp-dialog-panel\]\{box-sizing/g)).toHaveLength(1);
    });

    it("gives two sources on one page no id in common", async () => {
        const out = await page([source([repeat([dialog()])]), source([repeat([dialog()])])]);

        const ids = [...out.matchAll(/<dialog id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids).toHaveLength(6);
        expect(new Set(ids).size).toBe(6);
    });

    it("names the dialog, from the label or else the trigger", async () => {
        const named = await page([source([repeat([dialog({ label: "About {{item.Title}}" })])])]);
        expect(named).toContain('aria-label="About Auth"');

        const bare = await page([source([repeat([dialog({ trigger: "More on {{item.Title}}" })])])]);
        expect(bare).toContain('aria-label="More on Files"');
    });

    it("closes with a link back to the trigger, so the close control works with no script", async () => {
        const out = await page([source([repeat([dialog()])])]);

        expect(out).toContain('data-bp-dialog-close=""');
        expect(out).toMatch(/data-bp-dialog-close="" [^>]*>Close<\/a>/);
    });

    it("says Close from the labels, and the block's own prop wins", async () => {
        labelsOverride = { dialogClose: "Sarado" };
        const labelled = await page([source([repeat([dialog()])])]);
        expect(labelled).toContain(">Sarado</a>");

        const own = await page([source([repeat([dialog({ closeLabel: "Done" })])])]);
        expect(own).toContain(">Done</a>");
    });

    it("carries the stylesheet: reduced motion, the target fallback and the backdrop, with no colour of its own", () => {
        const css = dialogCss();

        expect(css).toContain("@media (prefers-reduced-motion:no-preference)");
        expect(css).toContain("[data-bp-dialog-panel]:target:not([open]){display:block");
        expect(css).not.toContain("scripting");
        expect(css).toContain("::backdrop");
        // The backdrop takes its ink from the theme, through a variable the block sets.
        expect(css).toContain("var(--bp-dialog-ink)");
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        // Motion only inside the media query that allows it, which comes last.
        const before = css.slice(0, css.indexOf("@media (prefers-reduced-motion:no-preference)"));
        expect(before).not.toContain("animation");
        expect(before).not.toContain("transition");
    });

    it("reads its colours as theme variables, so a theme variant reaches the panel and the backdrop", async () => {
        const out = await page([dialog({}, [text("x")])]);

        expect(out).toMatch(/--bp-dialog-ink:var\(--bp-c-ink,#[0-9A-Fa-f]{6}\)/);
        expect(out).toMatch(/background:var\(--bp-c-surface,#[0-9A-Fa-f]{6}\)/);
    });

    it("wears recipes for the panel, the trigger and the close button", async () => {
        const out = await page([source([repeat([dialog({ recipe: "nobody", triggerRecipe: "nobody", closeRecipe: "nobody" })])])]);

        // A recipe the site does not have draws the block's own look.
        expect(out).toContain("<dialog");
        expect(out).toContain("data-bp-dialog-body");
    });

    it("works outside a repeat, once", async () => {
        const out = await page([dialog({}, [text("Plain content")])]);

        expect(out.match(/<dialog /g)).toHaveLength(1);
        expect(out).toContain("Plain content");
    });

    it("draws nothing when it has no trigger text", async () => {
        const out = await page([{ type: "dialog", props: { content: [[text("Hidden")]] } }]);

        expect(out).not.toContain("<dialog");
    });
});
