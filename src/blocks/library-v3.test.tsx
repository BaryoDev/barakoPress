import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Block library v3 (#24): the blocks barakocms.com adds, and the five pages that are the reason.
 *
 * The done-when is not "the blocks exist", it is that the home, modules, changelog, roadmap and
 * community pages assemble from blocks with no site code. So the pages are the test: each one is a
 * stored block list, rendered through the same registry a site gets from `createBlockRegistry` and
 * nothing else, and what is asserted is that the page came out whole. A block this site could not
 * render is dropped silently, which is why every page also counts what it stored against what
 * resolved: a page that quietly lost its comparison table still renders, and still looks fine.
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
const { resolveBlocks } = await import("./schema.js");
const { bindBlocks } = await import("./bind.js");
const { forgetPresetWarnings } = await import("./presets.js");
const { applySiteSettings } = await import("../site.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const MODULES: Entry[] = [
    // Icon, Word, Progress, Href, ProgressCount and ProgressTotal are this tenant's own field
    // names, deliberately, because the engine lays its own names over the entry's data and must
    // not take a field away doing it.
    {
        id: "m1",
        slug: "search",
        data: {
            Name: "Search",
            Slug: "search",
            Blurb: "Postgres full text over your content",
            Category: "Content",
            Icon: "compass",
            Word: "Alpha",
            Progress: "60",
            // Distinct, and none a substring of another, so a shadowed field cannot pass by
            // accident on a `toContain` that actually matched a sibling field's untouched value.
            Href: "tenant-owns-href-not-a-computed-link",
            ProgressCount: "tenant-owns-progresscount-no-role-set",
            ProgressTotal: "tenant-owns-progresstotal-no-role-set",
        },
    },
    { id: "m2", slug: "forms", data: { Name: "Forms", Slug: "forms", Blurb: "Submissions stored as content", Category: "Content" } },
    { id: "m3", slug: "audit", data: { Name: "Audit", Slug: "audit", Blurb: "Who changed what, and when", Category: "Operations" } },
];

const RELEASES: Entry[] = [
    { id: "r1", slug: "4-3-0", data: { Name: "4.3.0", Slug: "4-3-0", Notes: "Config as code, and the CLI that reads it.", Shipped: "2026-09-01T00:00:00Z", Kind: "feature" } },
    { id: "r2", slug: "4-2-1", data: { Name: "4.2.1", Slug: "4-2-1", Notes: "The webhook no longer followed a redirect.", Shipped: "2026-08-12T00:00:00Z", Kind: "fix" } },
];

const MILESTONES: Entry[] = [
    // Closed and Total (#105) sit alongside Percent unused by the tests that only map `progress`.
    { id: "s1", slug: "one-line", data: { Name: "Install in one line", Slug: "one-line", Blurb: "Compose, seed and a console", Percent: "80", Closed: "3", Total: "4" } },
    { id: "s2", slug: "click-deploy", data: { Name: "Click to deploy", Slug: "click-deploy", Blurb: "A VM, Azure or AWS from an app", Percent: "25", Closed: "1", Total: "4" } },
];

/*
 * Deliberately none of the blueprint's field names, and a different name in every collection, so a
 * page that only assembles because the engine guessed "Title" would not assemble here.
 */
const config = defineConfig({
    site: { name: "The CMS site", url: "https://cms.example" },
    cmsUrl: CMS,
    collections: {
        modules: {
            type: "module",
            route: "/modules",
            colorBy: "Category",
            fields: { title: "Name", slug: "Slug", summary: "Blurb" },
        },
        releases: {
            type: "release",
            colorBy: "Kind",
            fields: { title: "Name", slug: "Slug", body: "Notes", date: "Shipped" },
        },
        milestones: {
            type: "milestone",
            fields: { title: "Name", slug: "Slug", summary: "Blurb", progress: "Percent" },
        },
    },
    optionStyles: {
        "module.Category": {
            Content: { icon: "star", label: "Content", tone: "#4c63d2" },
            Operations: { icon: "clock", label: "Operations" },
        },
        "release.Kind": { feature: { label: "New" }, fix: { label: "Fixed" } },
    },
});

const registry = createBlockRegistry(config);

beforeEach(() => {
    forgetCachedReads();
    forgetPresetWarnings();
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
            const url = new URL(String(input));
            const type = url.pathname.replace(/^\/api\/public\//, "").split("/")[0];
            const entries =
                type === "module" ? MODULES : type === "release" ? RELEASES : type === "milestone" ? MILESTONES : null;
            if (entries === null) return new Response("", { status: 404 });
            let items = entries;
            for (const [key, value] of url.searchParams) {
                const match = key.match(/^filter\[(.+)\]\[eq\]$/);
                if (match) items = items.filter((e) => e.data[match[1]] === value);
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

async function render(raw: unknown[]): Promise<string> {
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
    return renderToStaticMarkup(<BlockList blocks={bound} theme={config.theme} />);
}

/** Every `type` a stored page names, at any depth, in the order it was written. */
function typesIn(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.flatMap(typesIn);
    if (typeof raw !== "object" || raw === null) return [];
    const block = raw as { type?: unknown };
    const own = typeof block.type === "string" ? [block.type] : [];
    return [...own, ...Object.values(raw as Record<string, unknown>).flatMap(typesIn)];
}

/* --------------------------------------------- the pages, as barakocms.com stores them */

const home = [
    {
        type: "announcement",
        props: { message: "4.3.0 is out, with config as code.", label: "Read the notes", href: "/changelog" },
    },
    {
        type: "hero",
        props: {
            heading: "A headless CMS you own",
            body: "One image, your database, your rules.",
            primaryLabel: "Start here",
            primaryHref: "/docs",
        },
    },
    {
        type: "statBand",
        props: {
            heading: "Where it runs",
            items: [
                [
                    { type: "stat", props: { value: "1200", label: "sites", motion: "countUp" } },
                    { type: "stat", props: { value: "0", label: "seat fees" } },
                ],
            ],
        },
    },
    {
        type: "codeTabs",
        props: {
            heading: "Three lines to start",
            code: "docker compose up -d\nbarako db apply\nbarako open",
            language: "shell",
            selectLabel: "Pindutin para kopyahin",
            items: [
                [
                    {
                        type: "codeTab",
                        props: {
                            label: "With the .NET tool",
                            code: "dotnet tool install -g barako\nbarako up",
                            language: "shell",
                            group: "start",
                        },
                    },
                ],
            ],
        },
    },
    {
        type: "cardGrid",
        props: { heading: "Modules", collection: "modules", columns: "3", option: "show" },
    },
    {
        type: "faq",
        props: {
            heading: "What it does not do",
            items: [
                [
                    {
                        type: "faqItem",
                        props: { question: "Does it meter anything?", answer: "No. There is **no seat cap**." },
                    },
                ],
            ],
        },
    },
];

const modules = [
    { type: "band", props: { heading: "Modules", body: "Each one is a package. Take the ones you want." } },
    {
        type: "cardGrid",
        props: {
            heading: "Content",
            collection: "modules",
            filterField: "Category",
            filterValue: "Content",
            option: "show",
            columns: "2",
        },
    },
    {
        type: "cardGrid",
        props: {
            heading: "Operations",
            collection: "modules",
            filterField: "Category",
            filterValue: "Operations",
            option: "show",
            columns: "2",
        },
    },
];

const changelog = [
    {
        type: "changelogList",
        props: { heading: "New", collection: "releases", filterField: "Kind", filterValue: "feature" },
    },
    {
        type: "changelogList",
        props: { heading: "Fixed", collection: "releases", filterField: "Kind", filterValue: "fix" },
    },
];

const roadmap = [
    {
        type: "progressList",
        props: { heading: "On the way", collection: "milestones", empty: "Nothing planned yet." },
    },
];

const community = [
    {
        type: "comparisonTable",
        props: {
            caption: "Where free ends",
            rows: "Capability | This | The hosted ones\nSeats | all of them | per seat\nYour database | yours | theirs\nExport | any time | on request",
        },
    },
    {
        type: "faq",
        props: {
            heading: "Asked often",
            items: [
                [
                    { type: "faqItem", props: { question: "Who runs support?", answer: "The people who write it." } },
                    { type: "faqItem", props: { question: "Can I fork it?", answer: "That is what the licence is for." } },
                ],
            ],
        },
    },
    { type: "band", props: { heading: "Come and build", label: "Open an issue", href: "/issues" } },
];

const PAGES: { name: string; blocks: unknown[] }[] = [
    { name: "home", blocks: home },
    { name: "modules", blocks: modules },
    { name: "changelog", blocks: changelog },
    { name: "roadmap", blocks: roadmap },
    { name: "community", blocks: community },
];

describe("barakocms.com's pages assemble from blocks, with no site code", () => {
    it("has a page for each of the five, and names a block on every one", () => {
        expect(PAGES).toHaveLength(5);
        for (const page of PAGES) {
            expect(typesIn(page.blocks).length, page.name).toBeGreaterThan(0);
        }
    });

    it.each(PAGES)("$name names only blocks this site already has", ({ blocks }) => {
        const types = typesIn(blocks);
        expect(types.length).toBeGreaterThan(0);
        for (const type of types) expect([...registry.keys()]).toContain(type);
    });

    /*
     * The one that catches a page that looks fine and is not. A block whose props fail its fields
     * is dropped without a word, so a page missing its comparison table still renders a heading, a
     * band and a footer, and reads as done. Counting what resolved against what was stored is the
     * only assertion that notices.
     */
    it.each(PAGES)("$name resolves every block it stores", ({ blocks }) => {
        const stored = typesIn(blocks);
        expect(stored.length).toBeGreaterThan(0);

        const count = (resolved: ReturnType<typeof resolveBlocks>): number =>
            resolved.reduce(
                (n, b) => n + 1 + Object.values(b.slots).reduce((m, lists) => m + lists.reduce((k, l) => k + count(l), 0), 0),
                0,
            );
        expect(count(resolveBlocks(blocks, registry, { perViewer: false }))).toBe(stored.length);
    });
});

describe("what each of the five pages draws", () => {
    it("draws the home page: a sticky bar, a quickstart, the module grid and the questions", async () => {
        const html = await render(home);

        // The announcement sticks, and it is one band rather than a block that scrolled away.
        expect(html).toContain("position:sticky");
        expect(html).toContain("4.3.0 is out, with config as code.");
        expect(html).toContain('href="/changelog"');

        expect(html).toContain("A headless CMS you own");
        expect(html).toContain(">1200<");

        // The quickstart is drawn, and the other way of running it is behind a disclosure.
        expect(html).toContain("docker compose up -d");
        expect(html).toContain("With the .NET tool");
        expect(html).toContain("dotnet tool install -g barako");
        expect(html).toContain("<details");
        expect(html).toContain("Pindutin para kopyahin");

        // Every module came back, each carrying the word its category's style declared.
        for (const entry of MODULES) expect(html).toContain(String(entry.data.Name));
        expect(html).toContain("Operations");
        expect(html).toContain('href="/modules/search"');

        expect(html).toContain("Does it meter anything?");
        expect(html).toContain("<strong>no seat cap</strong>");
    });

    it("draws the modules page as two filtered grids, each card marked with its category", async () => {
        const html = await render(modules);

        const cards = [...html.matchAll(/href="\/modules\//g)];
        expect(cards.length).toBe(MODULES.length);
        expect(html).toContain("Search");
        expect(html).toContain("Audit");

        // The glyph is the icon the site declared for that option, drawn from the entry and not
        // named anywhere in the block.
        expect(html).toContain("<svg");
        // Two categories, so two headings and two grids, and neither swallowed the other's entries.
        expect(html.indexOf("Content")).toBeLessThan(html.indexOf("Operations"));
    });

    it("draws the changelog grouped by kind, each entry with its version, word and notes", async () => {
        const html = await render(changelog);

        expect(html).toContain("4.3.0");
        expect(html).toContain("4.2.1");
        expect(html).toContain("New");
        expect(html).toContain("Fixed");
        expect(html).toContain("Config as code, and the CLI that reads it.");
        expect(html).toContain("The webhook no longer followed a redirect.");

        // Grouped, which means the feature band holds the feature and not the fix.
        const feature = html.indexOf("4.3.0");
        const fixed = html.indexOf("Fixed");
        expect(feature).toBeGreaterThan(-1);
        expect(feature).toBeLessThan(fixed);
    });

    it("draws the roadmap as bars that say how far along, and can be read as well as seen", async () => {
        const html = await render(roadmap);

        const bars = [...html.matchAll(/role="progressbar"/g)];
        expect(bars.length).toBe(MILESTONES.length);
        expect(html).toContain('aria-valuenow="80"');
        expect(html).toContain('aria-valuenow="25"');
        // The bar is named, so what it reports belongs to something.
        expect(html).toContain('aria-label="Install in one line"');
        expect(html).toContain("width:80%");
        expect(html).toContain("A VM, Azure or AWS from an app");
    });

    it("draws the community page's comparison as a table a screen reader can read across", async () => {
        const html = await render(community);

        expect(html).toContain("<table");
        expect(html).toContain("<caption");
        expect(html).toContain("Where free ends");
        // A heading per column and a heading per row, which is what makes a cell mean anything.
        const columns = [...html.matchAll(/scope="col"/g)];
        const rows = [...html.matchAll(/scope="row"/g)];
        expect(columns.length).toBe(3);
        expect(rows.length).toBe(3);
        expect(html).toContain("The hosted ones");
        expect(html).toContain("on request");

        expect(html).toContain("Who runs support?");
        expect(html).toContain("Come and build");
    });
});

describe("the v3 blocks on their own", () => {
    it("refuses a comparison that is a heading row and nothing under it", async () => {
        const html = await render([{ type: "comparisonTable", props: { rows: "One | Two" } }]);
        expect(html).not.toContain("<table");
    });

    it("pads a short row out so the cells stay under their own heading", async () => {
        const html = await render([
            { type: "comparisonTable", props: { rows: "Thing | A | B\nShort | only one" } },
        ]);
        const cells = [...html.matchAll(/<td/g)];
        expect(cells.length).toBe(2);
        expect(html).toContain("only one");
    });

    it("draws a progress bar's label and no bar when what arrived is not a percentage", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Soon", value: "most of the way" } }]);
        expect(html).toContain("Soon");
        expect(html).not.toContain("progressbar");
    });

    it("holds a progress bar at 100 when the figure went past it", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Done", value: "140%" } }]);
        expect(html).toContain('aria-valuenow="100"');
        expect(html).toContain("width:100%");
    });

    it("draws a bar from a count and a total when no figure was given (#105)", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Docs", count: "3", total: "5" } }]);
        expect(html).toContain('aria-valuenow="60"');
        expect(html).toContain("width:60%");
        expect(html).toContain("3 of 5");
    });

    it("rounds a count and a total to six decimals, the same as a figure already worked out", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Docs", count: "1", total: "3" } }]);
        expect(html).toContain('aria-valuenow="33.333333"');
        expect(html).toContain("width:33.333333%");
    });

    it("prefers a figure already worked out over a count and a total", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Docs", value: "40", count: "3", total: "5" } }]);
        expect(html).toContain('aria-valuenow="40"');
        expect(html).not.toContain("3 of 5");
    });

    it("draws the label and no bar when a total of zero would divide by it", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Nothing planned", count: "0", total: "0" } }]);
        expect(html).toContain("Nothing planned");
        expect(html).not.toContain("progressbar");
    });

    it("draws the label and no bar when neither a figure nor a usable count and total arrived", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Nothing yet" } }]);
        expect(html).toContain("Nothing yet");
        expect(html).not.toContain("progressbar");
    });

    it("leaves the option row off a card grid that did not ask for it", async () => {
        const html = await render([{ type: "cardGrid", props: { heading: "Modules", collection: "modules" } }]);
        expect(html).toContain("Search");
        expect(html).not.toContain("<svg");
    });

    /*
     * barakoPress #91: the entry's own colour on its card, not the theme's accent. "Content" is
     * configured with a tone of its own above; "Operations" (module m3) is configured with none, so
     * that entry keeps drawing in the theme's accent exactly as it always did.
     */
    it("tints a card grid's option glyph with the entry's own colour where one is configured", async () => {
        const html = await render([
            { type: "cardGrid", props: { heading: "Modules", collection: "modules", option: "show" } },
        ]);
        expect(html).toContain("color-mix(in srgb, #4c63d2");
    });

    it("draws a card grid's cards typed in place when it has no collection to read", async () => {
        const html = await render([
            {
                type: "cardGrid",
                props: {
                    heading: "Tools",
                    items: [
                        [
                            { type: "card", props: { title: "Mapsicle", tag: "C#", icon: "star", tint: "#4c63d2" } },
                            { type: "card", props: { title: "Verdict", tag: "C#" } },
                        ],
                    ],
                },
            },
        ]);
        expect(html).toContain("Mapsicle");
        expect(html).toContain("Verdict");
        expect(html).toContain("color-mix(in srgb, #4c63d2");
    });

    it("opens one code tab at a time, and every tab in the group closes the last", async () => {
        const html = await render([
            {
                type: "codeTabs",
                props: {
                    code: "one",
                    group: "start",
                    items: [
                        [
                            { type: "codeTab", props: { label: "Two", code: "two", group: "start" } },
                            { type: "codeTab", props: { label: "Three", code: "three", group: "start" } },
                        ],
                    ],
                },
            },
        ]);
        // Three, not two: the primary sample is one of the strip's tabs now, and it shares the
        // group its own codeTabs.group names, not the fixed "codeTabs" every unrelated strip on
        // the same page also defaults to.
        const grouped = [...html.matchAll(/name="start"/g)];
        expect(grouped.length).toBe(3);
    });

    /*
     * barakoPress #91, found rendering the actual baryo.dev fixture in a browser rather than reading
     * the diff: the primary sample became one of the strip's tabs and kept a group of its own
     * ("codeTabs") while its codeTab children, left at the preset's default, shared the same one, so
     * this passed by construction until a page set a group on the children without also setting one
     * on codeTabs. Two strips on one page need distinct groups exactly the way two `codeTab`s always
     * have, which is why `codeTabs.group` exists: set once, it reaches the primary the same way a
     * `codeTab` already reaches its own.
     */
    it("keeps the primary sample out of the strip's exclusivity group if nothing named one for it", async () => {
        const html = await render([
            {
                type: "codeTabs",
                props: {
                    code: "one",
                    items: [
                        [{ type: "codeTab", props: { label: "Two", code: "two", group: "install" } }],
                    ],
                },
            },
        ]);
        // The child asked for "install" and got it, on its own radio, but nothing named a group
        // for the primary, so it keeps the untouched default rather than joining a group it was
        // never asked to join.
        expect([...html.matchAll(/name="install"/g)]).toHaveLength(1);
        expect([...html.matchAll(/name="codeTabs"/g)]).toHaveLength(1);
    });

    it("shares one group by default, with nothing set on either the primary or its tabs", async () => {
        const html = await render([
            {
                type: "codeTabs",
                props: {
                    code: "one",
                    items: [
                        [
                            { type: "codeTab", props: { label: "Two", code: "two" } },
                            { type: "codeTab", props: { label: "Three", code: "three" } },
                        ],
                    ],
                },
            },
        ]);
        expect([...html.matchAll(/name="codeTabs"/g)]).toHaveLength(3);
    });

    it("leaves every question openable at once, which is the whole of the difference from tabs", async () => {
        const html = await render([
            {
                type: "faq",
                props: {
                    items: [
                        [
                            { type: "faqItem", props: { question: "One?", answer: "Yes." } },
                            { type: "faqItem", props: { question: "Two?", answer: "Also yes." } },
                        ],
                    ],
                },
            },
        ]);
        const details = [...html.matchAll(/<details/g)];
        expect(details.length).toBe(2);
        expect(html).not.toContain("name=");
    });
});

