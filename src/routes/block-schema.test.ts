import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { createBlockRegistry } from "../blocks/registry.js";
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
        expect(body.blocks).toHaveLength(5);
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

describe("parseOrigins", () => {
    it("keeps http and https origins and drops anything else", () => {
        expect(parseOrigins("https://Brew.Example:443/, http://localhost:3000,*,null,ftp://x.example,https://a.example/path,")).toEqual([
            "https://brew.example",
            "http://localhost:3000",
        ]);
    });
});
