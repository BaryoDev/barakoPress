import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { defineConfig } from "./config.js";
import { formatDate } from "./cms.js";
import { formatValue } from "./blocks/bindings.js";
import { applySiteSettings } from "./site.js";
import { createBlockRegistry } from "./blocks/registry.js";
import { defineBlock, resolveBlocks } from "./blocks/schema.js";
import { bindBlocks } from "./blocks/bind.js";

const WHEN = "2026-10-25T00:00:00+08:00";
let zone: string | undefined;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = "UTC";
});
afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

const config = (timeZone?: string) => defineConfig({ sites: {}, site: { name: "S" }, ...(timeZone ? { timeZone } : {}) });

describe("the site's time zone", () => {
    it("formats a date in the configured zone, and as before without one", () => {
        expect(formatDate(config("Asia/Manila"), WHEN)).toBe("25 October 2026");
        expect(formatDate(config(), WHEN)).toBe("24 October 2026");
    });

    it("falls back to the old output for a zone the runtime does not know", () => {
        expect(formatDate(config("Mars/Base"), WHEN)).toBe("24 October 2026");
    });

    it("applies the zone to date bindings", () => {
        const options = { locale: "en-GB", timeZone: "Asia/Manila" };
        expect(formatValue(WHEN, "date", options)).toBe("25 October 2026");
        expect(formatValue(WHEN, "date", { locale: "en-GB" })).toBe("24 October 2026");
        expect(formatValue(WHEN, "date", { locale: "en-GB", timeZone: "Mars/Base" })).toBe("24 October 2026");
    });

    it("reads the TimeZone site setting and drops a bad one", () => {
        const base = config();
        expect(applySiteSettings(base, { TimeZone: "Asia/Manila" }, null).timeZone).toBe("Asia/Manila");
        for (const bad of ["Mars/Base", 5, null, "", {}]) {
            expect(applySiteSettings({ ...base, timeZone: "Asia/Manila" }, { TimeZone: bad }, null).timeZone).toBe("Asia/Manila");
            expect(applySiteSettings(base, { TimeZone: bad }, null).timeZone).toBeUndefined();
        }
    });

    it("keeps a bare date on its calendar day in any zone", () => {
        for (const zone of ["America/New_York", "Asia/Manila", undefined]) {
            expect(formatDate(config(zone), "2026-10-25")).toBe("25 October 2026");
            expect(formatValue("2026-10-25", "date", { locale: "en-GB", timeZone: zone })).toBe("25 October 2026");
        }
    });

    it("still moves a real instant into the site zone", () => {
        expect(formatDate(config("Asia/Manila"), WHEN)).toBe("25 October 2026");
        expect(formatDate(config("America/New_York"), WHEN)).toBe("24 October 2026");
        expect(formatValue(WHEN, "date", { locale: "en-GB", timeZone: "America/New_York" })).toBe("24 October 2026");
    });

    it("uses the site zone for date, time and datetime bindings through bindBlocks", async () => {
        const probe = defineBlock<{ text?: string }>({
            type: "probe",
            label: "Probe",
            fields: [{ name: "text", kind: "text" }],
            component: ({ props }) => createElement("p", null, props.text),
        });
        const run = async (timeZone: string | undefined, format: string) => {
            const cfg = config(timeZone);
            const registry = createBlockRegistry(cfg, [probe]);
            const raw = [{ type: "probe", props: { text: `{{site.When | ${format}}}` } }];
            const out = await bindBlocks(resolveBlocks(raw, registry, { perViewer: false }), {
                config: cfg,
                registry,
                scopes: { site: () => ({ When: WHEN }) },
            });
            return out[0].props.text;
        };
        expect(await run("Asia/Manila", "date")).toBe("25 October 2026");
        expect(await run(undefined, "date")).toBe("24 October 2026");
        expect(await run("Asia/Manila", "time")).toBe("00:00");
        expect(await run(undefined, "time")).toBe("16:00");
        expect(await run("Asia/Manila", "datetime")).toContain("25 October 2026");
        expect(await run(undefined, "datetime")).toContain("24 October 2026");
    });
});
