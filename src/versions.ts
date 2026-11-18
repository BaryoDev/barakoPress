import type { PressConfig, VersionRef, VersionSource } from "./config.js";
import { syncedJson, type Synced } from "./synced.js";

/*
 * The latest published version of a package or release, from the registry's public endpoint (#232).
 *
 * github: the latest-release endpoint, unauthenticated. It is rate limited per address, which is
 * why every read goes through `syncedJson` and its window rather than one call per render.
 * npm: the `latest` dist-tag. nuget: the flat container's version list, newest stable first.
 */

/*
 * An id is checked before it goes in a URL, so a block's prop cannot steer the request elsewhere:
 * no segment made only of dots (the URL parser would collapse it), a length cap, and a first
 * character that is not punctuation. The cap is the registry's own limit where there is one.
 */
const DOTS = /^\.+$/;
const MAX_ID = { github: 100, npm: 214, nuget: 100 } as const;
const ID: Record<VersionSource, RegExp> = {
    github: /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    npm: /^(?:@[A-Za-z0-9~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/,
    nuget: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
};

function validId(source: VersionSource, id: unknown): id is string {
    if (typeof id !== "string" || !ID[source]?.test(id)) return false;
    const parts = id.split("/");
    if (parts.some((part) => DOTS.test(part) || part.length > MAX_ID[source])) return false;
    return id.length <= (source === "github" ? MAX_ID.github * 2 + 1 : MAX_ID[source]);
}

/** A registry value is one line of text: newlines and edge whitespace go, and nothing left is no value. */
const clean = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.replace(/[\r\n]/g, "").trim();
    return t === "" ? undefined : t;
};
const text = clean;
const isText = (v: unknown): v is string => typeof v === "string";

function newestStable(json: unknown): string | undefined {
    const versions = (json as { versions?: unknown })?.versions;
    if (!Array.isArray(versions)) return undefined;
    const all = versions.flatMap((v) => clean(v) ?? []);
    // The list is in version order. A prerelease carries a hyphen, and only wins when nothing else exists.
    return [...all].reverse().find((v) => !v.includes("-")) ?? all.at(-1);
}

function endpoint(ref: VersionRef): { url: string; pick: (json: unknown) => string | undefined } | null {
    if (!validId(ref.source, ref.id)) return null;
    switch (ref.source) {
        case "github":
            return {
                url: `https://api.github.com/repos/${ref.id}/releases/latest`,
                pick: (json) => text((json as { tag_name?: unknown })?.tag_name),
            };
        case "npm":
            return {
                url: `https://registry.npmjs.org/-/package/${ref.id.replaceAll("/", "%2F")}/dist-tags`,
                pick: (json) => text((json as { latest?: unknown })?.latest),
            };
        case "nuget":
            return {
                url: `https://api.nuget.org/v3-flatcontainer/${ref.id.toLowerCase()}/index.json`,
                pick: newestStable,
            };
        default:
            return null;
    }
}

/** The version, when it was checked, and whether that is a kept copy. Null when it is unknown. */
export async function latestVersion(
    config: PressConfig,
    ref: VersionRef,
    options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<Synced<string> | null> {
    const found = endpoint(ref);
    if (!found) return null;
    return syncedJson(config, { check: isText, key: `${ref.source}:${ref.id.toLowerCase()}`, ...found, ...options });
}

/** The text a version token stands for, or null when it has no value yet. */
export async function versionText(config: PressConfig, name: string): Promise<string | null> {
    const ref = config.synced.tokens[name];
    return ref ? ((await latestVersion(config, ref))?.value ?? null) : null;
}
