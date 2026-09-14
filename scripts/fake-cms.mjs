/*
 * A stand-in barakoCMS with two tenants on two domains, for scripts/two-hosts.sh.
 *
 * It answers only what the renderer asks: the host lookup, each tenant's site settings and its posts.
 * GET /__reads returns how many content reads each tenant has made, which is how the script shows a
 * purge on one tenant leaves the other's cached reads alone.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 5098);

const tenants = {
    rckoronadal: {
        host: "rckoronadal.org",
        settings: { Name: "Rotary Club of Koronadal", Url: "https://rckoronadal.org", Locale: "en-PH", Colors: { accent: "#17458F" }, Fonts: { heading: "Zilla Slab" } },
        post: "club-news",
    },
    baryo: {
        host: "baryo.dev",
        settings: { Name: "BaryoDev", Url: "https://baryo.dev", Colors: { accent: "#1A6B41" }, Fonts: { heading: "Sora" } },
        post: "shipping-notes",
    },
};

const reads = { rckoronadal: 0, baryo: 0 };

function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
}

const page = (items) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });

createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://cms");
    if (url.pathname === "/__reads") return send(res, 200, reads);

    const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
    if (byHost) {
        const host = decodeURIComponent(byHost[1]);
        const found = Object.entries(tenants).find(([, t]) => t.host === host);
        return found ? send(res, 200, { handle: found[0] }) : send(res, 404);
    }

    const handle = req.headers["x-tenant"];
    const tenant = typeof handle === "string" ? tenants[handle] : undefined;
    if (!tenant) return send(res, 404);
    reads[handle] += 1;

    const post = { id: tenant.post, slug: tenant.post, data: { Title: `${tenant.settings.Name} post`, Slug: tenant.post, Body: "Hello." } };
    if (url.pathname === "/api/public/site") return send(res, 200, page([{ id: "site", data: tenant.settings }]));
    if (url.pathname === "/api/public/post") return send(res, 200, page([post]));
    if (url.pathname === `/api/public/post/${tenant.post}`) return send(res, 200, post);
    return send(res, 404);
}).listen(port, "127.0.0.1");
