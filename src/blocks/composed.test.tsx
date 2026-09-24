import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A page assembled only from blocks, on a request-time site with two tenants: bindings against
 * `site`, `page`, `item` and `query`, a `source` that reads the CMS as the request's tenant, a
 * `repeat` with paging, a `showIf`, and a preset a tenant saved in its own settings.
 *
 * Both tenants run the same registry and the same image. Everything that makes a page that page is
 * data, which is what barakoCMS D22 asks of this repository.
 */
let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { siteConfig } = await import("../site.js");
const { createPage } = await import("../screens/page.js");
const { blockSchema } = await import("./schema.js");
const { createBlockRegistry, registryFor } = await import("./registry.js");
const { forgetPresetWarnings, presetsFrom, MAX_PRESETS, MAX_PRESET_BLOCKS } = await import("./presets.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const ENROLMENTS: Entry[] = [
    { id: "e1", slug: "ana", data: { Name: "Ana Cruz", Slug: "ana", Class: "biology", Fee: 1500, Joined: "2026-03-02T00:00:00Z" } },
    { id: "e2", slug: "ben", data: { Name: "Ben Dizon", Slug: "ben", Class: "biology", Fee: 1500 } },
    { id: "e3", slug: "cely", data: { Name: "Cely Uy", Slug: "cely", Class: "chemistry", Fee: 1800 } },
];

const ENROLMENT_COLLECTION = {
    type: "enrolment",
    route: "/enrolments",
    fields: { title: "Name", slug: "Slug", summary: "Class" },
    sort: "Name",
};

/*
 * Two collections over entries that carry their own `Body` and `Date`. The first maps neither role,
 * so the entry's own fields are what `{{item.Body}}` and `{{item.Date}}` read. The second maps both
 * to other fields, and the mapped values win over the entry's fields of the same name.
 */
const CHANGES: Entry[] = [
    { id: "c1", slug: "v1", data: { Name: "Version one", Body: "Own body text", Date: "2026-05-01T00:00:00Z" } },
];
const RELEASES: Entry[] = [
    {
        id: "r1",
        slug: "r1",
        data: { Name: "Release one", Body: "Own body text", Notes: "Mapped notes", Date: "2026-05-01T00:00:00Z", Shipped: "2026-06-09T00:00:00Z" },
    },
];

/*
 * A preset a designer saved in barakoBrew: a band with a heading and a slot, built from primitives,
 * reading its own props through `{{props.X}}`. No barakoPress release created this.
 */
const BAND_PRESET = {
    type: "welcome",
    label: "Welcome",
    fields: [
        { name: "heading", kind: "text", label: "Heading", required: true },
        { name: "tone", kind: "select", label: "Tone", options: ["page", "accent"] },
        { name: "content", kind: "slots", label: "Content" },
    ],
    blocks: [
        {
            type: "section",
            props: {
                tone: "{{props.tone}}",
                content: [
                    [
                        { type: "text", props: { value: "{{props.heading}}", variant: "title" } },
                        { type: "slot", props: { name: "content" } },
                    ],
                ],
            },
        },
    ],
};

const TENANTS: Record<string, { host: string; settings: Record<string, unknown>; content: Record<string, Entry[]> }> = {
    academy: {
        host: "academy.example",
        settings: {
            Name: "Mindanao Academy",
            Url: "https://academy.example",
            Currency: "PHP",
            Collections: {
                enrolments: ENROLMENT_COLLECTION,
                changes: { type: "change", fields: { title: "Name" } },
                releases: { type: "release", fields: { title: "Name", body: "Notes", date: "Shipped" } },
            },
            Presets: [BAND_PRESET],
        },
        content: { enrolment: ENROLMENTS, change: CHANGES, release: RELEASES, post: [] },
    },
    clinic: {
        host: "clinic.example",
        settings: { Name: "Bayan Clinic", Url: "https://clinic.example" },
        content: { post: [] },
    },
};