/*
 * The baryo.dev look fixture (#83), against the engine rather than against a picture of it.
 *
 * The look check found this by comparing screenshots: the rebuilt page came back two thirds the
 * height of the design and the band at the bottom was not in it. What had happened is that eight
 * bands of library presets spend more than the block budget, so the binder stopped partway and the
 * page rendered as though it ended there. A screenshot is a slow way to find that out, so it is a
 * test here now.
 */
describe("a real page of bands, as long as a site's home page", () => {
    it("binds every band the fixture stores, rather than stopping partway", async () => {
        const stored = JSON.parse(
            readFileSync(resolve(import.meta.dirname, "../../look/fixtures/baryo-dev/home.blocks.json"), "utf8"),
        ) as { type: string }[];

        expect(stored.length).toBeGreaterThan(5);

        const resolved = resolveBlocks(stored, registry, { perViewer: false });
        expect(resolved).toHaveLength(stored.length);

        const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
        // Every band is a section or a block of its own once its preset is expanded, so the count
        // holding is the whole assertion: one short means the tail of the page is missing.
        expect(bound).toHaveLength(stored.length);
    });
});

/*
 * The three boundaries this change reaches across, each exercised from the unchanged side.
 *
 * A field role is not one file's business: a tenant types it into `Collections` in barakoBrew,
 * site.ts decides whether that is a role at all, collections.ts reads the field off the entry, and
 * a block reads it through the item scope. Four files, and a test that stops at any one of them
 * passes while a page renders nothing.
 */
