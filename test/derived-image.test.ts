import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * A site builds a derived image FROM the published source image, so what is published has to be the
 * Dockerfile's `source` stage, for both architectures, and the recipe has to start from that image.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("the published source image", () => {
    const dockerfile = read("Dockerfile");
    const publish = read(".github/workflows/publish.yml");
    const recipe = read("examples/derived-image/Dockerfile");

    it("is a stage of the engine Dockerfile that the build stage starts from", () => {
        expect(dockerfile).toMatch(/^FROM node:22-alpine AS source$/m);
        expect(dockerfile).toMatch(/^FROM source AS build$/m);
    });

    it("is built for both architectures and pushed as barako-press-source", () => {
        const rows = publish.match(/image: barako-press-source, target: source, arch: (amd64|arm64)/g) ?? [];
        expect(rows).toHaveLength(2);
        expect(publish).toContain("target: ${{ matrix.target }}");
        expect(publish).toContain("ghcr.io/baryodev/${{ matrix.image }}");
    });

    it("gets a manifest list and an architecture check like the engine image", () => {
        expect(publish).toMatch(/for image in barako-press barako-press-source; do[\s\S]*imagetools create/);
        expect(publish).toMatch(/for image in barako-press barako-press-source; do[\s\S]*imagetools inspect/);
    });

    it("is what the derived image recipe builds from", () => {
        expect(recipe).toContain("FROM ghcr.io/baryodev/barako-press-source:${PRESS_VERSION} AS build");
        expect(recipe).toContain("node scripts/plugins.mjs /plugins");
        expect(recipe).toContain("npm run build");
    });

    it("ends in the same runtime stage as the engine Dockerfile", () => {
        const run = (text: string) => text.slice(text.indexOf("FROM node:22-alpine AS run"));
        const code = (text: string) => text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join("\n");
        expect(code(run(recipe))).toBe(code(run(dockerfile)));
    });
});
