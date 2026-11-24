import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import * as health from "../app/api/health/route";

/*
 * A healthcheck that fetches a page renders it. On a site pinned to one tenant, a check made before
 * barakoCMS serves that tenant renders a not-found, and Next serves that 404 from its render cache to
 * every visitor after. So every check asks for /api/health, which the proxy never rewrites and which
 * reads nothing from the CMS.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Runs a `node -e` healthcheck against a local server and returns the one path it asked for. */
async function asked(command: string, basePath: string): Promise<string> {
    expect(command).toContain("http://127.0.0.1:3000");
    const paths: string[] = [];
    const server = createServer((req, res) => {
        paths.push(req.url ?? "");
        res.end("ok");
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const { port } = server.address() as AddressInfo;
    try {
        // Rejects when the check exits non-zero, so a pass here is also a healthy container.
        await promisify(execFile)(process.execPath, ["-e", command.replace("127.0.0.1:3000", `127.0.0.1:${port}`)], {
            env: { BASE_PATH: basePath },
            timeout: 10_000,
        });
    } finally {
        server.close();
    }
    expect(paths).toHaveLength(1);
    return paths[0]!;
}

function dockerfileCheck(path: string): string {
    const text = read(path);
    const m = /^\s*CMD \["node", "-e", "(.*)"\]$/m.exec(text.slice(text.indexOf("HEALTHCHECK")));
    expect(m, `${path} has a node HEALTHCHECK`).not.toBeNull();
    return m![1]!;
}

function composeCheck(path: string, service: string): string {
    const text = read(path);
    const start = text.indexOf(`\n  ${service}:\n`);
    expect(start, `${path} has a ${service} service`).toBeGreaterThan(-1);
    const next = text.slice(start + 1).search(/\n  [a-z]+:\n/);
    const block = next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
    const m = /healthcheck:\s+test: \["CMD", "node", "-e", "(.*)"\]/.exec(block);
    expect(m, `${path} sets a node healthcheck on ${service}`).not.toBeNull();
    return m![1]!;
}

const CHECKS: [string, () => string][] = [
    ["Dockerfile", () => dockerfileCheck("Dockerfile")],
    ["examples/derived-image/Dockerfile", () => dockerfileCheck("examples/derived-image/Dockerfile")],
    ["compose.site.yml site", () => composeCheck("compose.site.yml", "site")],
    ["compose.yml site", () => composeCheck("compose.yml", "site")],
];

describe.each(CHECKS)("the %s healthcheck", (_, command) => {
    it("asks for /api/health and renders no page", async () => {
        expect(await asked(command(), "")).toBe("/api/health");
    });
});

// compose.yml sets no BASE_PATH on the site, so its check has no base path to follow.
describe.each(CHECKS.slice(0, 3))("the %s healthcheck under a base path", (_, command) => {
    it.each([
        ["blog", "/blog/api/health"],
        ["/blog/", "/blog/api/health"],
        [" /a/b ", "/a/b/api/health"],
    ])("BASE_PATH %j asks for %s", async (basePath, path) => {
        expect(await asked(command(), basePath)).toBe(path);
    });
});

describe("/api/health", () => {
    it("answers 200 and is never cached", async () => {
        expect(health.dynamic).toBe("force-dynamic");
        const res = health.GET();
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.text()).toBe("ok\n");
    });

    it("imports nothing, so it cannot read the CMS", () => {
        expect(read("app/api/health/route.ts")).not.toMatch(/^\s*import\b|\brequire\(|\bimport\(/m);
    });
});
