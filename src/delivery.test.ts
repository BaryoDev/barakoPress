import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { semantic } from "./delivery.js";

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
