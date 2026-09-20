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

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const MODULES: Entry[] = [
    { id: "m1", slug: "search", data: { Name: "Search", Slug: "search", Blurb: "Postgres full text over your content", Category: "Content" } },
    { id: "m2", slug: "forms", data: { Name: "Forms", Slug: "forms", Blurb: "Submissions stored as content", Category: "Content" } },
    { id: "m3", slug: "audit", data: { Name: "Audit", Slug: "audit", Blurb: "Who changed what, and when", Category: "Operations" } },
];

const RELEASES: Entry[] = [
    { id: "r1", slug: "4-3-0", data: { Name: "4.3.0", Slug: "4-3-0", Notes: "Config as code, and the CLI that reads it.", Shipped: "2026-09-01T00:00:00Z", Kind: "feature" } },
    { id: "r2", slug: "4-2-1", data: { Name: "4.2.1", Slug: "4-2-1", Notes: "The webhook no longer followed a redirect.", Shipped: "2026-08-12T00:00:00Z", Kind: "fix" } },
];

const MILESTONES: Entry[] = [
    { id: "s1", slug: "one-line", data: { Name: "Install in one line", Slug: "one-line", Blurb: "Compose, seed and a console", Percent: "80" } },
    { id: "s2", slug: "click-deploy", data: { Name: "Click to deploy", Slug: "click-deploy", Blurb: "A VM, Azure or AWS from an app", Percent: "25" } },
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
            Content: { icon: "star", label: "Content" },
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

    it("leaves the option row off a card grid that did not ask for it", async () => {
        const html = await render([{ type: "cardGrid", props: { heading: "Modules", collection: "modules" } }]);
        expect(html).toContain("Search");
        expect(html).not.toContain("<svg");
    });

    it("opens one code tab at a time, and every tab in the group closes the last", async () => {
        const html = await render([
            {
                type: "codeTabs",
                props: {
                    code: "one",
                    items: [
                        [
                            { type: "codeTab", props: { label: "Two", code: "two", group: "start" } },
                            { type: "codeTab", props: { label: "Three", code: "three", group: "start" } },
                        ],
                    ],
                },
            },
        ]);
        const grouped = [...html.matchAll(/name="start"/g)];
        expect(grouped.length).toBe(2);
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
