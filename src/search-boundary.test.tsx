import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The search box is drawn by a server component and wired by a client one (#155). Across that
 * boundary a server module importing from a "use client" file gets a reference for each export, not
 * its value: a component still renders, and a constant is not the string it was. The mock below is
 * that view of search-keys.tsx, a component and nothing else, so a box that takes its attribute names
 * from there renders without them, as it did in every Next app.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));
vi.mock("./blocks/search-keys.js", () => ({ SearchKeys: () => null }));

const { defineConfig } = await import("./config.js");
const { SearchBox } = await import("./screens/tree.js");

describe("the search box, as a server component draws it", () => {
    it("carries the attributes its client code looks for, with the client module seen as a reference", () => {
        const config = defineConfig({ site: { name: "Manual", url: "https://manual.example" } });
        const html = renderToStaticMarkup(
            <SearchBox config={config} param="q" id="s" index={[{ title: "Keys", href: "/guide/keys" }]} variant="compact" />,
        );
        expect(html).toContain('data-bp-search="s"');
        expect(html).toMatch(/data-bp-search-index="\d+"/);
        expect(html).toContain("data-bp-search-empty=");
    });
});
