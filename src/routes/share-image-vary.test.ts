import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "../config.js";

const state = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("next/og", () => ({
    ImageResponse: class {
        constructor(_el: unknown, init: { headers: Record<string, string> }) {
            return new Response("png", { headers: init.headers });
        }
    },
}));
vi.mock("../site.js", async (orig) => ({
    ...(await orig<typeof import("../site.js")>()),
    siteConfigOrNull: async () => state.config,
}));
vi.mock("../cms.js", () => ({ getPageByPath: async () => ({ page: { title: "About" } }) }));

import { createShareImage } from "./share-image.js";

const before = process.env.PRESS_SHARE_IMAGE_FONT;
afterEach(() => {
    if (before === undefined) delete process.env.PRESS_SHARE_IMAGE_FONT;
    else process.env.PRESS_SHARE_IMAGE_FONT = before;
});

async function card(sites: Record<string, string>) {
    const file = join(mkdtempSync(join(tmpdir(), "font-")), "f.ttf");
    writeFileSync(file, Buffer.from([1, 2, 3]));
    process.env.PRESS_SHARE_IMAGE_FONT = file;
    const config = defineConfig({ site: { name: "T", url: "https://t.example" }, sites, cmsUrl: "https://cms.example" });
    state.config = config;
    return createShareImage(config)(new Request("https://t.example/share-image?path=%2Fabout"));
}

describe("the share image behind a shared cache", () => {
    it("varies on the header that picks the tenant, since the URL does not name it", async () => {
        const res = await card({ tenantHeader: "X-Press-Tenant" });
        expect(res.status).toBe(200);
        expect(res.headers.get("vary")).toBe("x-press-tenant");
    });

    it("varies on a host header other than host", async () => {
        const res = await card({ hostHeader: "X-Forwarded-Host" });
        expect(res.headers.get("vary")).toBe("x-forwarded-host");
    });

    it("adds no Vary when the host header alone picks the tenant", async () => {
        const res = await card({});
        expect(res.status).toBe(200);
        expect(res.headers.get("vary")).toBeNull();
    });
});
