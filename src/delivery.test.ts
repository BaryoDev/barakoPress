import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { forgetCachedReads, list, pageAtPath, redeemShareLink, semantic, tenantForHost } from "./delivery.js";

const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: "http://cms.invalid",
});

// Typed with the arguments fetch is actually called with, so a test can assert on the URL.
function answer(status: number, body: unknown) {
    return vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
            new Response(JSON.stringify(body), { status }),
    );
}

afterEach(() => vi.unstubAllGlobals());

/*
 * The three ways a CMS can decline this, all of them normal:
 *
 *   404  the AI module is not installed, or the type is not publicly deliverable
 *   200  with an empty list, the module is installed but ships inert until Ai:Enabled
 *   throw the CMS is unreachable
 *
 * None of them may take the post page down with it.
 */
describe("semantic", () => {
    it("returns the hits when the module answers", async () => {
        vi.stubGlobal(
            "fetch",
            answer(200, {
                results: [{ contentType: "post", slug: "a", title: "A", score: 0.8871 }],
                count: 1,
                query: "x",
            }),
        );

        const hits = await semantic(config, "post", "deploying with docker", 4);

        expect(hits).toHaveLength(1);
        expect(hits[0].score).toBe(0.8871);
    });

    it("gives back nothing when the type is not publicly deliverable", async () => {
        vi.stubGlobal("fetch", answer(404, {}));

        await expect(semantic(config, "doc", "deploying with docker", 4)).resolves.toEqual([]);
    });

    it("gives back nothing when the embedder is off", async () => {
        vi.stubGlobal("fetch", answer(200, { results: [], count: 0, query: "x" }));

        await expect(semantic(config, "post", "deploying with docker", 4)).resolves.toEqual([]);
    });

    it("gives back nothing when the CMS is unreachable", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("ECONNREFUSED");
            }),
        );

        await expect(semantic(config, "post", "deploying with docker", 4)).resolves.toEqual([]);
    });

    it("does not spend a request on a query the API would refuse", async () => {
        const fetchMock = answer(200, { results: [], count: 0, query: "" });
        vi.stubGlobal("fetch", fetchMock);

        await semantic(config, "post", " a ", 4);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a limit the API will accept", async () => {
        const fetchMock = answer(200, { results: [], count: 0, query: "x" });
        vi.stubGlobal("fetch", fetchMock);

        await semantic(config, "post", "docker", 50);

        // The API clamps to 20 itself. Asking for 50 anyway is a request that says one thing and
        // means another, and it is the sort of thing a later reader trusts.
        expect(String(fetchMock.mock.calls[0][0])).toContain("limit=20");
    });
});

describe("redeemShareLink", () => {
    const servers: Server[] = [];
    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
    });

    async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
        const server = createServer(handler);
        servers.push(server);
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    it("does not follow a redirect, so the key is never sent on to another server", async () => {
        const received: string[] = [];
        const elsewhere = await listen((req, res) => {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                received.push(body);
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));
            });
        });
        const cms = await listen((req, res) => {
            req.resume();
            res.writeHead(307, { location: `${elsewhere}/redeem` });
            res.end();
        });

        const config = { ...defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: cms }), tenant: "t" };
        const answer = await redeemShareLink(config, "share-key-for-tests-0123456789");

        expect(answer).toEqual({ kind: "failed" });
        expect(received).toEqual([]);
    });

    it("gives up on a CMS that stalls, and counts that as a failed redemption", async () => {
        const stall = new AbortController();
        const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(stall.signal);
        const fetchMock = vi.fn(
            (_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
                }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const config = { ...defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: "http://cms.test" }), tenant: "t" };
        const pending = redeemShareLink(config, "share-key-for-tests-0123456789");
        stall.abort(new DOMException("timed out", "TimeoutError"));

        expect(await pending).toEqual({ kind: "failed" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]?.signal).toBe(stall.signal);
        expect(timeout).toHaveBeenCalledTimes(1);
        expect(timeout.mock.calls[0][0]).toBeGreaterThan(0);
        expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(10_000);
    });
});

describe("reading from a CMS that stops answering", () => {
    const tenantConfig = { ...defineConfig({ sites: {}, cmsUrl: "http://cms.test", cmsTimeoutMs: 50 }), tenant: "baryo" };
    const posts = { items: [{ id: "p", data: { Title: "Kept" } }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false };

    afterEach(() => {
        forgetCachedReads();
        vi.restoreAllMocks();
    });

    /** A fetch that never answers, and gives up only when its signal aborts. */
    const hanging = () =>
        vi.fn(
            (_input: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
                }),
        );

    it("answers from the last good copy once the timeout passes, rather than waiting on the CMS", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal("fetch", answer(200, posts));
        await list(tenantConfig, "post");

        vi.stubGlobal("fetch", hanging());
        const started = Date.now();
        const read = await list(tenantConfig, "post");

        expect(read.items[0].data.Title).toBe("Kept");
        expect(Date.now() - started).toBeLessThan(1_000);
    }, 2_000);

    it("does not ask the CMS again for a read that just failed, until the marker expires", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal("fetch", answer(200, posts));
        await list(tenantConfig, "post");

        const down = vi.fn(async () => {
            throw new Error("ECONNREFUSED");
        });
        vi.stubGlobal("fetch", down);
        const first = await list(tenantConfig, "post");
        const second = await list(tenantConfig, "post");

        expect(first.items[0].data.Title).toBe("Kept");
        expect(second.items[0].data.Title).toBe("Kept");
        expect(down).toHaveBeenCalledTimes(1);

        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
        await list(tenantConfig, "post");
        expect(down).toHaveBeenCalledTimes(2);
    });

    it("gives up on a host lookup that never answers", async () => {
        vi.stubGlobal("fetch", hanging());
        await expect(tenantForHost(tenantConfig, "stalls.example")).rejects.toThrow();
    }, 2_000);
});

describe("pageAtPath", () => {
    it("reads a resolve body whose entry has no data as no page, rather than failing the render", async () => {
        vi.stubGlobal("fetch", answer(200, { contract: 1, path: "/x", entry: { contentType: "page" } }));
        await expect(pageAtPath(config, "/x")).resolves.toBeNull();
    });
});
