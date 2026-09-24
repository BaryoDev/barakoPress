#!/usr/bin/env node
// Installs plugin packages into this checkout and writes press.plugins.ts to register them
// (barakoPress #25). The Dockerfile runs it on the `plugins` build context; CI runs it on the sample.
//
//   node scripts/plugins.mjs <dir>
//
// <dir> holds `npm pack` tarballs, one per plugin. A tarball and not a directory or a registry name,
// so what is built is exactly the bytes that were packed, with no network lookup to change them.
// A directory with no tarball in it leaves the checkout as it was.
//
// A plugin imports `barakopress`, and inside this repository that name is the app itself, which a
// package under node_modules cannot reach by self-reference. So node_modules/barakopress is made to
// point at this checkout's own dist, which keeps one copy of the engine in the build rather than a
// second one fetched from npm at some other version.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
    console.error("usage: node scripts/plugins.mjs <dir of plugin tarballs>");
    process.exit(2);
}

const tarballs = existsSync(dir)
    ? readdirSync(dir)
          .filter((name) => name.endsWith(".tgz"))
          .sort()
          .map((name) => resolve(dir, name))
    : [];
if (tarballs.length === 0) {
    console.log("plugins: none to install");
    process.exit(0);
}

// A package name goes into generated source, so it has to be a name and nothing else.
const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const names = tarballs.map((file) => {
    const manifest = JSON.parse(execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }));
    if (!NPM_NAME.test(manifest.name ?? "")) throw new Error(`${file}: "${manifest.name}" is not a package name`);
    if (manifest.name === "barakopress") throw new Error(`${file}: a plugin cannot be barakopress itself`);
    return manifest.name;
});
if (new Set(names).size !== names.length) throw new Error(`plugins: one package is packed twice (${names.join(", ")})`);

// Into a directory of their own and linked in, so installing a plugin cannot move anything the
// engine's lockfile put in node_modules. No scripts: a plugin ships built JavaScript, and nothing it
// declares runs at install. No peers: a plugin's are barakopress, which is this checkout, and react,
// which the app already has, so both resolve from node_modules above the link's target.
const PREFIX = ".press-plugins";
execFileSync(
    "npm",
    [
        "install",
        "--prefix",
        PREFIX,
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
    const depth = name.split("/").length;
    mkdirSync(dirname(link), { recursive: true });
    rmSync(link, { recursive: true, force: true });
    symlinkSync(join(...Array(depth).fill(".."), PREFIX, "node_modules", name), link);
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

const lines = [
    "// Written by scripts/plugins.mjs. The packages this image was built with.",
    'import type { PressPlugin } from "barakopress";',
    ...names.map((name, i) => `import plugin${i} from ${JSON.stringify(name)};`),
    "",
    `export const plugins: PressPlugin[] = [${names.map((_, i) => `plugin${i}`).join(", ")}];`,
    "",
];
writeFileSync("press.plugins.ts", lines.join("\n"));
console.log(`plugins: installed ${names.join(", ")}`);
