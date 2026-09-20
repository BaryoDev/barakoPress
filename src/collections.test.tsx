import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Collections on a request-time site: each tenant's from its own settings, rendered through the root
 * catch-all and the collection factories. The request and its cookies are whatever the test says.
 */
let requestHeaders: Headers | null = null;
let requestCookies: Record<string, string> = {};
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({
        get: (name: string) => (name in requestCookies ? { name, value: requestCookies[name] } : undefined),
    }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 307 ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 308 ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { getTerm, isReservedPath } = await import("./cms.js");
const { collectionAt, forgetCollectionWarnings, listAllCollection, listCollection, toItem } = await import("./collections.js");
const { listRelated } = await import("./related.js");
const { applySiteSettings, getGlobals, siteConfig } = await import("./site.js");
const { createPage } = await import("./screens/page.js");
const { createCollectionDetail, createCollectionIndex, createCollectionMetadata, createCollectionStaticParams } =
    await import("./screens/collection.js");
const { createSitemap, forgetSitemapWarnings } = await import("./routes/sitemap.js");
const { createFeed } = await import("./routes/feed.js");
const { createBlockRegistry, registryFor } = await import("./blocks/registry.js");
const { DEFAULT_THEME } = await import("./theme.js");
type Config = ReturnType<typeof defineConfig>;

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const PROJECTS: Entry[] = [
    { id: "pw", slug: "clean-water", data: { Title: "Clean water", Slug: "clean-water", Summary: "Wells for barangays", AreaOfFocus: "Providing clean water" } },
    { id: "pe", slug: "school-books", data: { Title: "School books", Slug: "school-books", Summary: "Books for schools", AreaOfFocus: "Supporting education" } },
    { id: "pp", slug: "peace-talks", data: { Title: "Peace talks", Slug: "peace-talks", AreaOfFocus: "Promoting peace" } },
];
const DEPARTMENTS: Entry[] = [
    { id: "d1", slug: "cardiology", data: { Name: "Cardiology", Slug: "cardiology", About: "Hearts, *mostly*." } },
    { id: "d2", slug: "pediatrics", data: { Name: "Pediatrics", Slug: "pediatrics" } },
];
const DOCTORS: Entry[] = [
    { id: "doc1", slug: "dr-reyes", data: { Name: "Dr Reyes", Slug: "dr-reyes", Specialty: "Heart surgery", Department: DEPARTMENTS[0] } },
    { id: "doc2", slug: "dr-santos", data: { Name: "Dr Santos", Slug: "dr-santos", Specialty: "Children", Department: DEPARTMENTS[1] } },
];

/** Long enough to be worth a read time: 500 words is three minutes at the engine's 200 a minute. */
const STORY = Array.from({ length: 500 }, () => "word").join(" ");

const CASES: Entry[] = [
    { id: "c1", slug: "harbour-rebrand", data: { Title: "Harbour rebrand", Slug: "harbour-rebrand", Story: STORY } },
    { id: "c2", slug: "ferry-timetable", data: { Title: "Ferry timetable", Slug: "ferry-timetable", Story: "Short." } },
    { id: "c3", slug: "market-signage", data: { Title: "Market signage", Slug: "market-signage", Story: "Also short." } },
];
const PEOPLE: Entry[] = [
    { id: "pe1", slug: "mara", data: { Name: "Mara Cruz", Slug: "mara", Bio: "Runs the studio.", Portrait: "https://files.example/mara.jpg" } },
];

/** Longer than the API's page cap on purpose: one page of these proves nothing about paging. */
const NOTICES: Entry[] = Array.from({ length: 250 }, (_, i) => ({
    id: `n${i + 1}`,
    slug: `notice-${i + 1}`,
    data: { Title: `Notice ${i + 1}`, Slug: `notice-${i + 1}` },
}));

const NOTICES_COLLECTION = {
    type: "notice",
    route: "/notices",
    fields: { title: "Title", slug: "Slug" },
};

const PROJECTS_COLLECTION = {
    type: "project",
    route: "/projects",
    label: "Projects",
    sort: "Title",
    colorBy: "AreaOfFocus",
    feed: true,
    fields: { title: "Title", slug: "Slug", summary: "Summary" },
};

type Tenant = { host: string; settings: Record<string, unknown>; content: Record<string, Entry[]> };

const TENANTS: Record<string, Tenant> = {
    rckoronadal: {
        host: "rckoronadal.org",
        settings: {
            Name: "Rotary Club of Koronadal",
            Url: "https://rckoronadal.org",
            Colors: { accent: "#17458F", sky: "#00A2E0", gold: "#F7A81B" },
            OptionColors: {
                "project.AreaOfFocus": {
                    "Providing clean water": "sky",
                    "Supporting education": "gold",
                    "Promoting peace": "red;}</style>",
                },
            },
            Collections: { projects: PROJECTS_COLLECTION },
        },
        content: { project: PROJECTS, post: [] },
    },
    hospital: {
        host: "hospital.example",
        settings: {
            Name: "City Hospital",
            Url: "https://hospital.example",
            // Saved as text, which is how some editors send a json field.
            Collections: JSON.stringify({
                departments: {
                    type: "department",
                    route: "/departments",
                    fields: { title: "Name", body: "About" },
                    noun: ["department", "departments"],
                },
                doctors: {
                    type: "doctor",
                    route: "/doctors",
                    fields: { title: "Name", summary: "Specialty" },
                    references: { Department: { collection: "departments", label: "in" } },
                    noun: ["doctor", "doctors"],
                },
            }),
        },
        content: { department: DEPARTMENTS, doctor: DOCTORS, post: [] },
    },
    agency: {
        host: "agency.example",
        settings: {
            Name: "Tide and Co",
            Url: "https://agency.example",
            Collections: {
                cases: {
                    type: "case",
                    route: "/cases",
                    fields: { title: "Title", slug: "Slug", body: "Story" },
                    related: "semantic",
                    readingTime: true,
                    noun: ["case study", "case studies"],
                },
                // Authors and categories in all but name: the same shape, none of the blueprint's field names.
                people: {
                    type: "person",
                    route: "/people",
                    fields: { title: "Name", slug: "Slug", body: "Bio", photo: "Portrait" },
                },
            },
        },
        content: { case: CASES, person: PEOPLE, post: [] },
    },
    school: {
        host: "school.example",
        settings: {
            Name: "Saint Jude",
            Url: "https://school.example",
            Collections: { notices: NOTICES_COLLECTION },
        },
        content: { notice: NOTICES, post: [] },
    },
    soon: {
        host: "soon.example",
        settings: { Name: "Soon Club", Url: "https://soon.example", Mode: "Holding", Collections: { projects: PROJECTS_COLLECTION } },
        content: { project: PROJECTS, post: [] },
    },
};

/** barakoCMS clamps a public list at this, whatever was asked for. `MaxPageSize` in PaginationModels.cs. */
const MAX_PAGE_SIZE = 100;

type Call = { path: string; tenant: string | null; tags: string[] };
let calls: Call[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ path: url.pathname + url.search, tenant, tags: init?.next?.tags ?? [] });

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        /*
         * Paged the way barakoCMS pages, clamp included. A public list is capped with Math.Min, so
         * asking for more rows than MAX_PAGE_SIZE is answered with that many and no error at all. A
         * mock that handed back every row whatever was asked for would let a caller that never pages
         * look correct (#72).
         */
        const paged = (items: unknown[]) => {
            const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
            const size = Math.min(Number(url.searchParams.get("pageSize") ?? 20), MAX_PAGE_SIZE);
            const from = (page - 1) * size;
            const rows = items.slice(from, from + size);
            return Response.json({
                items: rows,
                page,
                pageSize: size,
                totalItems: items.length,
                totalPages: Math.max(1, Math.ceil(items.length / size)),
                hasNextPage: from + rows.length < items.length,
            });
        };
        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: t.settings }]);

        const nearest = url.pathname.match(/^\/api\/public\/([^/]+)\/semantic$/);
        if (nearest) {
            const entries = t.content[nearest[1]] ?? [];
            return Response.json({
                results: entries.map((e, i) => ({
                    slug: e.slug,
                    title: String(e.data.Title ?? e.data.Name ?? ""),
                    score: 0.9 - i / 100,
                })),
            });
        }

        const [type, slug] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const entries = t.content[type];
        if (!entries) return new Response("", { status: 404 });
        if (slug) {
            const found = entries.find((e) => e.slug === decodeURIComponent(slug));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        let listed = entries;
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (!m) continue;
            listed = listed.filter((e) => {
                const held = e.data[m[1]];
                return held && typeof held === "object" ? (held as { id?: string }).id === value : held === value;
            });
        }
        return paged(listed);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

