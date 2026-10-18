import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { formatDate } from "./cms.js";
import { formatValue } from "./blocks/bindings.js";
import { applySiteSettings } from "./site.js";

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
});
