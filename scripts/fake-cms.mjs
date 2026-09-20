/*
 * A stand-in barakoCMS with three tenants on three domains, for scripts/two-hosts.sh. The third is
 * holding, so the other two show it leaves them alone.
 *
 * It answers only what the renderer asks: the host lookup, each tenant's site settings and its posts,
 * the Pages module's navigation and path resolve, the redirects resolver, and share link redeem.
 * GET /__reads returns how many content reads each tenant has made, which is how the script shows a
 * purge on one tenant leaves the other's cached reads alone.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 5098);

// rckoronadal's projects, a collection from its settings, coloured by area of focus.
const PROJECTS = [
    { id: "pw", slug: "clean-water", data: { Title: "Clean water", Slug: "clean-water", Summary: "Wells for barangays", AreaOfFocus: "Providing clean water" } },
    { id: "pe", slug: "school-books", data: { Title: "School books", Slug: "school-books", Summary: "Books for schools", AreaOfFocus: "Supporting education" } },
];
const PROJECTS_COLLECTION = { type: "project", route: "/projects", label: "Projects", sort: "Title", colorBy: "AreaOfFocus", fields: { title: "Title", slug: "Slug", summary: "Summary" } };

/*
 * baryo.dev's manual, a collection configured as a tree (#23). Its order fields do not match the
 * alphabet and one page has none, so a sidebar that ignored the field would be visible in the output.
 */
const MANUAL = [
    { id: "m1", slug: "start", data: { Title: "Getting going", Slug: "start", Body: "Install it.", Section: "Start", Order: 1, Product: "press", Source: "docs/start.md" } },
    { id: "m2", slug: "blocks", data: { Title: "Blocks", Slug: "blocks", Body: "Arrange them.", Section: "Reference", Order: 2, Product: "press" } },
    { id: "m3", slug: "bindings", data: { Title: "Bindings", Slug: "bindings", Body: "Bind them.", Section: "Reference", Order: 1, Parent: "blocks", Product: "press" } },
];
const MANUAL_COLLECTION = {
    type: "manual",
    route: "/manual",
    label: "The manual",
    layout: "article",
    fields: { title: "Title", slug: "Slug", body: "Body" },
    tree: {
        section: "Section",
        sections: ["Start", "Reference"],
        order: "Order",
        parent: "Parent",
        product: "Product",
        editPath: "Source",
        editBase: "https://github.com/BaryoDev/barakoPress/edit/master/",
        products: [
            { key: "press", label: "barakoPress", href: "/manual" },
            { key: "cms", label: "barakoCMS", href: "/manual/cms" },
        ],
    },
};

function nav(id, title, path, order, children = []) {
    return { id, title, slug: path.split("/").pop(), path, order, children };
}

function pageAt(slug, title, markdown, crumbs = [[title, `/${slug}`]]) {
    return {
        id: slug,
        slug,
        data: { Title: title, Slug: slug, Blocks: [{ type: "richText", props: { markdown } }] },
        breadcrumbs: crumbs.map(([t, p]) => ({ id: p, title: t, slug: p.split("/").pop(), path: p })),
    };
}

