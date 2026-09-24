import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The block library of barakoPress #21, rendered the way a page renders it: resolved against the
 * site's registry, bound, then drawn. Every block here is a preset, so what is under test is the
 * arrangement and the props it exposes, not a component.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { blockSchema, resolveBlocks } = await import("./schema.js");
const { bindBlocks } = await import("./bind.js");
const { libraryPresets } = await import("./library.js");
const { forgetPresetWarnings } = await import("./presets.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const PROJECTS: Entry[] = [
    { id: "p1", slug: "clean-water", data: { Name: "Clean water", Slug: "clean-water", Blurb: "A well for two barangays", Held: "2026-03-02T00:00:00Z", Area: "community" } },
    { id: "p2", slug: "reading-camp", data: { Name: "Reading camp", Slug: "reading-camp", Blurb: "Six Saturdays of books", Area: "literacy" } },
];

const PEOPLE: Entry[] = [
    { id: "b1", slug: "ana", data: { Name: "Ana Cruz", Slug: "ana", Role: "President", Photo: "https://img.test/ana.png" } },
];

/** A collection filled by a sync, carrying the source's own URL rather than a route on this site (#104). */
const PACKAGES: Entry[] = [
    { id: "pk1", slug: "barako-cli", data: { Name: "barako CLI", Slug: "barako-cli", Blurb: "Build and configure", Link: "https://www.nuget.org/packages/barako-cli" } },
];

const config = defineConfig({
    site: { name: "Test club", url: "https://club.example" },
    cmsUrl: CMS,
    collections: {
        projects: {
            type: "project",
            route: "/projects",
            fields: { title: "Name", slug: "Slug", summary: "Blurb", date: "Held" },
        },
        board: {
            type: "member",
            route: "/board",
            fields: { title: "Name", slug: "Slug", summary: "Role", image: "Photo" },
        },
        packages: {
            type: "package",
            fields: { title: "Name", slug: "Slug", summary: "Blurb", href: "Link" },
        },
    },
});

const registry = createBlockRegistry(config);

let calls: string[] = [];

beforeEach(() => {
    calls = [];
    forgetCachedReads();
    forgetPresetWarnings();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
            const url = new URL(String(input));
            calls.push(url.pathname + url.search);
            const type = url.pathname.replace(/^\/api\/public\//, "").split("/")[0];
            const entries = type === "project" ? PROJECTS : type === "member" ? PEOPLE : type === "package" ? PACKAGES : null;
            if (entries === null) return new Response("", { status: 404 });
            let items = entries;
            for (const [key, value] of url.searchParams) {
                const m = key.match(/^filter\[(.+)\]\[eq\]$/);
                if (m) items = items.filter((e) => e.data[m[1]] === value);
            }
            return Response.json({
                items,
                page: 1,
                pageSize: 12,
                totalItems: items.length,
                totalPages: 1,
                hasNextPage: false,
            });
        }),
    );
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A stored page, resolved, bound and rendered, exactly as `createPage` does it. */
async function page(raw: unknown[], cfg = config, reg = registry): Promise<string> {
    const resolved = resolveBlocks(raw, reg, { perViewer: false });
    const bound = await bindBlocks(resolved, { config: cfg, registry: reg, scopes: {} });
    return renderToStaticMarkup(<BlockList blocks={bound} theme={cfg.theme} />);
}

const box = (content: unknown[]) => ({ type: "section", props: { content: [content] } });

