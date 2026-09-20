import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "./store.js";

/*
 * The default store. It is what the maps in delivery.ts were, so what matters is that it still
 * bounds the process: a site with a large sitemap cannot grow it without limit, and neither can a
 * caller inventing hostnames.
 */

afterEach(() => vi.restoreAllMocks());

describe("the in-process store", () => {
    it("gives back what it was given, and nothing for a key it never had", async () => {
        const store = memoryStore();
        await store.set("a", "first", 0);

        expect(await store.get("a")).toBe("first");
        expect(await store.get("b")).toBeNull();

        await store.set("a", "second", 0);
        expect(await store.get("a")).toBe("second");

        await store.delete("a");
        expect(await store.get("a")).toBeNull();
    });

    it("forgets a value once its seconds are up, and keeps one with no expiry", async () => {
        const store = memoryStore();
        const now = Date.now();
        await store.set("short", "x", 60);
        await store.set("kept", "y", 0);

        vi.spyOn(Date, "now").mockReturnValue(now + 59_000);
        expect(await store.get("short")).toBe("x");

        vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
        expect(await store.get("short")).toBeNull();
        expect(await store.get("kept")).toBe("y");
    });

    it("writes only when the key is absent, which is what honours a delivery once", async () => {
        const store = memoryStore();

        expect(await store.add("delivery", "1", 300)).toBe(true);
        expect(await store.add("delivery", "1", 300)).toBe(false);
        expect(await store.get("delivery")).toBe("1");

        await store.delete("delivery");
        expect(await store.add("delivery", "1", 300)).toBe(true);
    });

    it("drops the oldest keys when there are too many of them", async () => {
        const store = memoryStore({ maxEntries: 3 });
        for (const key of ["a", "b", "c", "d"]) await store.set(key, key, 0);

        const held = await Promise.all(["a", "b", "c", "d"].map((key) => store.get(key)));
        expect(held).toHaveLength(4);
        expect(held).toEqual([null, "b", "c", "d"]);
    });

    it("drops the oldest keys when they hold too many characters, and refuses one too big to hold", async () => {
        const store = memoryStore({ maxChars: 20 });
        await store.set("a", "x".repeat(15), 0);
        await store.set("b", "y".repeat(15), 0);

        expect(await store.get("a")).toBeNull();
        expect(await store.get("b")).toBe("y".repeat(15));

        await store.set("huge", "z".repeat(21), 0);
        expect(await store.get("huge")).toBeNull();
        // The write that could not fit left what was there alone.
        expect(await store.get("b")).toBe("y".repeat(15));
    });
});
