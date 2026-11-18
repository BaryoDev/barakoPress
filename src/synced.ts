import type { PressConfig } from "./config.js";
import { storeFor } from "./store.js";

/*
 * Public JSON from somewhere else, read once per window and kept (#232).
 *
 * The `versionBadge` block is the first user. Milestone counts (#233) and issue lists (#234) read
 * public GitHub endpoints the same way and call `syncedJson` with their own key and URL.
 *
 * What this guards against is a registry outage failing a build or blanking a page. A read
 * succeeds and is remembered twice: in the config's store, which also serves the window, and in a
 * snapshot file, which survives a restart and a fresh build. A read that fails answers with the
 * last good value, and with nothing when there never was one. It never throws.
 *
 * Only public endpoints, no token. The value is the same for every tenant, so the key carries none.
 */

/** A value and when it was read from the source. `stale` is true when this is a kept copy. */
export interface Synced<T> {
    value: T;
    /** Epoch milliseconds of the read that produced `value`. */
    checkedAt: number;
    stale: boolean;
}

export interface SyncedOptions<T> {
    /** What the value is kept under. One per source and id, for example `npm:barakopress`. */
    key: string;
    url: string;
    /** Turns the parsed JSON into the value kept. Throw, or return undefined, to refuse a reply. */
    pick: (json: unknown) => T | undefined;
    /** Injected by tests. Defaults to the global fetch. */
    fetch?: typeof fetch;
    /** Injected by tests. */
    now?: () => number;
}

/** After a failed read, how long before the next render asks again. Stops an outage costing a timeout per render. */
const RETRY_SECONDS = 60;

const DEFAULT_SNAPSHOT_DIR = ".next/cache/press-synced";

interface Kept<T> {
    value: T;
    checkedAt: number;
}

const storeKey = (key: string) => `synced:${key}`;
const failedKey = (key: string) => `synced-failed:${key}`;

function parseKept<T>(text: string | null): Kept<T> | null {
    if (text === null) return null;
    try {
        const kept = JSON.parse(text) as Kept<T>;
        return kept && typeof kept.checkedAt === "number" && "value" in kept ? kept : null;
    } catch {
        return null;
    }
}

/** A file name from a key: anything outside a plain set is escaped, so a key cannot leave the directory. */
function snapshotName(key: string): string {
    return `${key.replace(/[^A-Za-z0-9._-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`)}.json`;
}

async function readSnapshot<T>(config: PressConfig, key: string): Promise<Kept<T> | null> {
    try {
        const [{ readFile }, { join }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
        const dir = config.synced.snapshotDir ?? join(process.cwd(), DEFAULT_SNAPSHOT_DIR);
        return parseKept<T>(await readFile(join(dir, snapshotName(key)), "utf8"));
    } catch {
        return null;
    }
}

/** A read-only filesystem, as in the published image, is an ordinary case here and not an error. */
async function writeSnapshot<T>(config: PressConfig, key: string, kept: Kept<T>): Promise<void> {
    try {
        const [{ mkdir, rename, writeFile }, { join }] = await Promise.all([
            import("node:fs/promises"),
            import("node:path"),
        ]);
        const dir = config.synced.snapshotDir ?? join(process.cwd(), DEFAULT_SNAPSHOT_DIR);
        await mkdir(dir, { recursive: true });
        const file = join(dir, snapshotName(key));
        // Written beside and renamed, so a reader never sees half a file.
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(kept), "utf8");
        await rename(temp, file);
    } catch {
        // Nothing to do: the in-process copy still holds the value.
    }
}

export async function syncedJson<T>(config: PressConfig, options: SyncedOptions<T>): Promise<Synced<T> | null> {
    const store = storeFor(config);
    const now = options.now ?? Date.now;
    const windowMs = config.synced.revalidateSeconds * 1000;

    const held = parseKept<T>(await store.get(storeKey(options.key)));
    if (held && now() - held.checkedAt < windowMs) return { ...held, stale: false };

    if ((await store.get(failedKey(options.key))) === null) {
        try {
            const res = await (options.fetch ?? fetch)(options.url, {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(config.synced.timeoutMs),
                next: { revalidate: config.synced.revalidateSeconds },
            } as RequestInit);
            if (!res.ok) throw new Error(`${res.status}`);
            const value = options.pick(await res.json());
            if (value === undefined) throw new Error("unexpected reply");
            const kept: Kept<T> = { value, checkedAt: now() };
            await store.set(storeKey(options.key), JSON.stringify(kept), 0);
            await writeSnapshot(config, options.key, kept);
            return { ...kept, stale: false };
        } catch (e) {
            await store.set(failedKey(options.key), "1", RETRY_SECONDS);
            console.warn(`synced: ${options.key} failed (${e instanceof Error ? e.message : String(e)}), using the last good value`);
        }
    }

    const fallback = held ?? (await readSnapshot<T>(config, options.key));
    return fallback ? { ...fallback, stale: true } : null;
}
