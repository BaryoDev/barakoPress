/*
 * The small state a fleet of renderer containers has to agree on (barakoPress #57).
 *
 * The last good answer per read, the failure marker beside it, the host to tenant map and the
 * webhook replay guard were each a `Map` in one process. A purge reaches one container through the
 * load balancer, so every other one kept serving its own copy until the backstop ran out, and a
 * replayed delivery was honoured once per container instead of once. Two replicas of a busy client,
 * or a rolling deploy with the old and new containers side by side, served a corrected notice from
 * one and the old one from the other.
 *
 * So all of it goes through one store. The default is in process and bounded, which is what those
 * maps were, so a single container behaves exactly as it did. A deployment running more than one
 * passes `store` on the config, backed by whatever it already runs.
 *
 * Nothing here knows what a key means. The keys, their shapes and their lifetimes are delivery.ts
 * and the revalidate route's business.
 */

export interface PressStore {
    /** The value, or null when the key was never written, has expired, or was evicted. */
    get(key: string): Promise<string | null>;
    /** `ttlSeconds` of 0 keeps the value until the store needs the room. */
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    /** Forgets the key. A key that was never there is not an error. */
    delete(key: string): Promise<void>;
    /**
     * Writes only when the key is absent, and answers whether this caller is the one that wrote it.
     * Honouring a webhook once across a fleet is this and nothing else, so an implementation over a
     * shared backend has to make it atomic (`SET NX` in Redis, an insert that can conflict in
     * Postgres). A read followed by a write is two containers both believing they were first.
     */
    add(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Bounded by the characters held as well as the number of keys, oldest out first.
 *
 * Both bounds matter because one store holds two sizes of thing: a kept sitemap answer is
 * megabytes and a replay guard entry is a few bytes, and a budget in keys alone would let a site
 * with a large sitemap grow the process without limit. The character budget is the one the kept
 * answers used to carry on their own.
 */
export function memoryStore(
    { maxEntries = 5000, maxChars = 32 * 1024 * 1024 } = {},
): PressStore & { clear(): void } {
    const held = new Map<string, { value: string; expires: number }>();
    let chars = 0;

    function drop(key: string) {
        const found = held.get(key);
        if (found === undefined) return;
        chars -= found.value.length;
        held.delete(key);
    }

    function live(key: string): string | null {
        const found = held.get(key);
        if (found === undefined) return null;
        if (found.expires > 0 && found.expires <= Date.now()) {
            drop(key);
            return null;
        }
        return found.value;
    }

    function write(key: string, value: string, ttlSeconds: number) {
        drop(key);
        // A value larger than the whole budget would evict everything else and then itself.
        if (value.length > maxChars) return;
        held.set(key, { value, expires: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0 });
        chars += value.length;
        for (const [oldest, found] of held) {
            if (chars <= maxChars && held.size <= maxEntries) break;
            if (oldest === key) continue;
            chars -= found.value.length;
            held.delete(oldest);
        }
    }

    return {
        async get(key) {
            return live(key);
        },
        async set(key, value, ttlSeconds) {
            write(key, value, ttlSeconds);
        },
        async delete(key) {
            drop(key);
        },
        async add(key, value, ttlSeconds) {
            if (live(key) !== null) return false;
            write(key, value, ttlSeconds);
            return true;
        },
        clear() {
            held.clear();
            chars = 0;
        },
    };
}

/*
 * One in-process store for a deployment that configured none, rather than one per config object: a
 * request-time site builds a fresh config for every request, and a store per config would keep
 * nothing at all.
 */
const inProcess = memoryStore();

/** The store this config's reads and purges go through. */
export function storeFor(config: { store?: PressStore }): PressStore {
    return config.store ?? inProcess;
}

/** For tests: forget everything the default in-process store holds. */
export function forgetInProcessStore() {
    inProcess.clear();
}