describe("across the files a new field role touches", () => {
    it("carries a tenant's own progress field from its settings through to the block that draws it", async () => {
        const tenant = applySiteSettings(
            defineConfig({ site: { name: "Roadmap", url: "https://roadmap.example" }, cmsUrl: CMS }),
            {
                Name: "Roadmap",
                Collections: {
                    milestones: {
                        type: "milestone",
                        // The tenant's own name for it, which is the whole point of a role.
                        fields: { title: "Name", slug: "Slug", summary: "Blurb", progress: "Percent" },
                    },
                },
            },
            "roadmap.example",
        );

        expect(tenant.collections.milestones?.fields.progress).toBe("Percent");

        const reg = createBlockRegistry(tenant);
        const resolved = resolveBlocks(
            [{ type: "progressList", props: { heading: "On the way", collection: "milestones" } }],
            reg,
            { perViewer: false },
        );
        const bound = await bindBlocks(resolved, { config: tenant, registry: reg, scopes: {} });
        const html = renderToStaticMarkup(<BlockList blocks={bound} theme={tenant.theme} />);

        expect(html).toContain("On the way");
        expect(html).toContain('aria-valuenow="80"');
        expect(html).toContain('aria-label="Install in one line"');
    });

    /*
     * #105: a GitHub milestone answers open and closed issues, not a percentage. progressList reads
     * two field roles instead of one and progressBar does the division, so the roadmap page needs no
     * computed figure on either side.
     */
    it("draws progress from a count and a total when the source gives two counts instead of one figure", async () => {
        const tenant = applySiteSettings(
            defineConfig({ site: { name: "Roadmap", url: "https://roadmap.example" }, cmsUrl: CMS }),
            {
                Name: "Roadmap",
                Collections: {
                    milestones: {
                        type: "milestone",
                        fields: { title: "Name", slug: "Slug", summary: "Blurb", progressCount: "Closed", progressTotal: "Total" },
                    },
                },
            },
            "roadmap.example",
        );

        expect(tenant.collections.milestones?.fields.progressCount).toBe("Closed");
        expect(tenant.collections.milestones?.fields.progressTotal).toBe("Total");

        const reg = createBlockRegistry(tenant);
        const resolved = resolveBlocks(
            [{ type: "progressList", props: { heading: "On the way", collection: "milestones" } }],
            reg,
            { perViewer: false },
        );
        const bound = await bindBlocks(resolved, { config: tenant, registry: reg, scopes: {} });
        const html = renderToStaticMarkup(<BlockList blocks={bound} theme={tenant.theme} />);

        expect(html).toContain("On the way");
        expect(html).toContain('aria-valuenow="75"');
        expect(html).toContain("3 of 4");
        expect(html).toContain('aria-valuenow="25"');
        expect(html).toContain("1 of 4");
    });

    /*
     * The binding report (#63) reads the same bindings a page does, so a preset that reads a value
     * an entry may not have puts a problem in an editor's report for a placeholder they never typed.
     * The option row is one of those, and so is the date the card grid has always drawn, which is
     * what settles it: this is the shape the report already has rather than a new one. The report
     * names the block and the field, so it reads as the block's business and not the page's.
     */
    it("reports an option row's missing glyph the same way it reports a card's missing date", async () => {
        const problems: { block?: string; field?: string; binding: string }[] = [];
        const resolved = resolveBlocks(
            [{ type: "cardGrid", props: { heading: "Modules", collection: "milestones", option: "show" } }],
            registry,
            { perViewer: false },
        );
        await bindBlocks(resolved, {
            config,
            registry,
            scopes: {},
            onProblem: (problem) => problems.push(problem),
        });

        expect(problems.length).toBeGreaterThan(0);
        // The collection this grid reads declares no option styles and no date, so both are absent,
        // and both are reported against the block that reads them.
        const named = problems.filter((p) => p.block === "icon" || p.block === "text");
        expect(named.length).toBeGreaterThan(0);
        for (const problem of named) expect(problem.field).toBeTruthy();
    });
});

