/*
 * A stand-in barakoCMS with three tenants on three domains, for scripts/two-hosts.sh. The third is
 * holding, so the other two show it leaves them alone.
 *
 * It answers only what the renderer asks: the host lookup, each tenant's site settings and its posts,
 * the Pages module's path resolve, and share link redeem.
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
    soon: {
        host: "soon.example",
        settings: {
            Name: "Soon Club",
            Url: "https://soon.example",
            Mode: "Holding",
            HoldingPath: "/coming-soon",
            HeaderLinks: [{ label: "Opening", href: "/coming-soon" }, { label: "About", href: "/about" }],
        },
        post: "launch-plans",
        // Share links barakoCMS would redeem for this tenant, with how long each has left, and one it throttles.
        shareLinks: { "soon-share-key-0123456789": 30 * 24 * 3600, "soon-short-key-0123456789": 3600 },
        throttledKey: "soon-throttled-key-0123456789",
        pages: {
            "/coming-soon": { id: "cs", slug: "coming-soon", data: { Title: "Opening soon", Slug: "coming-soon", Blocks: [{ type: "richText", props: { markdown: "## Opening in October" } }] } },
        },
    },
};

const reads = { rckoronadal: 0, baryo: 0, soon: 0 };

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

    if (req.method === "POST" && url.pathname === "/api/public/site/share-links/redeem") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            let key;
            try {
                key = JSON.parse(body).key;
            } catch {
                key = undefined;
            }
            if (tenant.throttledKey && key === tenant.throttledKey) return send(res, 429);
            const left = tenant.shareLinks && typeof key === "string" ? tenant.shareLinks[key] : undefined;
            if (left) return send(res, 200, { expiresAt: new Date(Date.now() + left * 1000).toISOString() });
            return send(res, 404);
        });
        return;
    }
    reads[handle] += 1;

    const post = { id: tenant.post, slug: tenant.post, data: { Title: `${tenant.settings.Name} post`, Slug: tenant.post, Body: "Hello." } };
    if (url.pathname === "/api/public/site") return send(res, 200, page([{ id: "site", data: tenant.settings }]));
    if (url.pathname === "/api/public/post") return send(res, 200, page([post]));
    if (url.pathname === `/api/public/post/${tenant.post}`) return send(res, 200, post);
    if (url.pathname === "/api/public/pages/resolve") {
        const path = url.searchParams.get("path") ?? "/";
        const entry = tenant.pages?.[path];
        return entry ? send(res, 200, { contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] }) : send(res, 404);
    }
    return send(res, 404);
}).listen(port, "127.0.0.1");