describe("the layout the library needed", () => {
    it("lays one list out as cells, instead of stacking it", async () => {
        const stats = [
            { type: "text", props: { value: "62 members" } },
            { type: "text", props: { value: "18 projects" } },
        ];
        const html = await page([{ type: "flow", props: { columns: "3", content: [stats] } }]);

        expect(html).toContain("display:grid");
        // Three columns is three tracks of a third of the row, with the column floor under them, so
        // a row that cannot hold three wraps instead of scrolling sideways. See gridColumns.
        expect(html).toContain("repeat(auto-fit,");
        expect(html).toContain(config.theme.layout.columnMin);
        expect(html).toContain("/ 3)");
        // The list inside is taken out of the box tree, so those two blocks are the cells: the
        // flow says `contents` and the list it holds reads it.
        expect(html).toContain("--bp-list:contents");
        expect(html).toContain("display:var(--bp-list, flex)");
        expect(html).toContain("62 members");
        expect(html).toContain("18 projects");
    });

    it("wraps at natural widths when it is not asked for a column count", async () => {
        const html = await page([
            { type: "flow", props: { columns: "auto", content: [[{ type: "text", props: { value: "one" } }]] } },
        ]);

        expect(html).toContain("flex-wrap:wrap");
        expect(html).not.toContain("display:grid");
    });

    it("puts the list back for whatever a block inside it holds", async () => {
        const html = await page([
            {
                type: "flow",
                props: {
                    columns: "2",
                    content: [[{ type: "stack", props: { content: [[{ type: "text", props: { value: "deep" } }]] } }]],
                },
            },
        ]);

        // Without the reset, the stack's own list would be transparent too and its blocks would
        // land in the flow's grid.
        expect(html).toContain('data-block="stack" style="--bp-list:flex"');
        expect(html.split("--bp-list:contents").length - 1).toBe(1);
    });

    it("takes the gap between blocks from a stylesheet when one sets it, at every level", async () => {
        const html = await page([
            { type: "stack", props: { content: [[{ type: "text", props: { value: "deep" } }]] } },
        ]);

        // Two lists, the page's and the stack's, and both read the property rather than a length a
        // stylesheet could never override.
        const gap = `gap:var(--bp-gap, ${config.theme.space.lg})`;
        expect(html.split(gap).length - 1).toBe(2);
        expect(html).not.toContain("--bp-gap:");
    });

    it("draws a panel from the theme, framed unless it is told not to", async () => {
        const framed = await page([{ type: "panel", props: { content: [[]] } }]);

        expect(framed).toContain(`background:${config.theme.colors.surface}`);
        expect(framed).toContain(`border-radius:${config.theme.radii.panel}`);
        expect(framed).toContain(`padding:${config.theme.space.lg}`);
        expect(framed).toContain(`border:1px solid ${config.theme.colors.hairline}`);

        const bare = await page([{ type: "panel", props: { border: false, content: [[]] } }]);
        expect(bare).not.toContain("border:1px");
    });

    it("opens a disclosure only when it is told to, and groups it when it is named", async () => {
        const shut = await page([{ type: "disclosure", props: { label: "Officers", content: [[]] } }]);

        expect(shut).toContain("<details");
        expect(shut).toContain("<summary");
        expect(shut).toContain("Officers");
        expect(shut).not.toContain("open=");

        const open = await page([
            { type: "disclosure", props: { label: "Officers", open: true, group: "about", content: [[]] } },
        ]);
        expect(open).toContain('open=""');
        expect(open).toContain('name="about"');
    });

    it("hands a band's tone to the blocks inside it", async () => {
        const html = await page([
            {
                type: "section",
                props: {
                    tone: "inverse",
                    content: [
                        [
                            { type: "text", props: { value: "On the dark band", variant: "title" } },
                            { type: "text", props: { value: "And the line under it" } },
                        ],
                    ],
                },
            },
        ]);

        // The band publishes its ink, and the heading inside reads it rather than the page's, which
        // is what stops dark ink landing on a dark panel.
        expect(html).toContain(`--bp-ink:${config.theme.colors.surface}`);
        expect(html).toContain(`--bp-ink-soft:${config.theme.colors.darkPanelInk}`);
        expect(html).toContain("color:var(--bp-ink, ");
        expect(html).toContain("color:var(--bp-ink-soft, ");
        expect(html).not.toContain(`color:${config.theme.colors.ink}`);
    });
});

/** Every entry in a stored block list, nested lists and all. */
function countRaw(raw: unknown): number {
    if (!Array.isArray(raw)) return 0;
    let n = 0;
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        n++;
        const props = (entry as { props?: Record<string, unknown> }).props ?? {};
        for (const value of Object.values(props)) {
            if (Array.isArray(value)) for (const list of value) n += countRaw(list);
        }
    }
    return n;
}