function visit(host: string) {
    requestHeaders = new Headers({ host });
    requestCookies = {};
}

async function site(host: string): Promise<Config> {
    visit(host);
    return siteConfig(config);
}

/** What a render ends in: its markup, or the message of the control flow error it threw. */
async function outcome(run: () => Promise<ReactNode> | ReactNode): Promise<string> {
    try {
        return renderToStaticMarkup(await run());
    } catch (e) {
        return (e as Error).message;
    }
}

const route = (cfg: Config, path: string[]) => outcome(() => createPage(cfg)({ params: Promise.resolve({ path }) }));
const listed = (type: string) => calls.filter((c) => c.path.startsWith(`/api/public/${type}?`));

function cardFor(html: string, title: string): string {
    const card = html.split("<article").find((part) => part.includes(title));
    if (!card) throw new Error(`no card for ${title}`);
    return card;
}

beforeEach(() => {
    forgetCachedReads();
    forgetCollectionWarnings();
    forgetSitemapWarnings();
    requestHeaders = null;
    requestCookies = {};
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("collections from a tenant's settings", () => {
    it("renders each tenant its own collections, read with its own tenant header and cache tag", async () => {
        visit("rckoronadal.org");
        const projects = await route(config, ["projects"]);
        expect(projects).toContain("<h1>Projects</h1>");
        expect(projects).toContain('href="/projects/clean-water"');
        expect(projects).toContain("School books");
        expect(await route(config, ["doctors"])).toBe("NEXT_NOT_FOUND");

        visit("hospital.example");
        const doctors = await route(config, ["doctors"]);
        expect(doctors).toContain("Dr Reyes");
        expect(doctors).toContain(' in <a href="/departments/cardiology">Cardiology</a>');
        expect(await route(config, ["projects"])).toBe("NEXT_NOT_FOUND");

        const reads = [...listed("project"), ...listed("doctor")];
        expect(reads).toHaveLength(2);
        expect(reads.map((r) => [r.path, r.tenant, r.tags])).toEqual([
            ["/api/public/project?page=1&pageSize=20&sort=Title", "rckoronadal", ["cms:rckoronadal"]],
            ["/api/public/doctor?page=1&pageSize=20&include=Department", "hospital", ["cms:hospital"]],
        ]);
    });

    it("renders an item page with the items that reference it, and its metadata", async () => {
        visit("hospital.example");
        const department = await route(config, ["departments", "cardiology"]);
        expect(department).toContain("<h1>Cardiology</h1>");
        expect(department).toContain("Hearts, <em>mostly</em>.");
        expect(department).toContain("Dr Reyes");
        expect(department).not.toContain("Dr Santos");
        expect(department).toMatch(/<h2 style="margin-top:2.5rem">1(<!-- -->)? (<!-- -->)?doctor<\/h2>/);
        expect(calls.map((c) => c.path)).toContain(
            "/api/public/doctor?page=1&pageSize=50&include=Department&filter%5BDepartment%5D%5Beq%5D=d1",
        );

        expect(await route(config, ["doctors", "dr-reyes"])).toContain("Heart surgery");
        expect(await route(config, ["doctors", "nobody"])).toBe("NEXT_NOT_FOUND");

        const detail = createCollectionDetail(config, "doctors");
        expect(await outcome(() => detail({ params: Promise.resolve({ slug: "dr-santos" }) }))).toContain("Children");
        const meta = await createCollectionMetadata(config, "doctors")({ params: Promise.resolve({ slug: "dr-reyes" }) });
        expect(meta.title).toBe("Dr Reyes");
        expect(meta.description).toBe("Heart surgery");
    });

    it("filters a list by a field value, a choice option, and a reference by its slug", async () => {
        const rotary = await site("rckoronadal.org");
        calls = [];
        const water = await listCollection(rotary, "projects", { filter: { AreaOfFocus: "Providing clean water" } });
        expect(water.items).toHaveLength(1);
        expect(water.items.map((i) => i.title)).toEqual(["Clean water"]);
        expect(calls.map((c) => c.path)).toEqual([
            "/api/public/project?page=1&pageSize=20&sort=Title&filter%5BAreaOfFocus%5D%5Beq%5D=Providing+clean+water",
        ]);

        const hospital = await site("hospital.example");
        calls = [];
        const children = await listCollection(hospital, "doctors", { filter: { Department: "pediatrics" } });
        expect(children.items).toHaveLength(1);
        expect(children.items[0].title).toBe("Dr Santos");
        expect(calls.map((c) => c.path)).toEqual([
            "/api/public/department/pediatrics",
            "/api/public/doctor?page=1&pageSize=20&include=Department&filter%5BDepartment%5D%5Beq%5D=d2",
        ]);

        calls = [];
        expect((await listCollection(hospital, "doctors", { filter: { Department: "nowhere" } })).items).toEqual([]);
        expect(calls.map((c) => c.path)).toEqual(["/api/public/department/nowhere"]);

        const six = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((f) => [f, "x"]));
        await expect(listCollection(hospital, "doctors", { filter: six })).rejects.toThrow("at most 5");

        visit("hospital.example");
        const cardiology = await outcome(() =>
            createCollectionIndex(config, "doctors", { filter: { Department: "cardiology" } })(),
        );
        expect(cardiology).toContain("Dr Reyes");
        expect(cardiology).not.toContain("Dr Santos");
    });

    it("colours an item by the option of its choice field, through OptionColors and Colors", async () => {
        visit("rckoronadal.org");
        const html = await route(config, ["projects"]);
        expect(html.split("<article").slice(1)).toHaveLength(3);
        expect(cardFor(html, "Clean water")).toContain("border-left:4px solid #00A2E0");
        expect(cardFor(html, "School books")).toContain("border-left:4px solid #F7A81B");
        expect(cardFor(html, "Peace talks")).not.toContain("border-left");
        expect(cardFor(html, "Peace talks")).toContain("Promoting peace");
        expect(html).not.toContain("red;");

        const out = applySiteSettings({ ...config, tenant: "t" }, TENANTS.rckoronadal.settings, null);
        expect(out.optionColors).toEqual({
            "project.AreaOfFocus": { "Providing clean water": "#00A2E0", "Supporting education": "#F7A81B" },
        });

        const merged = applySiteSettings(
            {
                ...config,
                tenant: "t",
                optionColors: {
                    "project.AreaOfFocus": { "Promoting peace": "#0000AA", "Providing clean water": "#999999" },
                    "doctor.Specialty": { Children: "#00AA00" },
                },
            },
            TENANTS.rckoronadal.settings,
            null,
        );
        expect(merged.optionColors).toEqual({
            "project.AreaOfFocus": {
                "Promoting peace": "#0000AA",
                "Providing clean water": "#00A2E0",
                "Supporting education": "#F7A81B",
            },
            "doctor.Specialty": { Children: "#00AA00" },
        });

        const buildTime = defineConfig({
            site: { name: "R", url: "https://r.example" },
            cmsUrl: CMS,
            tenant: "rckoronadal",
            collections: { projects: PROJECTS_COLLECTION },
            optionColors: { "project.AreaOfFocus": { "Supporting education": "#123456" } },
        });
        const index = await outcome(() => createCollectionIndex(buildTime, "projects")());
        expect(cardFor(index, "School books")).toContain("border-left:4px solid #123456");
        expect(cardFor(index, "Clean water")).not.toContain("border-left");
    });

    it("reads only well-formed collections from the settings, and never replaces the blog's with a broken one", () => {
        const out = applySiteSettings(
            { ...config, tenant: "t" },
            {
                Collections: {
                    good: {
                        type: "thing",
                        route: "/things/",
                        fields: { title: ["Name", "Title"], date: "@createdAt" },
                        references: { Owner: "people", "bad field!": "people" },
                        sort: "-Name",
                        pageSize: 12,
                    },
                    "bad key!": { type: "thing", fields: { title: "Name" } },
                    noType: { fields: { title: "Name" } },
                    badType: { type: "a thing", fields: { title: "Name" } },
                    noTitle: { type: "thing", fields: {} },
                    badRoute: { type: "thing", route: "//evil.example", fields: { title: "Name" } },
                    post: { type: "article", route: "/blog", fields: { title: "Headline" } },
                    author: { type: "person", route: "/people", fields: { title: "Name" } },
                    badValues: { type: "thing", fields: { title: "Name" }, sort: "Name; drop", pageSize: 5000, colorBy: "@createdAt" },
                },
            },
            null,
        );

        expect(Object.keys(out.collections).sort()).toEqual(["author", "badValues", "category", "good", "post"]);
        expect(out.collections.good).toMatchObject({
            type: "thing",
            route: "/things",
            fields: { title: ["Name", "Title"], date: "@createdAt" },
            references: { Owner: { collection: "people" } },
            sort: "-Name",
            pageSize: 12,
        });
        expect(Object.keys(out.collections.good.references ?? {})).toEqual(["Owner"]);
        expect(out.collections.post).toEqual(config.collections.post);
        expect(out.collections.author).toEqual(config.collections.author);
        expect(out.collections.badValues).toMatchObject({ sort: undefined, pageSize: undefined, colorBy: undefined });
    });

    it("still holds a tenant back from its collections while holding", async () => {
        visit("soon.example");
        expect(await route(config, ["projects"])).toBe("NEXT_NOT_FOUND");
        expect(await route(config, ["projects", "clean-water"])).toBe("NEXT_NOT_FOUND");
        expect(await outcome(() => createCollectionIndex(config, "projects")())).toBe("NEXT_NOT_FOUND");
        expect((await createFeed(config, "projects")()).status).toBe(404);
        expect(calls.some((c) => c.path.startsWith("/api/public/project"))).toBe(false);
    });

    it("feeds a collection whose feed is on, and no other", async () => {
        visit("rckoronadal.org");
        const res = await createFeed(config, "projects")();
        expect(res.status).toBe(200);
        const feed = await res.text();
        expect(feed).toContain("<link>https://rckoronadal.org/projects/clean-water</link>");
        expect(feed).toContain("<description>Wells for barangays</description>");

        expect(feed).toContain('<atom:link href="https://rckoronadal.org/feed.xml"');
        const mounted = await (await createFeed(config, "projects", { path: "/projects/feed.xml" })()).text();
        expect(mounted).toContain('<atom:link href="https://rckoronadal.org/projects/feed.xml"');

        visit("hospital.example");
        expect((await createFeed(config, "doctors")()).status).toBe(404);

        const routeless = defineConfig({
            site: { name: "R", url: "https://r.example" },
            cmsUrl: CMS,
            tenant: "rckoronadal",
            collections: { projects: { ...PROJECTS_COLLECTION, route: undefined } },
        });
        expect((await createFeed(routeless, "projects")()).status).toBe(404);
    });

    it("lists a filtered collection in the collection block, with its colours", async () => {
        visit("rckoronadal.org");
        // The registry is built from the site's own config, and the request binds it to the tenant
        // it resolved. Asking the request again inside the block is what #55 took out.
        const resolved = await siteConfig(config);
        const block = registryFor(resolved, createBlockRegistry(config)).get("collection");
        expect(block?.fields.find((f) => f.name === "collection")?.kind).toBe("text");
        const component = block?.component as unknown as (p: {
            props: Record<string, unknown>;
            slots: Record<string, ReactNode[]>;
            theme: typeof DEFAULT_THEME;
        }) => Promise<ReactNode>;
        const html = renderToStaticMarkup(
            await component({
                props: { collection: "projects", limit: 6, filterField: "AreaOfFocus", filterValue: "Supporting education" },
                slots: {},
                theme: DEFAULT_THEME,
            }),
        );
        expect(html).toContain('href="/projects/school-books"');
        expect(html).toContain("border-left:4px solid #F7A81B");
        expect(html).not.toContain("Clean water");

        const buildTime = defineConfig({ site: { name: "B", url: "https://b.example" }, collections: { projects: PROJECTS_COLLECTION } });
        const select = createBlockRegistry(buildTime).get("collection")?.fields.find((f) => f.name === "collection");
        expect(select).toMatchObject({ kind: "select", options: ["post", "author", "category", "projects"] });
    });

    it("puts each tenant's items in its sitemap, and reserves a collection's route from pages at the root", async () => {
        visit("hospital.example");
        const urls = (await createSitemap(config)()).map((e) => e.url);
        expect(urls).toEqual([
            "https://hospital.example",
            "https://hospital.example/departments/cardiology",
            "https://hospital.example/departments/pediatrics",
            "https://hospital.example/doctors/dr-reyes",
            "https://hospital.example/doctors/dr-santos",
        ]);

        const hospital = await site("hospital.example");
        const rotary = await site("rckoronadal.org");
        expect(isReservedPath(rotary, "/projects")).toBe(true);
        expect(isReservedPath(hospital, "/projects")).toBe(false);
        expect(isReservedPath(hospital, "/doctors/anyone")).toBe(true);
    });

    it("shows a read time and its nearest items on a collection that is not the post collection", async () => {
        visit("agency.example");
        const study = await route(config, ["cases", "harbour-rebrand"]);

        expect(study).toContain("<h1>Harbour rebrand</h1>");
        expect(study).toContain("3 min read");
        expect(study).toMatch(/2(<!-- -->)? (<!-- -->)?case studies/);
        expect(study).toContain('href="/cases/ferry-timetable"');
        expect(study).toContain('href="/cases/market-signage"');
        // Its own closest match is itself, and a card linking back to the page you are on is noise.
        expect(study).not.toContain('href="/cases/harbour-rebrand"');
        expect(calls.map((c) => c.path)).toContain("/api/public/case/semantic?q=Harbour+rebrand&limit=5");

        // A collection that asks for neither shows neither, which is every collection that was here before.
        calls = [];
        visit("hospital.example");
        const doctor = await route(config, ["doctors", "dr-reyes"]);
        expect(doctor).toContain("Dr Reyes");
        expect(doctor).not.toContain("min read");
        expect(calls.map((c) => c.path).filter((path) => path.includes("/semantic"))).toEqual([]);
    });

    it("shows a photo from the field the collection named, rather than one field name read in one place", async () => {
        visit("agency.example");
        const person = await route(config, ["people", "mara"]);
        expect(person).toContain("<h1>Mara Cruz</h1>");
        expect(person).toContain("https://files.example/mara.jpg");
        expect(person).toContain("Runs the studio.");

        // Same entry through getTerm, which read only `Photo` off the entry before this.
        const renamed = defineConfig({
            site: { name: "Tide and Co", url: "https://agency.example" },
            cmsUrl: CMS,
            tenant: "agency",
            types: { author: "person" },
            collections: {
                author: { type: "person", route: "/people", fields: { title: "Name", slug: "Slug", body: "Bio", photo: "Portrait" } },
            },
        });
        const term = await getTerm(renamed, "author", "mara");
        expect(term).not.toBeNull();
        expect(term?.name).toBe("Mara Cruz");
        expect(term?.photo).toBe("https://files.example/mara.jpg");
        expect(term?.description).toBe("Runs the studio.");
    });

    it("pages a collection past the API's cap into the sitemap, at the size the API allows", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        visit("school.example");
        const urls = (await createSitemap(config)()).map((e) => e.url);

        // Every notice, not the first hundred. The hundred-and-first is the one master loses.
        expect(urls).toHaveLength(1 + NOTICES.length);
        expect(urls[0]).toBe("https://school.example");
        expect(urls).toContain("https://school.example/notices/notice-1");
        expect(urls).toContain("https://school.example/notices/notice-101");
        expect(urls).toContain("https://school.example/notices/notice-250");
        expect(new Set(urls).size).toBe(urls.length);

        // The bound is asked for once; what the API answered with decides every page after it.
        const asked = listed("notice").map((c) => new URL(`${CMS}${c.path}`).searchParams.get("pageSize"));
        expect(asked).toEqual(["1000", "100", "100"]);
        expect(warn.mock.calls.flat().join(" ")).toContain('"notices" was asked for 1000 entries a page and the API allows 100');
    });

    it("stops a sitemap at the entries the site lists, and says so rather than absorbing it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const buildTime = defineConfig({
            site: { name: "Saint Jude", url: "https://school.example" },
            cmsUrl: CMS,
            tenant: "school",
            pageSizes: { sitemap: 120 },
            collections: { notices: NOTICES_COLLECTION },
        });
        const urls = (await createSitemap(buildTime)()).map((e) => e.url);

        expect(urls).toHaveLength(121);
        expect(urls).toContain("https://school.example/notices/notice-120");
        expect(urls).not.toContain("https://school.example/notices/notice-121");
        expect(warn.mock.calls.flat().join(" ")).toContain('"notices" for tenant "school" holds more than the 120 entries');
    });

    it("reads a collection to its end under a bound, and says it stopped short", async () => {
        const school = await site("school.example");

        const all = await listAllCollection(school, "notices", { limit: 1000 });
        expect(all.items).toHaveLength(250);
        expect(all.items.map((i) => i.slug)).toContain("notice-250");
        expect(all.items.map((i) => i.slug)).toEqual([...new Set(all.items.map((i) => i.slug))]);
        expect(all.truncated).toBe(false);

        const bounded = await listAllCollection(school, "notices", { limit: 150 });
        expect(bounded.items).toHaveLength(150);
        expect(bounded.items[149].slug).toBe("notice-150");
        expect(bounded.truncated).toBe(true);
    });

    it("lists slugs for a static export on a build-time site, and none on a request-time one", async () => {
        const buildTime = defineConfig({
            site: { name: "H", url: "https://h.example" },
            cmsUrl: CMS,
            tenant: "hospital",
            collections: { doctors: { type: "doctor", route: "doctors/", fields: { title: "Name" } } },
        });
        expect(buildTime.collections.doctors.route).toBe("/doctors");
        expect(buildTime.reservedSlugs).toContain("doctors");
        expect(await createCollectionStaticParams(buildTime, "doctors")()).toEqual([{ slug: "dr-reyes" }, { slug: "dr-santos" }]);
        expect(await createCollectionStaticParams(config, "doctors")()).toEqual([]);
    });

    it("fails a static export whose later page cannot be read, rather than shipping part of it", async () => {
        const buildTime = defineConfig({
            site: { name: "H", url: "https://h.example" },
            cmsUrl: CMS,
            collections: { doctors: { type: "doctor", route: "/doctors", fields: { title: "Name" } } },
        });
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const page = Number(new URL(String(input)).searchParams.get("page"));
                if (page > 1) throw new Error("ECONNRESET");
                return Response.json({ items: [DOCTORS[0]], page, pageSize: 100, totalItems: 2, totalPages: 2, hasNextPage: true });
            }),
        );
        await expect(createCollectionStaticParams(buildTime, "doctors")()).rejects.toThrow("ECONNRESET");

        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
        expect(await createCollectionStaticParams(buildTime, "doctors")()).toEqual([]);
    });

    it("finds the items that reference an item through listRelated", async () => {
        const hospital = await site("hospital.example");
        const doctors = await listRelated(hospital, "doctors", { id: "d1" }, { via: "Department" });
        expect(doctors).toHaveLength(1);
        expect(doctors.map((d) => d.title)).toEqual(["Dr Reyes"]);
    });

    it("reads the tenant's settings entry through getGlobals, and refuses a config nobody resolved", async () => {
        const hospital = await site("hospital.example");
        const globals = await getGlobals(hospital);
        expect(globals.Name).toBe("City Hospital");
        await expect(getGlobals(config)).rejects.toThrow("resolved");
    });

    it("lists no author or category index through the catch-all, and answers 404 for a type the CMS does not have", async () => {
        visit("hospital.example");
        expect(await route(config, ["authors"])).toBe("NEXT_NOT_FOUND");
        expect(await route(config, ["categories"])).toBe("NEXT_NOT_FOUND");
        expect(calls.some((c) => c.path.startsWith("/api/public/author?"))).toBe(false);

        const missingType = defineConfig({
            site: { name: "H", url: "https://h.example" },
            cmsUrl: CMS,
            tenant: "hospital",
            collections: { nurses: { type: "nurse", route: "/nurses", fields: { title: "Name" } } },
        });
        expect(await outcome(() => createCollectionIndex(missingType, "nurses")())).toBe("NEXT_NOT_FOUND");
    });

    it("prefers the longest matching route, and refuses a collection mounted at the site root", async () => {
        const nested = defineConfig({
            sites: {},
            collections: { featured: { type: "feature", route: "/blog/featured", fields: { title: "Title" } } },
        });
        expect(collectionAt(nested, "/blog/featured")).toEqual({ key: "featured" });
        expect(collectionAt(nested, "/blog/featured/one")).toEqual({ key: "featured", slug: "one" });
        expect(collectionAt(nested, "/blog/other")).toEqual({ key: "post", slug: "other" });
        expect(collectionAt(nested, "/authors")).toBeNull();
        expect(collectionAt(nested, "/authors/ada")).toEqual({ key: "author", slug: "ada" });

        expect(() =>
            defineConfig({ sites: {}, collections: { things: { type: "thing", route: "/", fields: { title: "Title" } } } }),
        ).toThrow("site root");
    });

    it("resolves only references into a configured collection", async () => {
        const owned = defineConfig({
            site: { name: "H", url: "https://h.example" },
            cmsUrl: CMS,
            tenant: "hospital",
            collections: {
                departments: { type: "department", route: "/departments", fields: { title: "Name" } },
                doctors: {
                    type: "doctor",
                    route: "/doctors",
                    fields: { title: "Name" },
                    references: { Department: { collection: "departments" }, Clinic: { collection: "clinics" } },
                },
            },
        });
        await listCollection(owned, "doctors");
        expect(listed("doctor").map((c) => c.path)).toEqual(["/api/public/doctor?page=1&pageSize=20&include=Department"]);
    });

    it("gives no colour to an option named like an object member", () => {
        const coloured = defineConfig({
            site: { name: "R", url: "https://r.example" },
            collections: { projects: PROJECTS_COLLECTION },
            optionColors: { "project.AreaOfFocus": { "Providing clean water": "#00A2E0" } },
        });
        const item = (option: string) =>
            toItem(coloured, "projects", { id: "x", slug: "x", data: { Title: "X", AreaOfFocus: option } });
        expect(item("Providing clean water").color).toBe("#00A2E0");
        for (const option of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            expect(item(option).option).toBe(option);
            expect(item(option).color).toBeUndefined();
        }
    });
});
