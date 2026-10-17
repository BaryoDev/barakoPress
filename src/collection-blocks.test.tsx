import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A collection's `blocksField`: the entry's own blocks, drawn on its detail page after the view.
 * A collection that sets none draws what it always did.
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

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { createCollectionDetail } = await import("./screens/collection.js");
const { createPage } = await import("./screens/page.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { defineBlock } = await import("./blocks/schema.js");

const CMS = "http://cms.test";
const BLOCKS = [{ type: "text", props: { value: "Open Monday to Friday" } }];
const PROFILES = { type: "profile", route: "/find", label: "Profiles", fields: { title: "Name", slug: "Slug", body: "Body" } };

const TENANTS: Record<string, { host: string; collection: Record<string, unknown>; data: Record<string, unknown> }> = {
    set: {
        host: "set.example",
        collection: { ...PROFILES, blocksField: "Blocks" },
        data: { Name: "Ana Cruz", Slug: "ana", Body: "Ana's page", Blocks: BLOCKS },
    },
    custom: {
        host: "custom.example",
        collection: { ...PROFILES, blocksField: "Blocks" },
        data: { Name: "Ana Cruz", Slug: "ana", Body: "Ana's page", Blocks: [{ type: "hours", props: {} }] },
    },
    unset: {
        host: "unset.example",
        collection: PROFILES,
        data: { Name: "Ana Cruz", Slug: "ana", Body: "Ana's page", Blocks: BLOCKS },
    },
    text: {
        host: "text.example",
        collection: { ...PROFILES, blocksField: "Blocks" },
        data: { Name: "Ana Cruz", Slug: "ana", Body: "Ana's page", Blocks: "not blocks" },
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") {
            return paged([{ id: "s", data: { Name: tenant, Url: `https://${t.host}`, Collections: { profiles: t.collection } } }]);
        }
        if (url.pathname === "/api/public/profile/ana") return Response.json({ id: "p1", slug: "ana", data: t.data });
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

async function detail(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Detail = createCollectionDetail(config, "profiles");
    const errors: unknown[] = [];
    const { prelude } = await prerender(await Detail({ params: Promise.resolve({ slug: "ana" }) }), {
        onError: (e) => void errors.push(e),
    });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const hours = defineBlock({ type: "hours", label: "Hours", fields: [], component: () => <p>consumer hours block</p> });

describe("a collection entry's blocks", () => {
    it("draws the blocks in the field blocksField names", async () => {
        const html = await detail("set.example");
        expect(html).toContain("Ana Cruz");
        expect(html).toContain("Open Monday to Friday");
    });

    it("draws no block text when blocksField is not set", async () => {
        const html = await detail("unset.example");
        expect(html).toContain("Ana Cruz");
        expect(html).not.toContain("Open Monday to Friday");
    });

    it("draws nothing, and does not throw, when the field is not a list of blocks", async () => {
        const html = await detail("text.example");
        expect(html).toContain("Ana Cruz");
        expect(html).not.toContain("not blocks");
    });
});

describe("a custom block on a collection entry", () => {
    it("renders from the registry the route was given, on the root catch-all and on the detail route", async () => {
        const registry = createBlockRegistry(config, [hours]);
        requestHeaders = new Headers({ host: "custom.example" });

        const Page = createPage(config, registry);
        const viaPage = await prerender(await Page({ params: Promise.resolve({ path: ["find", "ana"] }), searchParams: Promise.resolve({}) }));
        expect(await new Response(viaPage.prelude).text()).toContain("consumer hours block");

        const Detail = createCollectionDetail(config, "profiles", { blocks: registry });
        const viaDetail = await prerender(await Detail({ params: Promise.resolve({ slug: "ana" }) }));
        expect(await new Response(viaDetail.prelude).text()).toContain("consumer hours block");
    });
});
