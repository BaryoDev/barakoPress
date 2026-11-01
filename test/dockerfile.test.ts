import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The image installs exactly what the lockfile names, and says so when it cannot. A silent fallback
 * to `npm install` would resolve fresh versions into the published image.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const installs = dockerfile.split("\n").filter((line) => /^RUN\b.*\bnpm (ci|install)\b/.test(line));

describe("the engine Dockerfile", () => {
    it("installs with npm ci in every stage that installs", () => {
        expect(installs.length).toBeGreaterThan(0);
        for (const line of installs) expect(line).toMatch(/\bnpm ci\b/);
    });

    it("has no fallback to npm install and does not hide the install's errors", () => {
        for (const line of installs) {
            expect(line).not.toMatch(/\bnpm install\b/);
            expect(line).not.toContain("||");
            expect(line).not.toContain("2>/dev/null");
        }
    });

    it("requires the lockfile to be copied", () => {
        const copies = dockerfile.split("\n").filter((line) => /^COPY package\.json /.test(line));
        expect(copies.length).toBeGreaterThan(0);
        for (const line of copies) expect(line).not.toContain("package-lock.json*");
    });

    it("has no stage nothing builds from", () => {
        expect(dockerfile).not.toMatch(/^FROM .* AS deps$/m);
    });

    it("declares a healthcheck in the runtime stage", () => {
        const run = dockerfile.slice(dockerfile.search(/^FROM .* AS run$/m));
        expect(run).toMatch(/^HEALTHCHECK\b/m);
    });
});