function countResolved(blocks: readonly { slots: Record<string, unknown[][]> }[]): number {
    return blocks.reduce(
        (n, b) =>
            n +
            1 +
            Object.values(b.slots).reduce(
                (m, lists) => m + countResolved(lists.flat() as Parameters<typeof countResolved>[0]),
                0,
            ),
        0,
    );
}

describe("the library as an editor sees it", () => {
    const schema = blockSchema(registry);

    it("publishes every block in it as a preset, with the props it exposes", () => {
        const presets = libraryPresets();

        expect(presets.length).toBeGreaterThan(10);
        for (const preset of presets) {
            const published = schema.blocks.find((b) => b.type === preset.type);
            expect(published, preset.type).toBeDefined();
            expect(published?.layer).toBe("preset");
            expect(published?.fields.map((f) => f.name)).toEqual(preset.fields.map((f) => f.name));
        }
    });

    it("compiles every block in it, with nothing in an arrangement dropped", () => {
        for (const preset of libraryPresets()) {
            const compiled = registry.get(preset.type);
            const body = compiled?.preset ?? [];

            expect(body.length, preset.type).toBeGreaterThan(0);
            // A body block naming a type this site does not have, or passing a prop its field
            // refuses, is dropped silently. The counts differ the moment one is.
            expect(countResolved(body), preset.type).toBe(countRaw(preset.blocks));
        }
    });

    it("names tokens and never a colour or a length, anywhere in an arrangement", () => {
        const looksLikeCss = /^#[0-9a-f]{3}|[0-9](px|rem|em)$|^rgb|^hsl/i;
        const walk = (raw: unknown): string[] => {
            if (typeof raw === "string") return [raw];
            if (Array.isArray(raw)) return raw.flatMap(walk);
            if (raw && typeof raw === "object") return Object.values(raw).flatMap(walk);
            return [];
        };

        const values = libraryPresets().flatMap((p) => [
            ...walk(p.blocks),
            ...p.fields.flatMap((f) => f.options ?? []),
        ]);

        expect(values.length).toBeGreaterThan(50);
        for (const value of values) expect(value).not.toMatch(looksLikeCss);
    });
});