const tenants = {
    rckoronadal: {
        host: "rckoronadal.org",
        settings: {
            Name: "Rotary Club of Koronadal",
            Url: "https://rckoronadal.org",
            Locale: "en-PH",
            Colors: { accent: "#17458F", sky: "#00A2E0", gold: "#F7A81B" },
            Fonts: { heading: "Zilla Slab" },
            Collections: { projects: PROJECTS_COLLECTION },
            OptionColors: { "project.AreaOfFocus": { "Providing clean water": "sky", "Supporting education": "gold" } },
            // A footer region (#48): the page below is drawn as the footer, in place of the built-in one.
            FooterPath: "/site/footer",
            FooterTone: "surface",
        },
        post: "club-news",
        // The footer page is in the menu the CMS returns, and must be drawn as the footer and nowhere else.
        navigation: [nav("p", "Projects", "/projects", 1), nav("f", "Footer", "/site/footer", 2)],
        content: { project: PROJECTS },
        pages: {
            "/site/footer": {
                id: "sf",
                slug: "footer",
                data: {
                    Title: "Footer",
                    Blocks: [
                        { type: "text", props: { value: "Meets Tuesdays at 6pm", variant: "heading" } },
                        { type: "text", props: { value: "Written by {{site.Name}}", variant: "small" } },
                    ],
                },
            },
        },
    },
    baryo: {
        host: "baryo.dev",
        settings: {
            Name: "BaryoDev",
            Url: "https://baryo.dev",
            Colors: { accent: "#1A6B41" },
            Fonts: { heading: "Sora" },
            Collections: { manual: MANUAL_COLLECTION },
        },
        content: { manual: MANUAL },
        post: "shipping-notes",
        // The CMS order, with `order` deliberately not ascending: the renderer draws it as given.
        navigation: [
            nav("a", "About", "/about", 2, [nav("t", "Team", "/about/team", null)]),
            nav("d", "Docs", "/docs", 1),
            nav("b", "Blog page", "/blog", 3),
        ],
        pages: {
            "/about": pageAt("about", "About", "About BaryoDev", [["About", "/about"]]),
            "/about/team": pageAt("team", "Team", "Meet the team", [["About", "/about"], ["Team", "/about/team"]]),
            "/docs": pageAt("docs", "Docs", "The docs"),
            // A {{query.X}} binding on a route the renderer keeps (#55). It renders as nothing
            // rather than failing the page: a route that needs the query stays dynamic.
            "/search": {
                id: "sq",
                slug: "search",
                data: {
                    Title: "Search",
                    Slug: "search",
                    Blocks: [{ type: "text", props: { value: "Looking for {{query.q}}", variant: "heading" } }],
                },
            },
            // Under a reserved slug at the root, so it must never render.
            "/blog": pageAt("blog", "Blog page", "A page that must never render"),
        },
        redirects: { "/old-about": { fromPath: "/old-about", toPath: "/about", status: 301 } },
    },
    soon: {
        host: "soon.example",
        settings: {
            Name: "Soon Club",
            Url: "https://soon.example",
            Mode: "Holding",
            HoldingPath: "/coming-soon",
            HeaderLinks: [{ label: "Opening", href: "/coming-soon" }, { label: "About", href: "/about" }],
            Collections: { projects: PROJECTS_COLLECTION },
        },
        content: { project: PROJECTS },
        post: "launch-plans",
        // Share links barakoCMS would redeem for this tenant, with how long each has left, and one it throttles.
        shareLinks: { "soon-share-key-0123456789": 30 * 24 * 3600, "soon-short-key-0123456789": 3600 },
        throttledKey: "soon-throttled-key-0123456789",
        navigation: [nav("c", "Opening", "/coming-soon", 1), nav("a", "About Soon", "/about", 2)],
        pages: {
            // A collection block on the holding page, which must render the holding page and none of the posts.
            "/coming-soon": {
                id: "cs",
                slug: "coming-soon",
                data: {
                    Title: "Opening soon",
                    Slug: "coming-soon",
                    Blocks: [
                        { type: "richText", props: { markdown: "## Opening in October" } },
                        { type: "collection", props: { collection: "post", heading: "Latest from the club" } },
                    ],
                },
            },
            "/about": pageAt("about", "About Soon", "The real about page"),
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
    if (url.pathname === "/api/public/pages/navigation") {
        return tenant.navigation ? send(res, 200, { contract: 1, items: tenant.navigation }) : send(res, 404);
    }
    if (url.pathname === "/api/public/pages/resolve") {
        const path = url.searchParams.get("path") ?? "/";
        const found = tenant.pages?.[path];
        if (!found) return send(res, 404);
        const { breadcrumbs = [], ...entry } = found;
        return send(res, 200, { contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs });
    }
    if (url.pathname === "/api/public/redirects/resolve") {
        const moved = tenant.redirects?.[url.searchParams.get("path") ?? ""];
        return moved ? send(res, 200, moved) : send(res, 404);
    }
    const search = url.pathname.match(/^\/api\/public\/([^/]+)\/search$/);
    if (search) {
        const entries = tenant.content?.[search[1]] ?? [];
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const results = q.length < 2 ? [] : entries.filter((e) => String(e.data.Title ?? "").toLowerCase().includes(q));
        return send(res, 200, { results, count: results.length, query: q });
    }
    const [, type, slug] = url.pathname.match(/^\/api\/public\/([^/]+)(?:\/([^/]+))?$/) ?? [];
    const entries = type ? tenant.content?.[type] : undefined;
    if (entries) {
        if (!slug) return send(res, 200, page(entries));
        const found = entries.find((e) => e.slug === decodeURIComponent(slug));
        return found ? send(res, 200, found) : send(res, 404);
    }
    return send(res, 404);
}).listen(port, "127.0.0.1");