let pages: Record<string, Entry> = {};
let calls: string[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push(url.pathname + url.search);

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });

        const page = Number(url.searchParams.get("page") ?? "1");
        const size = Number(url.searchParams.get("pageSize") ?? "20");
        const paged = (items: unknown[]) => {
            const slice = items.slice((page - 1) * size, page * size);
            return Response.json({
                items: slice,
                page,
                pageSize: size,
                totalItems: items.length,
                totalPages: Math.ceil(items.length / size),
                hasNextPage: page * size < items.length,
            });
        };
        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "";
            const found = pages[path];
            return found
                ? Response.json({ contract: 1, path, entry: found, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 1, items: [] });

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
            if (m) listed = listed.filter((e) => e.data[m[1]] === value);
        }
        return paged(listed);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

let warnings: string[] = [];

beforeEach(() => {
    calls = [];
    pages = {};
    warnings = [];
    requestHeaders = null;
    forgetCachedReads();
    // Said once and then remembered, so a test that wants to hear it starts from silence.
    forgetPresetWarnings();
    vi.stubGlobal("fetch", cms());
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/*
 * Streamed rather than `renderToStaticMarkup`, because the `collection` block is an async component
 * and the synchronous renderer refuses one. This is the renderer that behaves like the server.
 */
async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** A page stored at `path` holding these blocks, then rendered for `host`. */
async function page(host: string, blocks: unknown[], query: Record<string, string> = {}): Promise<string> {
    pages["/about"] = { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Blocks: blocks } };
    requestHeaders = new Headers({ host });
    const Page = createPage(config, registry);
    return html(await Page({ params: Promise.resolve({ path: ["about"] }), searchParams: Promise.resolve(query) }));
}

const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: "text", props: { value, ...extra } });

describe("bindings on a page", () => {
    it("shows each tenant its own name through the same stored page", async () => {
        const blocks = [text("Welcome to {{site.Name}}")];

        expect(await page("academy.example", blocks)).toContain("Welcome to Mindanao Academy");
        expect(await page("clinic.example", blocks)).toContain("Welcome to Bayan Clinic");
    });

    it("reads the page's own fields by the name the tenant gave them", async () => {
        expect(await page("academy.example", [text("{{page.Title}} at {{page.Slug}}")])).toContain("About at about");
    });

    it("renders the fallback for a field that was removed, and does not fail the page", async () => {
        const html = await page("academy.example", [
            text("{{page.Subtitle ?? Nothing yet}}"),
            text("still here"),
        ]);

        expect(html).toContain("Nothing yet");
        expect(html).toContain("still here");
    });

    it("reads no site settings for a page that binds nothing", async () => {
        await page("academy.example", [text("A plain line")]);

        // One read resolves the tenant's own settings for identity and theme. A binding would be a
        // second, and there is none.
        expect(calls.filter((c) => c.startsWith("/api/public/site")).length).toBe(1);
    });
});