describe("the bands", () => {
    it("renders a hero with its copy, both buttons and its image", async () => {
        const html = await page([
            {
                type: "hero",
                props: {
                    heading: "Service above self",
                    body: "Rotary Club of Koronadal",
                    image: "https://img.test/hero.png",
                    imageAlt: "Members planting",
                    primaryLabel: "Join us",
                    primaryHref: "/join",
                    secondaryLabel: "Our projects",
                    secondaryHref: "/projects",
                    columns: "2",
                    tone: "accent",
                },
            },
        ]);

        expect(html).toContain("Service above self");
        expect(html).toContain("Rotary Club of Koronadal");
        expect(html).toContain('href="/join"');
        expect(html).toContain('href="/projects"');
        expect(html).toContain('src="https://img.test/hero.png"');
        expect(html).toContain('alt="Members planting"');
        expect(html).toContain(`background:${config.theme.colors.accentTint}`);
        expect(html).toContain("/ 2)");
    });

    it("leaves out a hero's buttons, and the row they would have sat in, when there is no link", async () => {
        const html = await page([{ type: "hero", props: { heading: "Just a heading" } }]);

        expect(html).toContain("Just a heading");
        expect(html).not.toContain("<a ");
        // One flow, the one the heading and the image share. The row the buttons would have sat in
        // is not rendered empty.
        expect(html.split('data-block="flow"').length - 1).toBe(1);
    });

    it("renders a band with one call to action", async () => {
        const html = await page([
            {
                type: "band",
                props: {
                    tone: "inverse",
                    heading: "End Polio Now",
                    body: "We are this close.",
                    label: "Donate",
                    href: "https://give.example/polio",
                },
            },
        ]);

        expect(html).toContain("End Polio Now");
        expect(html).toContain("We are this close.");
        expect(html).toContain('href="https://give.example/polio"');
        expect(html).toContain(`background:${config.theme.colors.darkPanel}`);
    });

    it("puts a stat band's figures in the columns it was asked for", async () => {
        const stat = (value: string, label: string) => [{ type: "stat", props: { value, label } }];
        const html = await page([
            {
                type: "statBand",
                props: {
                    heading: "The club",
                    columns: "3",
                    items: [stat("62", "Members"), stat("18", "Projects"), stat("1962", "Chartered")],
                },
            },
        ]);

        expect(html).toContain("The club");
        expect(html).toContain("/ 3)");
        for (const word of ["62", "Members", "18", "Projects", "1962", "Chartered"]) {
            expect(html).toContain(word);
        }
    });

    it("renders a timeline, steps and a table of facts from their entries", async () => {
        const html = await page([
            {
                type: "timeline",
                props: {
                    heading: "Our history",
                    items: [[{ type: "timelineEntry", props: { date: "1962", title: "Chartered", body: "With 24 members." } }]],
                },
            },
            {
                type: "steps",
                props: {
                    heading: "How to join",
                    items: [[{ type: "step", props: { number: "1", title: "Come to a meeting" } }]],
                },
            },
            {
                type: "keyValueTable",
                props: {
                    heading: "At a glance",
                    rows: [[{ type: "keyValueRow", props: { label: "Meets", value: "Thursdays, 6pm" } }]],
                },
            },
        ]);

        expect(html).toContain("Our history");
        expect(html).toContain("1962");
        expect(html).toContain("With 24 members.");
        expect(html).toContain("Come to a meeting");
        expect(html).toContain("At a glance");
        expect(html).toContain("Thursdays, 6pm");
    });

    it("renders giving tiers, each with its own call to action", async () => {
        const html = await page([
            {
                type: "tiers",
                props: {
                    heading: "Ways to give",
                    columns: "2",
                    items: [
                        [{ type: "tier", props: { name: "Friend", amount: "1,000", body: "Once a year.", label: "Give", href: "/give/friend" } }],
                        [{ type: "tier", props: { name: "Patron", amount: "10,000", body: "Monthly.", label: "Give", href: "/give/patron" } }],
                    ],
                },
            },
        ]);

        expect(html).toContain("Friend");
        expect(html).toContain("Patron");
        expect(html).toContain('href="/give/friend"');
        expect(html).toContain('href="/give/patron"');
        expect(html).toContain("/ 2)");
    });

    it("frames a map only from a host the site allows", async () => {
        const allowed = await page([
            {
                type: "map",
                props: { heading: "Find us", src: "https://www.google.com/maps/embed?pb=1", title: "Where we meet" },
            },
        ]);

        expect(allowed).toContain("Find us");
        expect(allowed).toContain("<iframe");
        expect(allowed).toContain("sandbox=");

        const elsewhere = await page([
            { type: "map", props: { src: "https://maps.evil.example/x", title: "Where we meet" } },
        ]);
        expect(elsewhere).not.toContain("<iframe");
    });

    it("renders tabs as sections that open, one at a time when they share a group", async () => {
        const html = await page([
            {
                type: "tabs",
                props: {
                    heading: "Officers",
                    items: [
                        [
                            {
                                type: "disclosure",
                                props: {
                                    label: "Board",
                                    group: "officers",
                                    open: true,
                                    content: [[{ type: "text", props: { value: "The board" } }]],
                                },
                            },
                            {
                                type: "disclosure",
                                props: {
                                    label: "Committees",
                                    group: "officers",
                                    content: [[{ type: "text", props: { value: "The committees" } }]],
                                },
                            },
                        ],
                    ],
                },
            },
        ]);

        expect(html.split("<details").length - 1).toBe(2);
        expect(html.split('name="officers"').length - 1).toBe(2);
        expect(html).toContain("Board");
        expect(html).toContain("The committees");
    });
});

