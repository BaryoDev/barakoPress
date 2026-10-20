import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { applySiteSettings } from "./site.js";
import { forgetRobotsWarnings } from "./config.js";
import { createRobots } from "./routes/robots.js";

vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
    },
    cookies: async () => {
        throw new Error("cookies() was read");
    },
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
    },
}));

const site = { name: "S", url: "https://s.example" };
const base = () => defineConfig({ site });
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    forgetRobotsWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("the robots disallow list", () => {
    it("a site setting adds the disallow paths", async () => {
        const config = applySiteSettings(base(), { Robots: { disallow: ["/api/", "/drafts"] } }, null);
        expect(await createRobots(config)()).toEqual({
            rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/drafts"] },
            sitemap: "https://s.example/sitemap.xml",
        });
    });

    it("the config field does the same", async () => {
        const config = defineConfig({ site, robots: { disallow: ["/api/"] } });
        expect(await createRobots(config)()).toEqual({
            rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
            sitemap: "https://s.example/sitemap.xml",
        });
    });

    it("the site setting wins over the config field", async () => {
        const config = applySiteSettings(defineConfig({ site, robots: { disallow: ["/old/"] } }), { Robots: { disallow: ["/new/"] } }, null);
        expect((await createRobots(config)()).rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/new/"] });
    });

    it("the holding page ignores the setting", async () => {
        const config = applySiteSettings(
            defineConfig({ site, robots: { disallow: ["/a/"] } }),
            { Mode: "Holding", Robots: { disallow: ["/api/"] } },
            null,
        );
        const robots = await createRobots(config)();
        expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
        expect(robots.sitemap).toBeUndefined();
    });

    it("drops a newline, a non-string and a path without a leading slash, and says so once", async () => {
        const config = applySiteSettings(
            base(),
            {
                Robots: {
                    disallow: ["/ok/", "/x\nSitemap: https://evil.example/", "/tab\there", 5, null, "api/", "https://evil.example/", "/also-ok"],
                },
            },
            null,
        );
        expect((await createRobots(config)()).rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/ok/", "/also-ok"] });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("6");
    });

    it("caps the list at 100 and says so once", async () => {
        const many = Array.from({ length: 130 }, (_, i) => `/p${i}/`);
        const config = applySiteSettings(base(), { Robots: { disallow: many } }, null);
        const rules = (await createRobots(config)()).rules as { disallow: string[] };
        expect(rules.disallow).toHaveLength(100);
        expect(rules.disallow).toEqual(many.slice(0, 100));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("no setting gives the same rules as before", async () => {
        for (const settings of [{}, { Robots: {} }, { Robots: { disallow: [] } }, { Robots: "nope" }, { Robots: { disallow: "/api/" } }]) {
            const config = applySiteSettings(base(), settings, null);
            expect(await createRobots(config)()).toEqual({
                rules: { userAgent: "*", allow: "/" },
                sitemap: "https://s.example/sitemap.xml",
            });
        }
        expect(await createRobots(base())()).toEqual({
            rules: { userAgent: "*", allow: "/" },
            sitemap: "https://s.example/sitemap.xml",
        });
        expect(warn).not.toHaveBeenCalled();
    });
});