/*
 * The look fixture's settings, read by the file that reads a tenant's settings.
 *
 * The fixture is a site's configuration, and a value in it that site.ts does not accept is a value
 * that silently stays at the default. That happened while this was being built: a column floor was
 * changed in the fixture, the run used the old one, and the difference showed up as a layout nobody
 * could explain. It is one assertion to stop it happening to whoever converts the next site.
 */
describe("the baryo.dev fixture's settings", () => {
    it("are settings this engine reads, not values that quietly stay at the default", () => {
        const raw = JSON.parse(
            readFileSync(resolve(import.meta.dirname, "../../look/fixtures/baryo-dev/site.json"), "utf8"),
        ) as Record<string, unknown>;
        const base = defineConfig({ site: { name: "x", url: "https://x.example" }, cmsUrl: CMS });
        const applied = applySiteSettings(base, raw, "baryo.dev");

        const colors = raw.Colors as Record<string, string>;
        const layout = raw.Layout as Record<string, string>;
        expect(Object.keys(colors).length).toBeGreaterThan(0);
        expect(Object.keys(layout).length).toBeGreaterThan(0);

        for (const [role, value] of Object.entries(colors)) {
            expect(applied.theme.colors[role as keyof typeof applied.theme.colors], role).toBe(value);
        }
        for (const [role, value] of Object.entries(layout)) {
            expect(applied.theme.layout[role as keyof typeof applied.theme.layout], role).toBe(value);
        }
        expect(applied.site.name).toBe(raw.Name);
        expect(applied.home?.path).toBe(raw.HomePath);
    });
});