describe("the bands that read a collection", () => {
    it("renders a card per entry, with a link to it and the date the tenant stored", async () => {
        const html = await page([
            { type: "cardGrid", props: { heading: "Our projects", collection: "projects", columns: "2" } },
        ]);

        expect(html).toContain("Our projects");
        expect(html).toContain("/ 2)");
        expect(html).toContain('href="/projects/clean-water"');
        expect(html).toContain("Clean water");
        expect(html).toContain("A well for two barangays");
        expect(html).toContain('href="/projects/reading-camp"');
        expect(html).toContain("2 March 2026");
    });

    it("asks the API for the filter rather than filtering the page it got back", async () => {
        const html = await page([
            {
                type: "cardGrid",
                props: { collection: "projects", filterField: "Area", filterValue: "literacy" },
            },
        ]);

        expect(calls.some((c) => c.includes("filter%5BArea%5D%5Beq%5D=literacy"))).toBe(true);
        expect(html).toContain("Reading camp");
        expect(html).not.toContain("Clean water");
    });

    it("says the line an editor wrote when a collection comes back empty", async () => {
        const html = await page([
            {
                type: "cardGrid",
                props: {
                    collection: "projects",
                    filterField: "Area",
                    filterValue: "nothing-here",
                    empty: "No projects yet.",
                },
            },
        ]);

        expect(html).toContain("No projects yet.");
        expect(html).not.toContain("Clean water");
    });

    it("renders nothing for a collection this site does not have, and keeps the page", async () => {
        const html = await page([
            { type: "cardGrid", props: { heading: "Ships", collection: "ships" } },
            { type: "text", props: { value: "the rest of the page" } },
        ]);

        expect(html).toContain("the rest of the page");
        expect(calls.some((c) => c.includes("/api/public/ship"))).toBe(false);
    });

    /*
     * #104: a collection with no site route (the packages page's shape) links each card through its
     * own field instead, since `{{item.Href}}` only ever existed for a collection with a route.
     */
    it("links a card to a field on the entry when the collection has no site route", async () => {
        const html = await page([
            { type: "cardGrid", props: { heading: "Packages", collection: "packages" } },
        ]);

        expect(html).toContain('href="https://www.nuget.org/packages/barako-cli"');
        expect(html).toContain("barako CLI");
    });

    it("puts people read from a collection and people typed in place in one grid", async () => {
        const html = await page([
            {
                type: "peopleGrid",
                props: {
                    heading: "Our board",
                    collection: "board",
                    columns: "3",
                    items: [[{ type: "person", props: { name: "Ben Dizon", role: "Past president" } }]],
                },
            },
        ]);

        expect(html).toContain("Our board");
        expect(html).toContain("Ana Cruz");
        expect(html).toContain("President");
        expect(html).toContain('src="https://img.test/ana.png"');
        expect(html).toContain("Ben Dizon");
        expect(html).toContain("Past president");
    });
});

describe("a site that wants one of them to look different", () => {
    it("takes the tenant's own block of that name instead, with nothing said about it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const own = createBlockRegistry(config, [], {
            presets: [
                {
                    type: "band",
                    label: "Band",
                    fields: [{ name: "heading", kind: "text", required: true }],
                    blocks: [{ type: "text", props: { value: "{{props.heading}}", variant: "meta" } }],
                },
            ],
        });

        const html = await page([{ type: "band", props: { heading: "A quiet band" } }], config, own);

        expect(own.get("band")?.layer).toBe("preset");
        expect(html).toContain("A quiet band");
        // The shipped band is a section around its heading. This one is one line of meta text.
        expect(html).not.toContain("<section");
        expect(html).toContain(`font-size:${config.theme.text.meta}`);
        expect(warn).not.toHaveBeenCalled();
    });

    it("still refuses a name a code block already has", async () => {
        const warnings: string[] = [];
        vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
            warnings.push(args.map(String).join(" "));
        });
        const own = createBlockRegistry(config, [], {
            presets: [{ type: "collection", label: "Mine", fields: [], blocks: [] }],
        });

        expect(own.get("collection")?.layer).toBe("block");
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('the preset "collection"');
    });
});
