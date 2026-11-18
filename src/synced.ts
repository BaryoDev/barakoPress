import type { PressConfig } from "./config.js";
import { storeFor, type PressStore } from "./store.js";

/*
 * Public JSON from somewhere else, read once per window and kept (#232).
 *
 * The `versionBadge` block is the first user. Milestone counts (#233) and issue lists (#234) read
 * public GitHub endpoints the same way and call `syncedJson` with their own key and URL.
 *
 * What this guards against is a registry outage failing a build or blanking a page. A read
 * succeeds and is remembered twice: in the config's store, which also serves the window, and in a
 * snapshot file, which survives a restart and a fresh build. A read that fails answers with the
 * last good value, and with nothing when there never was one. It never throws, and a store that
 * fails is a miss, not an error.
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

/** After a failed read, the least time before the next render asks again. Stops an outage costing a timeout per render. */
const RETRY_SECONDS = 60;

const DEFAULT_SNAPSHOT_DIR = ".next/cache/press-synced";

interface Kept<T> {
    value: T;
    checkedAt: number;
}

const storeKey = (key: string) => `synced:${key}`;
const failedKey = (key: string) => `synced-failed:${key}`;

/** A refused read that says how long to wait, in seconds. */
class Refused extends Error {
    constructor(
        message: string,
        readonly waitSeconds?: number,
    ) {
        super(message);
    }
}

/** What a 403 or 429 asks for: `retry-after` in seconds or as a date, else GitHub's `x-ratelimit-reset` epoch. */
function waitFor(res: Response, now: number): number | undefined {
    const after = res.headers.get("retry-after");
    if (after !== null) {
        const seconds = Number(after);
        if (Number.isFinite(seconds)) return seconds;
        const at = Date.parse(after);
        if (Number.isFinite(at)) return Math.ceil((at - now) / 1000);
    }
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    return reset > 0 ? Math.ceil(reset - now / 1000) : undefined;
}

function parseKept<T>(text: string | null): Kept<T> | null {
    if (text === null) return null;
    try {
        const kept = JSON.parse(text) as Kept<T>;
        return kept && typeof kept.checkedAt === "number" && "value" in kept ? kept : null;
    } catch {
        return null;
    }
}

/** A file name from a key: lowercased, and anything outside a plain set is escaped, so a key cannot leave the directory. */
function snapshotName(key: string): string {
    return `${key.toLowerCase().replace(/[^a-z0-9._-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`)}.json`;
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

let tempCount = 0;

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
        // Written beside and renamed, so a reader never sees half a file. Unique, so two writers do not share one.
        const temp = `${file}.${process.pid}.${Date.now().toString(36)}.${(tempCount++).toString(36)}.tmp`;
        await writeFile(temp, JSON.stringify(kept), "utf8");
        await rename(temp, file);
    } catch {
        // Nothing to do: the store still holds the value.
    }
}

/** A store that throws or rejects is a miss, and a write it refuses is skipped. */
async function storeGet(store: PressStore, key: string): Promise<string | null> {
    try {
        return await store.get(key);
    } catch {
        return null;
    }
}

async function storeSet(store: PressStore, key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
        await store.set(key, value, ttlSeconds);
    } catch {
        // Skipped.
    }
}

/** Callers that arrive while a read is out share it, so one expiry is one call and not one per block. */
const inFlight = new Map<string, Promise<Synced<unknown> | null>>();

export function syncedJson<T>(config: PressConfig, options: SyncedOptions<T>): Promise<Synced<T> | null> {
    const running = inFlight.get(options.key);
    if (running) return running as Promise<Synced<T> | null>;
    const started = read(config, options)
        .catch(() => null)
        .finally(() => {
            if (inFlight.get(options.key) === started) inFlight.delete(options.key);
        });
    inFlight.set(options.key, started);
    return started;
}

async function read<T>(config: PressConfig, options: SyncedOptions<T>): Promise<Synced<T> | null> {
    const store = storeFor(config);
    const now = options.now ?? Date.now;
    const windowMs = config.synced.revalidateSeconds * 1000;

    const held = parseKept<T>(await storeGet(store, storeKey(options.key)));
    if (held && now() - held.checkedAt < windowMs) return { ...held, stale: false };

    // A cold process or a build worker has no store entry but may have a file a moment old.
    const snapshot = held ? null : await readSnapshot<T>(config, options.key);
    if (snapshot && now() - snapshot.checkedAt < windowMs) {
        await storeSet(store, storeKey(options.key), JSON.stringify(snapshot), 0);
        return { ...snapshot, stale: false };
    }

    if ((await storeGet(store, failedKey(options.key))) === null) {
        let wait = RETRY_SECONDS;
        try {
            // No Next data cache: the store owns the window, and checkedAt is when the registry answered.
            const res = await (options.fetch ?? fetch)(options.url, {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(config.synced.timeoutMs),
                cache: "no-store",
            });
            if (!res.ok) {
                throw new Refused(`${res.status}`, res.status === 403 || res.status === 429 ? waitFor(res, now()) : undefined);
            }
            const value = options.pick(await res.json());
            if (value === undefined) throw new Refused("unexpected reply");
            const kept: Kept<T> = { value, checkedAt: now() };
            await storeSet(store, storeKey(options.key), JSON.stringify(kept), 0);
            await writeSnapshot(config, options.key, kept);
            return { ...kept, stale: false };
        } catch (e) {
            if (e instanceof Refused && e.waitSeconds !== undefined) {
                wait = Math.min(Math.max(RETRY_SECONDS, Math.ceil(e.waitSeconds)), Math.max(RETRY_SECONDS, config.synced.revalidateSeconds));
            }
            await storeSet(store, failedKey(options.key), "1", wait);
            console.warn(`synced: ${options.key} failed (${e instanceof Error ? e.message : String(e)}), using the last good value`);
        }
    }

    const fallback = held ?? snapshot;
    return fallback ? { ...fallback, stale: true } : null;
}
