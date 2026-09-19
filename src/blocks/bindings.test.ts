import { describe, expect, it } from "vitest";
import {
    BindingSource,
    MAX_TEMPLATE,
    bindText,
    formatValue,
    hasBinding,
    readBindings,
    type BindingProblem,
    type BindingScopes,
} from "./bindings.js";

function source(scopes: BindingScopes, locale = "en-GB", currency?: string) {
    const problems: BindingProblem[] = [];
    const bound = new BindingSource(scopes, { locale, currency, onProblem: (p) => problems.push(p) });
    return { bound, problems };
}

const site = (values: Record<string, unknown>) => ({ site: () => values });

describe("reading a template", () => {
    it("reads a path, a format and a fallback", () => {
        expect(readBindings("Welcome to {{site.Name}}")).toEqual([
            { raw: "{{site.Name}}", scope: "site", path: "Name", format: "text", fallback: "" },
        ]);
        expect(readBindings("{{ item.Price | money ?? Free }}")).toEqual([
            { raw: "{{ item.Price | money ?? Free }}", scope: "item", path: "Price", format: "money", fallback: "Free" },
        ]);
        expect(readBindings("{{page.Author.Name}}")[0].path).toBe("Author.Name");
    });

    it("is not fooled by a single brace or an unclosed one", () => {
        for (const text of ["{site.Name}", "{{site.Name}", "{{ site Name }}", "{{}}"]) {
            expect(hasBinding(text)).toBe(false);
        }
    });

    it("stops looking past the template cap, so a pasted page cannot make scanning the work", () => {
        const huge = "x".repeat(MAX_TEMPLATE + 1) + "{{site.Name}}";
        expect(hasBinding(huge)).toBe(false);
        expect(readBindings(huge)).toEqual([]);
    });
});

describe("resolving a template", () => {
    it("puts the tenant's own value in, and a second tenant sees its own", async () => {
        const one = source(site({ Name: "Rotary Club of Koronadal" }));
        const two = source(site({ Name: "City Hospital" }));

        expect((await bindText("Welcome to {{site.Name}}", one.bound)).text).toBe("Welcome to Rotary Club of Koronadal");
        expect((await bindText("Welcome to {{site.Name}}", two.bound)).text).toBe("Welcome to City Hospital");
    });

    it("renders the fallback for a field that is not there, and reports it", async () => {
        const { bound, problems } = source(site({ Name: "Clinic" }));

        const out = await bindText("{{site.Tagline ?? Open today}}", bound);

        expect(out.text).toBe("Open today");
        expect(problems).toEqual([{ binding: "{{site.Tagline ?? Open today}}", reason: "no value" }]);
    });

    it("renders nothing, and does not throw, for a missing field with no fallback", async () => {
        const { bound, problems } = source(site({}));

        expect((await bindText("Hello {{site.Tagline}}", bound)).text).toBe("Hello ");
        expect(problems.map((p) => p.reason)).toEqual(["no value"]);
    });

    it("tells a scope this page does not carry apart from a word that is no scope at all", async () => {
        const { bound, problems } = source(site({ Name: "Clinic" }));

        const out = await bindText("{{item.Title}} and {{visitor.Name}}", bound);

        expect(out.text).toBe(" and {{visitor.Name}}");
        expect(problems).toEqual([
            { binding: "{{item.Title}}", reason: "unbound scope" },
            { binding: "{{visitor.Name}}", reason: "unknown scope" },
        ]);
    });

    it("never rescans what a binding resolved to, so a stored value cannot reach another field", async () => {
        const { bound } = source(site({ Name: "{{site.Secret}}", Secret: "not this" }));

        expect((await bindText("{{site.Name}}", bound)).text).toBe("{{site.Secret}}");
    });

    it("reads own properties only, so a path cannot walk the prototype chain", async () => {
        const { bound } = source(site({ Name: "Clinic" }));

        for (const path of ["constructor", "__proto__.polluted", "constructor.name"]) {
            expect((await bindText(`{{site.${path} ?? nothing}}`, bound)).text).toBe("nothing");
        }
    });

    it("reads each scope once however many placeholders name it", async () => {
        let reads = 0;
        const { bound } = source({
            site: () => {
                reads++;
                return { Name: "Clinic", Tagline: "Open" };
            },
        });

        await bindText("{{site.Name}} {{site.Tagline}} {{site.Name}}", bound);

        expect(reads).toBe(1);
    });

    it("reads no scope at all for a template with no placeholder", async () => {
        let reads = 0;
        const { bound } = source({
            site: () => {
                reads++;
                return {};
            },
        });

        expect((await bindText("Plain words", bound)).text).toBe("Plain words");
        expect(reads).toBe(0);
    });

    it("treats a scope that throws as a page with no value, not a page that fails", async () => {
        const { bound, problems } = source({
            site: () => {
                throw new Error("the CMS is down");
            },
        });

        expect((await bindText("{{site.Name ?? Our site}}", bound)).text).toBe("Our site");
        expect(problems.map((p) => p.reason)).toEqual(["unbound scope"]);
    });

    it("lets a repeat lay an item over the scopes around it without changing them", async () => {
        const { bound } = source(site({ Name: "Clinic" }));
        const row = bound.with({ item: () => ({ Title: "Dr Reyes" }) });

        expect((await bindText("{{item.Title}} at {{site.Name}}", row)).text).toBe("Dr Reyes at Clinic");
        expect((await bindText("{{item.Title ?? none}}", bound)).text).toBe("none");
    });
});

describe("formats", () => {
    const options = { locale: "en-GB" };

    it("formats a date, a time and a number by the site's locale", () => {
        expect(formatValue("2026-09-14T08:30:00Z", "date", options)).toBe("14 September 2026");
        expect(formatValue("2026-09-14T08:30:00Z", "date", { locale: "en-US" })).toBe("September 14, 2026");
        expect(formatValue(1234.5, "number", options)).toBe("1,234.5");
        expect(formatValue("HELLO", "lower", options)).toBe("hello");
    });

    it("formats money in the site's currency, and as a plain amount when it has none", () => {
        expect(formatValue(1500, "money", { locale: "en-PH", currency: "PHP" })).toBe("₱1,500.00");
        expect(formatValue(1500, "money", options)).toBe("1,500.00");
    });

    it("treats a value the format cannot take as missing, rather than rendering NaN", () => {
        expect(formatValue("not a date", "date", options)).toBeNull();
        expect(formatValue("Dr Reyes", "money", options)).toBeNull();
        expect(formatValue({ nested: true }, "text", options)).toBeNull();
        expect(formatValue([], "text", options)).toBeNull();
    });

    it("joins a list of strings, which is what a tags field holds", () => {
        expect(formatValue(["heart", "surgery"], "text", options)).toBe("heart, surgery");
    });
});
