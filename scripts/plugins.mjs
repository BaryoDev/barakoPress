#!/usr/bin/env node
// Installs plugin packages into this checkout and writes press.plugins.ts to register them
// (barakoPress #25). The Dockerfile runs it on the `plugins` build context; CI runs it on the sample.
//
//   node scripts/plugins.mjs <dir>
//
// <dir> holds `npm pack` tarballs, one per plugin. A tarball and not a directory or a registry name,
// so what is built is exactly the bytes that were packed. The install runs offline, so a plugin's
// dependencies travel inside its tarball as bundleDependencies: a dependency fetched here would be
// whatever the registry answered on the day, with no lock to hold it.
//
// A plugin imports `barakopress`, and inside this repository that name is the app itself, which a
// package under node_modules cannot reach by self-reference. So node_modules/barakopress is made to
// point at this checkout's own dist, which keeps one copy of the engine in the build rather than a
// second one fetched from npm at some other version.
//
// Every run starts by taking out what an earlier run linked, so running it again with fewer plugins,
// or none, leaves only what this run installed.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PREFIX = ".press-plugins";

const dir = process.argv[2];
if (!dir) {
    console.error("usage: node scripts/plugins.mjs <dir of plugin tarballs>");
    process.exit(2);
}

function fail(message) {
    console.error(`plugins: ${message}`);
    process.exit(1);
}

/** node_modules entries that are links into PREFIX, scoped ones included. */
function earlierLinks() {
    if (!existsSync("node_modules")) return [];
    const out = [];
    const look = (path) => {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() && readlinkSync(path).includes(PREFIX)) out.push(path);
    };
    for (const entry of readdirSync("node_modules")) {
        const path = join("node_modules", entry);
        if (entry.startsWith("@") && lstatSync(path).isDirectory()) {
            for (const inner of readdirSync(path)) look(join(path, inner));
        } else {
            look(path);
        }
    }
    return out;
}

for (const link of earlierLinks()) rmSync(link, { force: true });
rmSync(PREFIX, { recursive: true, force: true });

const tarballs = existsSync(dir)
    ? readdirSync(dir)
          .filter((name) => name.endsWith(".tgz"))
          .sort()
          .map((name) => resolve(dir, name))
    : [];

// What the engine already resolves by name: anything in its lockfile, and anything on disk. A plugin
// under one of those names would be linked over it, and `react` would then be the plugin's code.
const lock = existsSync("package-lock.json") ? JSON.parse(readFileSync("package-lock.json", "utf8")) : {};
const taken = (name) =>
    name === "barakopress" || Object.hasOwn(lock.packages ?? {}, `node_modules/${name}`) || existsSync(join("node_modules", name));

// A package name goes into generated source, so it has to be a name and nothing else.
const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const names = tarballs.map((file) => {
    const manifest = JSON.parse(execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }));
    const name = manifest.name ?? "";
    if (!NPM_NAME.test(name)) fail(`${file}: "${name}" is not a package name`);
    if (taken(name)) fail(`${file}: "${name}" is a name the engine already uses, so it cannot be a plugin`);
    const bundled = new Set(manifest.bundleDependencies ?? manifest.bundledDependencies ?? []);
    const fetched = Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).filter((d) => !bundled.has(d));
    if (fetched.length > 0) {
        fail(`${file}: "${name}" depends on ${fetched.join(", ")} without bundling it; list it in bundleDependencies`);
    }
    return name;
});
if (new Set(names).size !== names.length) fail(`one package is packed twice (${names.join(", ")})`);

if (tarballs.length > 0) {
    // Into a directory of their own and linked in, so installing a plugin cannot move anything the
    // engine's lockfile put in node_modules. Offline, because everything needed is in the tarballs.
    // No scripts: a plugin ships built JavaScript, and nothing it declares runs at install. No peers:
    // a plugin's are barakopress, which is this checkout, and react, which the app already has, so
    // both resolve from node_modules above the link's target.
    execFileSync(
        "npm",
        [
            "install",
            "--prefix",
            PREFIX,
            "--offline",
            "--no-package-lock",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            "--legacy-peer-deps",
            ...tarballs,
        ],
        { stdio: "inherit" },
    );
    for (const name of names) {
        const link = join("node_modules", name);
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(join(...Array(name.split("/").length).fill(".."), PREFIX, "node_modules", name), link);
    }

    const engine = join("node_modules", "barakopress");
    if (!existsSync(engine)) {
        const own = JSON.parse(readFileSync("package.json", "utf8"));
        mkdirSync(engine, { recursive: true });
        const { name, version, type, exports, main, types } = own;
        writeFileSync(join(engine, "package.json"), JSON.stringify({ name, version, type, exports, main, types }, null, 2));
        symlinkSync(join("..", "..", "dist"), join(engine, "dist"));
        symlinkSync(join("..", "..", "src"), join(engine, "src"));
    }
}

const lines = [
    'import type { PressPlugin } from "barakopress";',
    "",
    "/*",
    " * The plugin packages this image carries, written by scripts/plugins.mjs (barakoPress #25). Empty in",
    " * the published image. Each tenant turns on the ones it uses with its `Plugins` setting.",
    " */",
    ...names.map((name, i) => `import plugin${i} from ${JSON.stringify(name)};`),
    `export const plugins: PressPlugin[] = [${names.map((_, i) => `plugin${i}`).join(", ")}];`,
    "",
];
writeFileSync("press.plugins.ts", lines.join("\n"));
console.log(names.length ? `plugins: installed ${names.join(", ")}` : "plugins: none to install");
