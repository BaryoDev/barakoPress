import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * scripts/plugins.mjs, run the way the Dockerfile runs it, in a checkout of its own: a package.json, a
 * lockfile and a node_modules holding `react`. The tarballs are packed here, so nothing is fetched.
 */
const SCRIPT = resolve("scripts/plugins.mjs");

let root: string;
let plugins: string;

function pack(name: string, manifest: Record<string, unknown> = {}, files: Record<string, string> = {}): void {
    const src = mkdtempSync(join(tmpdir(), "plugin-src-"));
    const pkg = join(src, "package");
    mkdirSync(pkg);
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js", ...manifest }));
    writeFileSync(join(pkg, "index.js"), "export default { name: 'x', blocks: [] };\n");
    for (const [path, body] of Object.entries(files)) {
        mkdirSync(join(pkg, path, ".."), { recursive: true });
        writeFileSync(join(pkg, path), body);
    }
    execFileSync("tar", ["-czf", join(plugins, `${name.replace("/", "-")}.tgz`), "-C", src, "package"]);
    rmSync(src, { recursive: true, force: true });
}

function run(dir = plugins) {
    const out = spawnSync(process.execPath, [SCRIPT, dir], { cwd: root, encoding: "utf8" });
    return { status: out.status, output: out.stdout + out.stderr };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "plugin-install-"));
    plugins = join(root, "plugins");
    mkdirSync(plugins);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "barakopress", version: "0.0.0", type: "module" }));
    writeFileSync(
        join(root, "package-lock.json"),
        JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/react": { version: "19.0.0" }, "node_modules/next": {} } }),
    );
    mkdirSync(join(root, "node_modules", "react"), { recursive: true });
    writeFileSync(join(root, "node_modules", "react", "package.json"), JSON.stringify({ name: "react" }));
    mkdirSync(join(root, "node_modules", "on-disk-only"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installing plugin tarballs", () => {
    it("refuses a plugin named like a package the engine already resolves, and leaves that package alone", () => {
        for (const name of ["react", "next", "on-disk-only", "barakopress"]) {
            rmSync(plugins, { recursive: true, force: true });
            mkdirSync(plugins);
            pack(name);
            const { status, output } = run();
            expect(status).toBe(1);
            expect(output).toContain(`"${name}" is a name the engine already uses`);
        }
        expect(lstatSync(join(root, "node_modules", "react")).isSymbolicLink()).toBe(false);
        expect(existsSync(join(root, ".press-plugins"))).toBe(false);
    });

    it("refuses a plugin whose dependencies would be fetched at build time rather than bundled", () => {
        pack("fetches-things", { dependencies: { "left-pad": "^1.3.0" }, optionalDependencies: { chalk: "5" } });
        const { status, output } = run();
        expect(status).toBe(1);
        expect(output).toContain("depends on left-pad, chalk without bundling it");
        expect(existsSync(join(root, ".press-plugins"))).toBe(false);
    });

    it("installs a plugin whose dependencies are bundled, offline, and a second run takes out what the first linked", () => {
        pack(
            "bundles-things",
            { dependencies: { "tiny-dep": "1.0.0" }, bundleDependencies: ["tiny-dep"] },
            { "node_modules/tiny-dep/package.json": JSON.stringify({ name: "tiny-dep", version: "1.0.0" }) },
        );
        const first = run();
        expect(first.output).toContain("plugins: installed bundles-things");
        expect(first.status).toBe(0);
        const link = join(root, "node_modules", "bundles-things");
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(existsSync(join(link, "node_modules", "tiny-dep", "package.json"))).toBe(true);
        expect(readFileSync(join(root, "press.plugins.ts"), "utf8")).toContain('import plugin0 from "bundles-things";');

        const empty = join(root, "none");
        mkdirSync(empty);
        const second = run(empty);
        expect(second.status).toBe(0);
        expect(() => lstatSync(link)).toThrow();
        expect(existsSync(join(root, ".press-plugins"))).toBe(false);
        // The file with no plugins is the one committed, so a run with none leaves a checkout clean.
        expect(readFileSync(join(root, "press.plugins.ts"), "utf8")).toBe(readFileSync("press.plugins.ts", "utf8"));
    });
});