describe("source, repeat and paging", () => {
    const list = (extra: Record<string, unknown>, inner: unknown[]) => ({
        type: "source",
        props: {
            collection: "enrolments",
            mode: "list",
            ...extra,
            content: [[{ type: "repeat", props: { content: [inner] } }]],
        },
    });

    it("lists the rows a URL parameter chooses, assembled only from blocks", async () => {
        const html = await page(
            "academy.example",
            [list({ filterField: "Class", filterValue: "{{query.class}}" }, [text("{{item.Title}}")])],
            { class: "biology" },
        );

        expect(html).toContain("Ana Cruz");
        expect(html).toContain("Ben Dizon");
        expect(html).not.toContain("Cely Uy");
    });

    it("asks the API for the filter rather than filtering the page it got back", async () => {
        await page("academy.example", [list({ filterField: "Class", filterValue: "chemistry" }, [text("{{item.Title}}")])]);

        expect(calls.some((c) => c.includes("filter%5BClass%5D%5Beq%5D=chemistry"))).toBe(true);
    });

    it("lists nothing rather than everything when the parameter the filter needs is absent", async () => {
        const html = await page(
            "academy.example",
            [list({ filterField: "Class", filterValue: "{{query.class}}" }, [text("{{item.Title}}")])],
            {},
        );

        expect(html).not.toContain("Ana Cruz");
        expect(html).not.toContain("Cely Uy");
    });

    it("pages through the API, with links a crawler can follow", async () => {
        const blocks = [
            list({ pageSize: 2, pageParam: "p" }, [text("{{item.Title}}")]),
            {
                type: "source",
                props: {
                    collection: "enrolments",
                    mode: "list",
                    pageSize: 2,
                    pageParam: "p",
                    content: [[{ type: "pager", props: {} }]],
                },
            },
        ];

        const first = await page("academy.example", blocks);
        expect(first).toContain("Ana Cruz");
        expect(first).not.toContain("Cely Uy");
        expect(first).toContain('href="?p=2"');
        expect(first).not.toContain('href="?p=0"');

        const second = await page("academy.example", blocks, { p: "2" });
        expect(second).toContain("Cely Uy");
        expect(second).not.toContain("Ana Cruz");
        expect(second).toContain('href="?p=1"');
    });

    it("formats a bound value in the tenant's currency and locale", async () => {
        const html = await page("academy.example", [
            list({}, [text("{{item.Fee | money}}"), text("{{item.Joined | date ?? Not yet}}")]),
        ]);

        expect(html).toContain("₱1,500.00");
        expect(html).toContain("2 March 2026");
        expect(html).toContain("Not yet");
    });

    it("says the line an editor wrote when a list comes back empty", async () => {
        const html = await page("academy.example", [
            {
                type: "source",
                props: {
                    collection: "enrolments",
                    mode: "list",
                    filterField: "Class",
                    filterValue: "astronomy",
                    content: [[{ type: "repeat", props: { empty: "No one has enrolled yet.", content: [[text("{{item.Title}}")]] } }]],
                },
            },
        ]);

        expect(html).toContain("No one has enrolled yet.");
    });

    it("reads an entry's own Body and Date through a repeat when the collection maps neither", async () => {
        const html = await page("academy.example", [
            list({ collection: "changes" }, [text("[{{item.Body}}] on {{item.Date | date ?? no date}}")]),
        ]);

        expect(html).toContain("[Own body text] on 1 May 2026");
    });

    it("reads the mapped field, not the entry's own field of that name, when the collection maps the role", async () => {
        const html = await page("academy.example", [
            list({ collection: "releases" }, [text("[{{item.Body}}] on {{item.Date | date ?? no date}}")]),
        ]);

        expect(html).toContain("[Mapped notes] on 9 June 2026");
        expect(html).not.toContain("Own body text");
    });

    it("puts one entry in scope when the source names a slug", async () => {
        const html = await page("academy.example", [
            {
                type: "source",
                props: { collection: "enrolments", slug: "cely", content: [[text("{{item.Title}} in {{item.Summary}}")]] },
            },
        ]);

        expect(html).toContain("Cely Uy in chemistry");
    });

    it("renders nothing, not a 404, when the named entry is gone", async () => {
        const html = await page("academy.example", [
            {
                type: "source",
                props: { collection: "enrolments", slug: "nobody", content: [[text("{{item.Title}}")]] },
            },
            text("the rest of the page"),
        ]);

        expect(html).not.toContain("nobody");
        expect(html).toContain("the rest of the page");
    });

    it("renders nothing for a collection this tenant does not have", async () => {
        const html = await page("clinic.example", [
            { type: "source", props: { collection: "enrolments", mode: "list", content: [[text("{{item.Title}}")]] } },
            text("clinic page"),
        ]);

        expect(html).toContain("clinic page");
        expect(calls.some((c) => c.includes("/api/public/enrolment"))).toBe(false);
    });
});

describe("showIf", () => {
    const guarded = (props: Record<string, unknown>) => ({
        type: "showIf",
        props: { ...props, content: [[text("the guarded line")]] },
    });

    it("shows a block only when the value it names has one", async () => {
        expect(await page("academy.example", [guarded({ value: "{{site.Name}}" })])).toContain("the guarded line");
        expect(await page("academy.example", [guarded({ value: "{{site.Tagline}}" })])).not.toContain(
            "the guarded line",
        );
    });

    it("compares a choice against a value, and can be turned round", async () => {
        const equals = (want: string, unless = false) =>
            page("academy.example", [guarded({ value: "{{query.class}}", equals: want, unless })], {
                class: "biology",
            });

        expect(await equals("biology")).toContain("the guarded line");
        expect(await equals("chemistry")).not.toContain("the guarded line");
        expect(await equals("chemistry", true)).toContain("the guarded line");
    });
});

