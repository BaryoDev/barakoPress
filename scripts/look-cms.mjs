/*
 * A stand-in barakoCMS holding one site's look fixture, so the rebuilt side of a look check is the
 * real stack and not handwritten markup.
 *
 * It serves one tenant: its settings from `site.json`, and one page per `*.blocks.json` beside it.
 * The reference app is a request-time site, so that is all it takes for `next start` to answer the
 * fixture's host with the theme, the header and the blocks the conversion is proposing. Nothing is
 * mocked below the HTTP boundary: the engine resolves, binds and renders exactly as it will on the
 * day the domain moves.
 *
 *   node scripts/look-cms.mjs 5199 look/fixtures/baryo-dev baryo.dev
 *
 * The page a fixture directory holds at `home.blocks.json` is served at `/home`, which is what the
 * settings file points `HomePath` at. Any other `<name>.blocks.json` is served at `/<name>`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";

const [portArg, dir, host] = process.argv.slice(2);
const port = Number(portArg ?? 5199);
if (!dir || !host) {
    console.error("usage: node scripts/look-cms.mjs <port> <fixture directory> <host>");
    process.exit(2);
}

const handle = basename(dir);
const settings = JSON.parse(readFileSync(join(dir, "site.json"), "utf8"));

const pages = {};
for (const file of readdirSync(dir)) {
    if (!file.endsWith(".blocks.json")) continue;
    const slug = file.slice(0, -".blocks.json".length);
    pages[`/${slug}`] = {
        id: slug,
        slug,
        data: {
            Title: settings.Name ?? slug,
            Slug: slug,
            Blocks: JSON.parse(readFileSync(join(dir, file), "utf8")),
        },
    };
}
if (Object.keys(pages).length === 0) {
    console.error(`${dir} holds no <name>.blocks.json, so there is nothing to render`);
    process.exit(2);
}

function send(response, status, body) {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body === undefined ? "" : JSON.stringify(body));
}

const list = (items) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });

createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://cms");

    const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
    if (byHost) {
        return decodeURIComponent(byHost[1]) === host ? send(response, 200, { handle }) : send(response, 404);
    }
    if (request.headers["x-tenant"] !== handle) return send(response, 404);

    if (url.pathname === "/api/public/site") return send(response, 200, list([{ id: "site", data: settings }]));
    if (url.pathname === "/api/public/pages/resolve") {
        const path = url.searchParams.get("path") ?? "/";
        // hasOwn, so `?path=constructor` is a 404 rather than a 200 carrying a function.
        if (!Object.hasOwn(pages, path)) return send(response, 404);
        const found = pages[path];
        return send(response, 200, {
            contract: 1,
            path: url.searchParams.get("path"),
            entry: { contentType: "page", ...found },
            breadcrumbs: [],
        });
    }
    // No navigation, no posts and no collections: a look fixture is the page, not the whole site.
    return send(response, 404);
}).listen(port, "127.0.0.1", () => {
    console.log(`look cms for ${host} on http://127.0.0.1:${port}, pages: ${Object.keys(pages).join(", ")}`);
});
