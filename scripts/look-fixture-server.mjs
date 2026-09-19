// Serves the rebuilt side of the look check's fixture pair.
//
// Two modes. `match` serves pages that render exactly like the prototype on disk. `drift` serves
// the same pages with one rule appended to the stylesheet, changing the hero heading colour, which
// is the deliberate difference the check has to catch. Nothing else differs between the two modes,
// so a failure in drift mode is that colour and nothing else.
//
//   node scripts/look-fixture-server.mjs 3112 match

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "look", "fixtures");

const port = Number(process.argv[2] ?? 3112);
const mode = process.argv[3] ?? "match";
if (mode !== "match" && mode !== "drift") {
    console.error(`mode must be match or drift, got ${mode}`);
    process.exit(2);
}

const DRIFT = "\n.hero h1 { color: #b23a1f; }\n";

const routes = new Map([
    ["/", { file: join(fixtures, "rebuilt", "index.html"), type: "text/html; charset=utf-8" }],
    ["/about", { file: join(fixtures, "rebuilt", "about.html"), type: "text/html; charset=utf-8" }],
    ["/site.css", { file: join(fixtures, "site.css"), type: "text/css; charset=utf-8", drifts: true }],
    ["/banner.svg", { file: join(fixtures, "banner.svg"), type: "image/svg+xml" }],
]);

const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const route = routes.get(path);
    if (!route) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not here\n");
        return;
    }
    let body = readFileSync(route.file);
    if (route.drifts && mode === "drift") body = Buffer.concat([body, Buffer.from(DRIFT)]);
    response.writeHead(200, { "content-type": route.type, "cache-control": "no-store" });
    response.end(body);
});

server.listen(port, "127.0.0.1", () => {
    console.log(`fixture server (${mode}) on http://127.0.0.1:${port}`);
});