describe("presets", () => {
    it("renders a preset the tenant saved, with its own props bound into it", async () => {
        const html = await page("academy.example", [
            {
                type: "welcome",
                props: {
                    heading: "Enrol at {{site.Name}}",
                    tone: "accent",
                    content: [[text("inside the band")]],
                },
            },
        ]);

        expect(html).toContain("Enrol at Mindanao Academy");
        expect(html).toContain("inside the band");
        expect(html).toContain(config.theme.colors.accentTint);
    });

    it("is one tenant's, not the container's: another tenant does not have it", async () => {
        const html = await page("clinic.example", [
            { type: "welcome", props: { heading: "Not here", content: [[]] } },
            text("clinic page"),
        ]);

        expect(html).not.toContain("Not here");
        expect(html).toContain("clinic page");
    });

    it("publishes a preset to an editor beside the blocks that are code", async () => {
        requestHeaders = new Headers({ host: "academy.example" });
        const resolved = await siteConfig(config);
        const schema = blockSchema(registryFor(resolved, registry));
        const welcome = schema.blocks.find((b) => b.type === "welcome");

        expect(welcome?.layer).toBe("preset");
        expect(welcome?.fields.map((f) => f.name)).toEqual(["heading", "tone", "content"]);
        expect(welcome?.fields.find((f) => f.name === "heading")?.bindable).toBe(true);
    });

    it("never lets a preset take the name of a block the site depends on, and says so", async () => {
        const hostile = { ...BAND_PRESET, type: "collection" };
        requestHeaders = new Headers({ host: "academy.example" });
        TENANTS.academy.settings.Presets = [hostile];
        try {
            const resolved = await siteConfig(config);
            const reg = registryFor(resolved, registry);

            expect(reg.get("collection")?.layer).toBe("block");
            // Named, so somebody reading the log knows which preset to rename and what it hit.
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('the preset "collection"');
            expect(warnings[0]).toContain('for tenant "academy"');
            expect(warnings[0]).toContain('the block "Collection" is already registered');
        } finally {
            TENANTS.academy.settings.Presets = [BAND_PRESET];
        }
    });

    it("says it once however many pages a tenant serves, because the registry is built per request", async () => {
        const hostile = { ...BAND_PRESET, type: "collection" };
        requestHeaders = new Headers({ host: "academy.example" });
        TENANTS.academy.settings.Presets = [hostile];
        try {
            const resolved = await siteConfig(config);
            for (let i = 0; i < 5; i++) registryFor(resolved, registry);

            expect(warnings).toHaveLength(1);
        } finally {
            TENANTS.academy.settings.Presets = [BAND_PRESET];
        }
    });

    /*
     * One preset holding a section around forty text blocks, and enough of them that the shared
     * budget runs out before the last one. The count is derived from the budget rather than typed,
     * because the budget is a number that moves: it went from a hundred blocks to four hundred when
     * a page of library bands turned out not to fit in it (#83), and a typed twenty would then have
     * been twenty presets that all compiled and a test asserting nothing.
     */
    const HEAVY_ROWS = 40;
    const HEAVY_PRESETS = Math.min(MAX_PRESETS, Math.ceil(MAX_PRESET_BLOCKS / (HEAVY_ROWS + 1)) + 2);
    const heavyPreset = (prefix: string, n: number) => ({
        type: `${prefix}${n}`,
        label: `${prefix} ${n}`,
        fields: [],
        blocks: [
            { type: "section", props: { content: [Array.from({ length: HEAVY_ROWS }, (_, i) => text(`row ${i}`))] } },
        ],
    });

    it("says how many presets it dropped when they hold more blocks than it will compile", async () => {
        requestHeaders = new Headers({ host: "academy.example" });
        TENANTS.academy.settings.Presets = Array.from({ length: HEAVY_PRESETS }, (_, i) => heavyPreset("heavy", i));
        try {
            const resolved = await siteConfig(config);
            const reg = registryFor(resolved, registry);

            const compiled = [...reg.values()].filter((b) => b.type.startsWith("heavy"));
            expect(compiled.length).toBeGreaterThan(0);
            expect(compiled.length).toBeLessThan(HEAVY_PRESETS);

            const dropped = HEAVY_PRESETS - compiled.length;
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain(`${dropped} preset`);
            expect(warnings[0]).toContain('for tenant "academy"');
            expect(warnings[0]).toContain(`${MAX_PRESET_BLOCKS} blocks`);
        } finally {
            TENANTS.academy.settings.Presets = [BAND_PRESET];
        }
    });

    it("tells the two reasons apart, so renaming one and shortening the others are separate jobs", async () => {
        requestHeaders = new Headers({ host: "academy.example" });
        TENANTS.academy.settings.Presets = [
            { ...BAND_PRESET, type: "collection" },
            ...Array.from({ length: HEAVY_PRESETS }, (_, i) => heavyPreset("bulk", i)),
        ];
        try {
            const resolved = await siteConfig(config);
            registryFor(resolved, registry);

            expect(warnings).toHaveLength(2);
            expect(warnings.filter((w) => w.includes('the preset "collection"'))).toHaveLength(1);
            expect(warnings.filter((w) => w.includes("blocks between them"))).toHaveLength(1);
        } finally {
            TENANTS.academy.settings.Presets = [BAND_PRESET];
        }
    });
});

