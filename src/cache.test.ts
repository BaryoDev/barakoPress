import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PressStore } from "./store.js";

/*
 * What a purge drops, and where the state that decides it lives (#56, #57).
 *
 * Both need a stand-in for Next's data cache, because both are about which read is answered from a
 * cache and which one reaches the CMS. Each container below keeps its own, the way Next does with no
 * shared cache handler, and drops an entry when a tag it was stored under is purged. The CMS behind
 * them is one server whose entries can be edited between reads, so a stale answer is visible as the
 * old title rather than as a count.
 */

/** The container whose data cache this test is currently reading and purging through. */
let active: Container;

vi.mock("next/cache", () => ({ revalidateTag: (tag: string) => active.dropTag(tag) }));

const CMS = "http://cms.test";
const HOST = "baryo.example";
const SECRET = "a-press-secret-for-cache-tests-0123456789";

/** The CMS both containers read, and the only place an entry is actually edited. */
const entries: Record<string, string> = { alpha: "Alpha", beta: "Beta" };
let cmsReads = 0;

function cmsAnswer(url: URL): Response {
    cmsReads += 1;
    const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
    if (byHost) return decodeURIComponent(byHost[1]) === HOST ? Response.json({ handle: "baryo" }) : new Response("", { status: 404 });

    const paged = (items: unknown[]) =>
        Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
    const entry = (slug: string) => ({ id: slug, slug, data: { Title: entries[slug], Slug: slug, Body: "x" } });

    if (url.pathname === "/api/public/post") return paged(Object.keys(entries).map(entry));
    const one = url.pathname.match(/^\/api\/public\/post\/(.+)$/);
    if (one && entries[one[1]]) return Response.json(entry(one[1]));
    // A type the API answers uncached: a booking slot, a live count, a draft.
    if (url.pathname === "/api/public/slot") {
        return new Response(JSON.stringify({ items: [{ id: "s", data: { Title: entries.alpha } }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false }), {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
    }
    return new Response("", { status: 404 });
}

type Container = Awaited<ReturnType<typeof startContainer>>;

/**
 * One renderer process: its own module state, its own data cache, and the store it was configured
 * with. Two of these with one store is a deployment running two replicas.
 */
async function startContainer(store?: PressStore) {
    vi.resetModules();
    const { defineConfig } = await import("./config.js");
    const { list, bySlug } = await import("./delivery.js");
    const { createRevalidateRoute } = await import("./routes/revalidate.js");

    const held = new Map<string, { body: string; tags: string[] }>();
    const requests: RequestInit[] = [];

    const fetchMock = async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        requests.push(init ?? {});
        const tags = init?.next?.tags;
        const key = url.toString();
        if (tags) {
            const stored = held.get(key);
            if (stored) return new Response(stored.body, { headers: { "content-type": "application/json" } });
        }
        const res = cmsAnswer(url);
        if (!res.ok) return res;
        const body = await res.text();
        if (tags) held.set(key, { body, tags });
        return new Response(body, { headers: res.headers });
    };

    const config = defineConfig({ sites: {}, cmsUrl: CMS, ...(store ? { store } : {}) });
    const container = {
        config,
        requests,
        held,
        fetchMock,
        dropTag(tag: string) {
            for (const [key, stored] of held) if (stored.tags.includes(tag)) held.delete(key);
        },
        async posts() {
            const res = await list({ ...config, tenant: "baryo" }, "post");
            return res.items.map((item) => item.data.Title);
        },
        async post(slug: string) {
            const res = await bySlug({ ...config, tenant: "baryo" }, "post", slug);
            return res?.data.Title;
        },
        async slots() {
            const res = await list({ ...config, tenant: "baryo" }, "slot");
            return res.items[0].data.Title;
        },
        async tenantFor(host: string) {
            const { tenantForHost } = await import("./delivery.js");
            return tenantForHost(config, host);
        },
        async deliver(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
            const { revalidateKeyFor } = await import("./revalidate-key.js");
            const key = revalidateKeyFor(SECRET, "baryo");
            const signature = "sha256=" + createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
            const request = new Request("http://internal/api/revalidate", {
                method: "POST",
                headers: { host: HOST, "content-type": "application/json", "x-barako-timestamp": timestamp, "x-barako-signature": signature },
                body,
            }) as unknown as NextRequest;
            const { POST } = createRevalidateRoute(config, { secret: SECRET });
            return (await POST(request)).json() as Promise<{ revalidated?: boolean; repeated?: boolean; tags?: string[] }>;
        },
    };
    return container;
}

/** Runs against one container: its data cache answers its reads, and its purges drop its entries. */
async function on<T>(container: Container, run: () => Promise<T>): Promise<T> {
    active = container;
    vi.stubGlobal("fetch", container.fetchMock);
    return run();
}

const published = (slug: string) => JSON.stringify({ contentId: slug, contentType: "post", status: "Published", data: { Title: entries[slug], Slug: slug } });

beforeEach(() => {
    entries.alpha = "Alpha";
    entries.beta = "Beta";
    cmsReads = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("PRESS_SECRET", undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("a purge drops what changed", () => {
    it("re-reads the edited entry and its lists, and leaves an unrelated entry cached", async () => {
        const app = await startContainer();
        await on(app, async () => {
            expect(await app.post("alpha")).toBe("Alpha");
            expect(await app.post("beta")).toBe("Beta");
            expect(await app.posts()).toEqual(["Alpha", "Beta"]);
            expect(cmsReads).toBe(3);

            // Every read is cached now, so nothing below reaches the CMS unless its tag was dropped.
            await app.post("alpha");
            await app.post("beta");
            await app.posts();
            expect(cmsReads).toBe(3);

            entries.alpha = "Alpha, corrected";
            entries.beta = "Beta, edited behind the cache";
            const answer = await app.deliver(published("alpha"));

            expect(answer.revalidated).toBe(true);
            expect(answer.tags).toEqual(["cms:baryo:type:post", "cms:baryo:entry:post:alpha"]);

            const before = cmsReads;
            expect(await app.post("alpha")).toBe("Alpha, corrected");
            expect(await app.posts()).toEqual(["Alpha, corrected", "Beta, edited behind the cache"]);
            expect(cmsReads).toBe(before + 2);

            // The entry nobody published is still the copy this container had.
            expect(await app.post("beta")).toBe("Beta");
            expect(cmsReads).toBe(before + 2);
        });
    });

    it("drops the whole tenant when the delivery does not say what changed", async () => {
        const app = await startContainer();
        await on(app, async () => {
            await app.post("alpha");
            await app.post("beta");
            entries.alpha = "Alpha, corrected";
            entries.beta = "Beta, corrected";

            const answer = await app.deliver(JSON.stringify({ event: "Published" }));
            expect(answer.tags).toEqual(["cms:baryo"]);

            expect(await app.post("alpha")).toBe("Alpha, corrected");
            expect(await app.post("beta")).toBe("Beta, corrected");
        });
    });
});

describe("the cache class the API declares", () => {
    it("never answers a no-store read from a cache, and leaves every other read cached", async () => {
        const app = await startContainer();
        await on(app, async () => {
            expect(await app.slots()).toBe("Alpha");
            expect(await app.posts()).toEqual(["Alpha", "Beta"]);
            const cached = cmsReads;

            entries.alpha = "Alpha, a minute later";

            // The slot read is the CMS's answer every time. The post list is the cached one, since
            // the API said nothing about it.
            expect(await app.slots()).toBe("Alpha, a minute later");
            expect(await app.slots()).toBe("Alpha, a minute later");
            expect(await app.posts()).toEqual(["Alpha", "Beta"]);
            expect(cmsReads).toBe(cached + 2);

            // Once the class is known the read is uncached, and carries no tag for a purge to drop.
            const uncached = app.requests.filter((init) => (init as { cache?: string }).cache === "no-store");
            expect(uncached).toHaveLength(2);
        });
    });
});

describe("two containers", () => {
    const shared = (): PressStore => {
        const held = new Map<string, string>();
        return {
            async get(key) {
                return held.get(key) ?? null;
            },
            async set(key, value) {
                held.set(key, value);
            },
            async delete(key) {
                held.delete(key);
            },
            async add(key, value) {
                if (held.has(key)) return false;
                held.set(key, value);
                return true;
            },
        };
    };

    it("serves the corrected entry from the container the purge never reached", async () => {
        const store = shared();
        const one = await startContainer(store);
        const two = await startContainer(store);

        await on(one, () => one.post("alpha"));
        expect(await on(two, () => two.post("alpha"))).toBe("Alpha");

        entries.alpha = "Alpha, corrected";
        // The load balancer sends the delivery to one container. The other is never told.
        await on(one, () => one.deliver(published("alpha")));

        expect(await on(one, () => one.post("alpha"))).toBe("Alpha, corrected");
        expect(await on(two, () => two.post("alpha"))).toBe("Alpha, corrected");
    });

    it("keeps serving the old copy when each container has a store of its own", async () => {
        const one = await startContainer();
        const two = await startContainer();

        await on(one, () => one.post("alpha"));
        await on(two, () => two.post("alpha"));

        entries.alpha = "Alpha, corrected";
        await on(one, () => one.deliver(published("alpha")));

        expect(await on(one, () => one.post("alpha"))).toBe("Alpha, corrected");
        // What #57 is about: nothing shared, so the second container answers its own copy until the
        // backstop runs out.
        expect(await on(two, () => two.post("alpha"))).toBe("Alpha");
    });

    it("honours a replayed delivery once across both, and twice when they share nothing", async () => {
        const store = shared();
        const one = await startContainer(store);
        const two = await startContainer(store);
        const body = published("alpha");
        const timestamp = String(Math.floor(Date.now() / 1000));

        expect(await on(one, () => one.deliver(body, timestamp))).toMatchObject({ revalidated: true });
        expect(await on(two, () => two.deliver(body, timestamp))).toEqual({ revalidated: true, repeated: true });

        const apart = [await startContainer(), await startContainer()];
        expect(await on(apart[0], () => apart[0].deliver(body, timestamp))).toMatchObject({ revalidated: true });
        const again = await on(apart[1], () => apart[1].deliver(body, timestamp));
        expect(again.revalidated).toBe(true);
        expect(again.repeated).toBeUndefined();
    });

    it("answers a host the other container already resolved without asking the CMS", async () => {
        const store = shared();
        const one = await startContainer(store);
        const two = await startContainer(store);

        expect(await on(one, () => one.tenantFor(HOST))).toBe("baryo");
        const asked = cmsReads;
        expect(await on(two, () => two.tenantFor(HOST))).toBe("baryo");
        expect(cmsReads).toBe(asked);
    });
});
