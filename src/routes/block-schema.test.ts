import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { createBlockRegistry } from "../blocks/registry.js";
import { MAX_BLOCKS, MAX_DEPTH } from "../blocks/schema.js";
import { createBlockSchemaPreflight, createBlockSchemaRoute, parseOrigins } from "./block-schema.js";

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });
const registry = createBlockRegistry(config);
const CONSOLE = "https://brew.example";

const from = (origin?: string, method = "GET") =>
    new Request("https://site.example/api/blocks", { method, headers: origin ? { origin } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("the block schema route across origins", () => {
    it("lets a listed origin read the schema, without credentials", async () => {
        const GET = createBlockSchemaRoute(registry, { consoleOrigins: [CONSOLE] });
        const res = GET(from(CONSOLE));

        expect(res.headers.get("access-control-allow-origin")).toBe(CONSOLE);
        expect(res.headers.get("access-control-allow-credentials")).toBeNull();
        expect(res.headers.get("vary")).toBe("Origin");
        const body = (await res.json()) as { blocks: unknown[] };
        expect(body.blocks).toHaveLength(registry.size);
    });

    it("gives an unlisted origin the schema with no CORS header, so a browser keeps it from the page", () => {
        const GET = createBlockSchemaRoute(registry, { consoleOrigins: [CONSOLE] });

        for (const origin of ["https://evil.example", "https://brew.example.evil.example", "http://brew.example", "null"]) {
            const res = GET(from(origin));
            expect(res.headers.get("access-control-allow-origin")).toBeNull();
            expect(res.headers.get("vary")).toBe("Origin");
        }
    });

    it("allows no origin when nothing is configured", () => {
        vi.stubEnv("PRESS_CONSOLE_ORIGINS", "");
        const res = createBlockSchemaRoute(registry)(from(CONSOLE));
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        expect(res.headers.get("vary")).toBe("Origin");
    });

    it("reads PRESS_CONSOLE_ORIGINS per request, not when the route is created", () => {
        const GET = createBlockSchemaRoute(registry);
        vi.stubEnv("PRESS_CONSOLE_ORIGINS", `https://other.example, ${CONSOLE}/`);

        expect(GET(from(CONSOLE)).headers.get("access-control-allow-origin")).toBe(CONSOLE);
        expect(GET(from("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
    });

    it("still answers a call with no request, as the route did before", async () => {
        const res = createBlockSchemaRoute(registry)();
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("answers the preflight for a listed origin only", () => {
        const OPTIONS = createBlockSchemaPreflight({ consoleOrigins: [CONSOLE] });

        const listed = OPTIONS(from(CONSOLE, "OPTIONS"));
        expect(listed.status).toBe(204);
        expect(listed.headers.get("access-control-allow-origin")).toBe(CONSOLE);
        expect(listed.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
        expect(listed.headers.get("access-control-allow-credentials")).toBeNull();
        expect(listed.headers.get("vary")).toBe("Origin");

        const unlisted = OPTIONS(from("https://evil.example", "OPTIONS"));
        expect(unlisted.headers.get("access-control-allow-origin")).toBeNull();
        expect(unlisted.headers.get("access-control-allow-methods")).toBeNull();
        expect(unlisted.headers.get("vary")).toBe("Origin");
    });
});

describe("what the block schema says about the renderer", () => {
    type Published = {
        limits?: { maxBlocks: number; maxDepth: number };
        theme?: { colorSlots: string[]; colorAliases: Record<string, string>; fontRoles: string[] };
    };

    it("publishes the block budget and depth the renderer reads, not a copy of them", async () => {
        const body = (await createBlockSchemaRoute(registry)().json()) as Published;

        expect(body.limits).toEqual({ maxBlocks: MAX_BLOCKS, maxDepth: MAX_DEPTH });
        // The console's copy says 100 and 4. These are what a page is actually cut at.
        expect(body.limits).toEqual({ maxBlocks: 400, maxDepth: 10 });
    });

    it("publishes the colour slots by role, the old names beside them, and the font roles", async () => {
        const res = await createBlockSchemaRoute(config, registry)(from());
        const { theme } = (await res.json()) as Published;

        expect(theme?.colorSlots).toHaveLength(19);
        expect(theme?.colorSlots).toEqual(expect.arrayContaining(["pageBg", "inverse", "inverseChrome", "code", "success"]));
        expect(theme?.colorSlots).not.toContain("darkPanel");
        expect(theme?.colorSlots).not.toContain("codeGreen");
        expect(Object.keys(theme?.colorAliases ?? {})).toHaveLength(6);
        expect(theme?.colorAliases).toMatchObject({ darkPanel: "inverse", codeGreen: "code" });
        expect(theme?.fontRoles).toEqual(["heading", "body", "mono"]);
    });
});

describe("parseOrigins", () => {
    it("keeps http and https origins and drops anything else", () => {
        expect(parseOrigins("https://Brew.Example:443/, http://localhost:3000,*,null,ftp://x.example,https://a.example/path,")).toEqual([
            "https://brew.example",
            "http://localhost:3000",
        ]);
    });
});