/*
 * The compatibility gate. barakoPress serves live sites, and their pages hold the five block types
 * that shipped before this: richText, image, columns, callToAction and collection. Stored data is
 * unchanged, so this is the same list a stored page holds, rendered through the real page route
 * with the binding pass running over it.
 */
const STORED_PAGE_0_4 = [
    { type: "richText", props: { markdown: "## Our story\n\nWe opened in *1998*." } },
    { type: "image", props: { src: "https://img.example/clinic.png", alt: "The clinic", caption: "Front door" } },
    {
        type: "columns",
        props: {
            columns: [
                [{ type: "richText", props: { markdown: "Left column" } }],
                [{ type: "richText", props: { markdown: "Right column" } }],
            ],
        },
    },
    {
        type: "callToAction",
        props: { heading: "Book a visit", text: "We are open six days.", label: "Book", href: "/contact" },
    },
    { type: "collection", props: { collection: "enrolments", heading: "Latest enrolments", limit: 2 } },
];

describe("a page stored before the block layers existed", () => {
    it("renders every one of the five types it holds", async () => {
        const html = await page("academy.example", STORED_PAGE_0_4);

        expect(html).toContain("<h2");
        expect(html).toContain("Our story");
        expect(html).toContain("<em>1998</em>");
        expect(html).toContain('src="https://img.example/clinic.png"');
        expect(html).toContain('alt="The clinic"');
        expect(html).toContain("Front door");
        expect(html).toContain("Left column");
        expect(html).toContain("Right column");
        expect(html).toContain("Book a visit");
        expect(html).toContain('href="/contact"');
        expect(html).toContain("Latest enrolments");
        expect(html).toContain("Ana Cruz");
    });

    it("keeps the type names the stored data uses, and the markup an editor styled against", async () => {
        const html = await page("academy.example", STORED_PAGE_0_4);

        for (const type of ["richText", "image", "columns", "callToAction", "collection"]) {
            expect(html).toContain(`data-block="${type}"`);
        }
        expect(html).toContain("bp-prose");
    });

    it("leaves a stored value that looks like a placeholder exactly as it was typed", async () => {
        const html = await page("academy.example", [
            { type: "richText", props: { markdown: "Write {{site.Name}} to name the site." } },
        ]);

        expect(html).toContain("Mindanao Academy");
        expect(html).not.toContain("{{site.Name}}");
    });
});

