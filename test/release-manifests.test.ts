import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * A BaryoVM release syncs the listed paths to the VM and builds the image there. A file the build
 * needs and the list leaves out is not an error on a VM that still holds an old copy: the build
 * quietly uses the stale one. On a fresh VM it fails. So what the build needs is worked out from the
 * repository here, not listed by hand a second time.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = ["baryovm.release.json", "baryovm.site.json"];

/** Files Next reads at the project root by name, with nothing importing them. */
const NEXT_ROOT_FILES = ["next.config.ts", "proxy.ts", "middleware.ts", "instrumentation.ts"];

const SOURCE = /\.(ts|tsx|mjs|js)$/;
const TEST = /\.test\.(ts|tsx)$/;

function synced(list: string[], path: string): boolean {
    return list.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

function filesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(root, dir))) {
        if (name === "node_modules" || name === ".next") continue;
        const path = `${dir}${name}`;
        if (statSync(join(root, path)).isDirectory()) out.push(...filesUnder(`${path}/`));
        else out.push(path);
    }
    return out;
}

/** A specifier as a repository path, or null when it names a package or nothing on disk. */
function resolveImport(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(root, spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(join(root, dirname(from)), spec);
    else return null;
    const stem = base.replace(/\.js$/, "");
    for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mjs`, `${stem}.js`, join(base, "index.ts")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return relative(root, candidate);
    }
    return null;
}

function importsOf(path: string): string[] {
    const text = readFileSync(join(root, path), "utf8");
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    return specs.map((spec) => resolveImport(path, spec)).filter((p): p is string => p !== null);
}

/** What the image build reads: the scripts the Dockerfile runs, Next's root files, and what they import. */
function neededBy(list: string[]): string[] {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const scripts = [...dockerfile.matchAll(/^RUN\b.*?\bnode\s+(\S+\.m?js)/gm)].map((m) => m[1]);
    const start = [
        ...scripts,
        ...NEXT_ROOT_FILES.filter((f) => existsSync(join(root, f))),
        ...list.flatMap((entry) => (entry.endsWith("/") ? filesUnder(entry) : [entry])),
    ].filter((p) => SOURCE.test(p) && !TEST.test(p));

    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
        const path = queue.pop()!;
        if (seen.has(path)) continue;
        seen.add(path);
        queue.push(...importsOf(path).filter((p) => !TEST.test(p)));
    }
    return [...seen].sort();
}

describe.each(MANIFESTS)("%s", (manifest) => {
    const list: string[] = JSON.parse(readFileSync(join(root, manifest), "utf8")).sync;

    it("syncs every file the image build reads", () => {
        const needed = neededBy(list);
        expect(needed).toContain("press.config.ts");
        expect(needed.filter((path) => !synced(list, path))).toEqual([]);
    });

    it("syncs only paths that exist", () => {
        expect(list.length).toBeGreaterThan(0);
        expect(list.filter((entry) => !existsSync(join(root, entry)))).toEqual([]);
    });
});
