import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

/*
 * The copy button on `codeSample` (#82), the package's rule for a client component applied to a
 * block: the server's markup is the select-all affordance it always was, and the script only adds.
 */

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { createBlockRegistry } = await import("./registry.js");
const { canCopy, copyOrSelect } = await import("./copy-button.js");

const config = defineConfig({ site: { name: "Baryo", url: "https://baryo.example" }, cmsUrl: "http://cms.test" });

async function sample(props: Record<string, unknown>): Promise<string> {
    const definition = createBlockRegistry(config).get("codeSample");
    expect(definition).toBeDefined();
    const errors: unknown[] = [];
    const node = await definition!.component({ props, slots: {}, theme: config.theme });
    const { prelude } = await prerender(<>{node}</>, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

describe("copying a code sample", () => {
    it("draws a button only where there is a clipboard that takes text", () => {
        expect(canCopy({ clipboard: { writeText: async () => undefined } })).toBe(true);
        expect(canCopy({ clipboard: {} })).toBe(false);
        expect(canCopy({})).toBe(false);
        expect(canCopy(undefined)).toBe(false);
    });

    it("puts the snippet on the clipboard and selects nothing", async () => {
        const writeText = vi.fn(async (_text: string) => undefined);
        const fallback = vi.fn();
        expect(await copyOrSelect("npm i barakopress", { writeText }, fallback)).toBe("copied");
        expect(writeText.mock.calls).toEqual([["npm i barakopress"]]);
        expect(fallback).not.toHaveBeenCalled();
    });

    it("selects the snippet when the clipboard refuses it", async () => {
        const writeText = vi.fn(async () => {
            throw new DOMException("denied", "NotAllowedError");
        });
        const fallback = vi.fn();
        expect(await copyOrSelect("npm i barakopress", { writeText }, fallback)).toBe("selected");
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(fallback).toHaveBeenCalledTimes(1);
    });

    it("serves the tenant's word as text over a snippet one click selects, with no button in the markup", async () => {
        const html = await sample({ code: "npm i barakopress", selectLabel: "Kopyahin", copiedLabel: "Nakopya na" });
        expect(html).toContain("<span>Kopyahin</span>");
        expect(html).toContain("user-select:all");
        expect(html).toContain("npm i barakopress");
        expect(html).not.toContain("<button");
        expect(html).not.toContain("Nakopya na");
    });

    it("offers the word for a copied snippet as a field", () => {
        const fields = createBlockRegistry(config).get("codeSample")?.fields.map((f) => f.name) ?? [];
        expect(fields.length).toBeGreaterThan(0);
        expect(fields).toContain("copiedLabel");
    });
});