/*
 * The rest of what a review found by measuring. Each is silent: the page renders, and what it draws
 * is not what the block says it draws.
 */
describe("what a v3 block does with input nobody types on purpose", () => {
    it("draws a comparison whose rows were typed with blank lines between them", async () => {
        const rows = ["Thing | A | B", "", "One | yes | no", "", "Two | no | yes"].join("\n");
        const html = await render([{ type: "comparisonTable", props: { rows } }]);

        expect(html).toContain("<table");
        expect(html).toContain("One");
        expect(html).toContain("Two");
    });

    it("draws a comparison that was padded past its row budget with blank lines", async () => {
        const rows = "\n".repeat(21) + "Thing | A\nOne | yes";
        const html = await render([{ type: "comparisonTable", props: { rows } }]);

        expect(html).toContain("<table");
        expect(html).toContain("One");
    });

    it("draws a bar for a percentage that is not a round number", async () => {
        const html = await render([{ type: "progressBar", props: { label: "Two of three", value: "66.666667" } }]);

        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-valuenow="66.666667"');
    });

    /*
     * `walk` reads a path with `Object.hasOwn`, so a key set to `undefined` is a hit and not a miss.
     * A collection whose own field is called Icon, on a site that declared no option styles, used to
     * lose it: the engine's name went over the top holding nothing.
     */
    it("leaves a tenant's own Icon, Word, Progress, Href, ProgressCount and ProgressTotal fields alone when the site declared none", async () => {
        const plain = defineConfig({
            site: { name: "Plain", url: "https://plain.example" },
            cmsUrl: CMS,
            // No route: with one, `Href` is always the computed link (unchanged, pre-existing
            // behaviour), so the case worth guarding is a collection with none at all, where #104
            // leaves `Href` unset unless the site names an `href` field.
            collections: {
                modules: { type: "module", fields: { title: "Name", slug: "Slug", summary: "Blurb" } },
            },
        });
        const reg = createBlockRegistry(plain);
        const resolved = resolveBlocks(
            [
                {
                    type: "section",
                    props: {
                        content: [
                            [
                                {
                                    type: "source",
                                    props: {
                                        collection: "modules",
                                        mode: "list",
                                        content: [
                                            [
                                                {
                                                    type: "repeat",
                                                    props: {
                                                        content: [
                                                            [
                                                                { type: "text", props: { value: "{{item.Icon}}" } },
                                                                { type: "text", props: { value: "{{item.Word}}" } },
                                                                { type: "text", props: { value: "{{item.Progress}}" } },
                                                                { type: "text", props: { value: "{{item.Href}}" } },
                                                                { type: "text", props: { value: "{{item.ProgressCount}}" } },
                                                                { type: "text", props: { value: "{{item.ProgressTotal}}" } },
                                                            ],
                                                        ],
                                                    },
                                                },
                                            ],
                                        ],
                                    },
                                },
                            ],
                        ],
                    },
                },
            ],
            reg,
            { perViewer: false },
        );
        const bound = await bindBlocks(resolved, { config: plain, registry: reg, scopes: {} });
        const html = renderToStaticMarkup(<BlockList blocks={bound} theme={plain.theme} />);

        // The entries carry these under their own names, and this site declared no option styles,
        // no progress role, no progressCount or progressTotal role, and no route or href field, so
        // nothing of the engine's may be laid over them.
        expect(html).toContain("compass");
        expect(html).toContain("Alpha");
        expect(html).toContain("60");
        expect(html).toContain("tenant-owns-href-not-a-computed-link");
        expect(html).toContain("tenant-owns-progresscount-no-role-set");
        expect(html).toContain("tenant-owns-progresstotal-no-role-set");
    });
});