describe("what a binding may not do", () => {
    it("drops a link whose binding resolves to something that would execute", async () => {
        TENANTS.academy.settings.Attack = "javascript:alert(1)";
        try {
            const html = await page("academy.example", [
                { type: "button", props: { label: "Tap me", href: "{{site.Attack}}" } },
                text("the rest of the page"),
            ]);

            expect(html).not.toContain("Tap me");
            expect(html).not.toContain("javascript:");
            expect(html).toContain("the rest of the page");
        } finally {
            delete TENANTS.academy.settings.Attack;
        }
    });

    it("refuses a scheme in the stored value, whatever the binding after it resolves to", async () => {
        const html = await page("academy.example", [
            { type: "button", props: { label: "Tap me", href: "javascript:{{site.Name}}" } },
        ]);

        expect(html).not.toContain("Tap me");
    });

    it("escapes what a binding brings back, so a field cannot carry markup into the page", async () => {
        TENANTS.academy.settings.Bio = "<img src=x onerror=alert(1)>";
        try {
            const html = await page("academy.example", [text("{{site.Bio}}")]);

            expect(html).not.toContain("<img src=x");
            expect(html).toContain("&lt;img");
        } finally {
            delete TENANTS.academy.settings.Bio;
        }
    });

    it("bounds what one page may read and how far a repeat may go", async () => {
        const many = Array.from({ length: 12 }, () => ({
            type: "source",
            props: { collection: "enrolments", mode: "list", content: [[text("{{item.Title}}")]] },
        }));

        await page("academy.example", many);

        expect(calls.filter((c) => c.startsWith("/api/public/enrolment")).length).toBeLessThanOrEqual(8);
    });
});

/*
 * A preset a designer typed wrong in barakoBrew is read the way every other setting is: the entry is
 * left out rather than half applied. Left out quietly, it reads as saved, and somebody goes looking
 * for a block that will never appear. Each reason is its own line because each is a different thing
 * to go and correct.
 */
describe("a preset setting that is not read", () => {
    const read = (entries: unknown[]) => presetsFrom(entries, "academy");

    it("says an entry that is not a preset at all", () => {
        expect(read(["just a string"])).toEqual([]);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("entry 1 is not a preset");
        expect(warnings[0]).toContain('for tenant "academy"');
    });

    it("says a type that is not a name, apart from a type used twice", () => {
        read([
            { type: "has spaces", label: "A", fields: [] },
            { type: "band", label: "B", fields: [] },
            { type: "band", label: "C", fields: [] },
        ]);

        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain("has no type, or one that is not a name");
        expect(warnings[1]).toContain('"band" (entry 3)');
        expect(warnings[1]).toContain("uses a type an earlier preset already uses");
    });

    it("says a field list that is not a list", () => {
        expect(read([{ type: "band", label: "B", fields: "heading" }])).toEqual([]);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('"band" (entry 1)');
        expect(warnings[0]).toContain("has fields that are not a list");
    });

    it("says how many of a kept preset's fields are not fields, since a binding to one never resolves", () => {
        const presets = read([
            {
                type: "band",
                label: "B",
                fields: [
                    { name: "heading", kind: "text" },
                    { name: "tone", kind: "colour" },
                    { name: "size", kind: "select" },
                ],
            },
        ]);

        expect(presets[0].fields.map((f) => f.name)).toEqual(["heading"]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("keeps 1 of its fields, because 2 are not fields");
    });

    it("spells out a few and then says how many more, so one bad paste is not a page of log", () => {
        read(Array.from({ length: 30 }, () => "not a preset"));

        expect(warnings).toHaveLength(6);
        expect(warnings[5]).toContain("25 more preset settings");
        expect(warnings[5]).toContain("are wrong in the same way");
    });

    it("keeps a stored newline out of the log, so a settings field cannot write its own line", () => {
        read([{ type: "bad\nblocks: everything is fine", label: "A", fields: [] }]);

        expect(warnings).toHaveLength(1);
        expect(warnings[0].split("\n")).toHaveLength(1);
        expect(warnings[0]).toContain("badblocks: everything is fine");
    });

    it("says it once, however many requests read the same settings", () => {
        for (let i = 0; i < 5; i++) read(["just a string"]);

        expect(warnings).toHaveLength(1);
    });
});
