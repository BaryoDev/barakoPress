import type { PressConfig } from "../config.js";
import { storeFor } from "../store.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * The current version of a package or release, read from its public registry (#232), so no site
 * types a version number.
 *
 * No token, and the id is checked against a narrow pattern per source before it reaches a URL. Every
 * good answer is kept in the store with the time it was read, and a failed read is answered from it.
 * A failure with nothing kept renders the label alone, or nothing, because an embed must not fail its
 * page and must never print "undefined". The GitHub read is the unauthenticated latest release, once
 * per revalidate window per repo.
 */

export const VERSION_BADGE_BLOCK = "versionBadge";
export const VERSION_SOURCES = ["nuget", "npm", "github"] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

const ID_PATTERNS: Record<VersionSource, RegExp> = {
    nuget: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
    npm: /^(@[a-z0-9][a-z0-9._~-]{0,99}\/)?[a-z0-9][a-z0-9._~-]{0,99}$/,
    github: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/,
};

export interface KeptVersion {
    version: string;
    /** ISO time of the read that produced `version`. */
    checkedAt: string;
}

const versionKey = (source: VersionSource, id: string) => `stale:version:${source}:${id.toLowerCase()}`;

function urlFor(source: VersionSource, id: string): string {
    if (source === "nuget") return `https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`;
    if (source === "npm") return `https://registry.npmjs.org/${id.replace("/", "%2F")}/latest`;
    return `https://api.github.com/repos/${id}/releases/latest`;
}

/** The version in a registry's answer, or null when it holds none. */
export function readVersion(source: VersionSource, body: unknown): string | null {
    const text = (v: unknown) => (typeof v === "string" && v.trim() && v.length <= 64 ? v.trim() : null);
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    if (source === "npm") return text(b.version);
    if (source === "github") return text(b.tag_name);
    if (!Array.isArray(b.versions)) return null;
    const all = b.versions.map(text).filter((v): v is string => v !== null);
    // The newest stable one, else the newest of any kind. The list is oldest first.
    return [...all].reverse().find((v) => !v.includes("-")) ?? all[all.length - 1] ?? null;
}

function readKept(raw: string | null): KeptVersion | null {
    if (raw === null) return null;
    try {
        const v = JSON.parse(raw) as Partial<KeptVersion>;
        return typeof v.version === "string" && v.version && typeof v.checkedAt === "string"
            ? { version: v.version, checkedAt: v.checkedAt }
            : null;
    } catch {
        return null;
    }
}

/** The current version, or the last good one, or null. Never throws. */
export async function versionOf(config: PressConfig, source: VersionSource, id: string): Promise<KeptVersion | null> {
    if (!ID_PATTERNS[source].test(id)) return null;
    const store = storeFor(config);
    const key = versionKey(source, id);
    try {
        const res = await fetch(urlFor(source, id), {
            headers: { Accept: "application/json", "User-Agent": "barakopress" },
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
            redirect: "error",
            next: { revalidate: config.backstopSeconds > 0 ? config.backstopSeconds : false },
        });
        if (!res.ok) throw new Error(`${source} answered ${res.status}`);
        const version = readVersion(source, await res.json());
        if (version === null) throw new Error(`${source} sent no version`);
        const fresh: KeptVersion = { version, checkedAt: new Date().toISOString() };
        await store.set(key, JSON.stringify(fresh), 0);
        return fresh;
    } catch (e) {
        const kept = readKept(await store.get(key));
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`versionBadge: ${source} ${id} failed (${why}), ${kept ? "serving the last good answer" : "nothing was kept"}`);
        return kept;
    }
}

const HIDDEN = {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
} as const;

export function VersionBadgeView({ label, kept }: { label?: string; kept: KeptVersion | null }) {
    const name = label?.trim() || "";
    if (!kept) return name ? <span>{name}</span> : null;
    return (
        <span title={`Last checked ${kept.checkedAt}`}>
            {name && `${name} `}
            {kept.version}
            <span style={HIDDEN}>{`, last checked ${kept.checkedAt}`}</span>
        </span>
    );
}

type VersionBadgeProps = { source: string; id: string; label?: string };

export function versionBadge(config: PressConfig): BlockDefinition {
    return defineBlock<VersionBadgeProps>({
        type: VERSION_BADGE_BLOCK,
        label: "Version from a registry",
        layer: "block",
        fields: [
            { name: "source", kind: "select", label: "Registry", options: [...VERSION_SOURCES], required: true },
            { name: "id", kind: "text", label: "Package or repo (owner/name for GitHub)", required: true },
            { name: "label", kind: "text", label: "Label" },
        ],
        component: async ({ props }) => {
            const source = VERSION_SOURCES.find((s) => s === props.source);
            const kept = source ? await versionOf(config, source, (props.id ?? "").trim()) : null;
            return <VersionBadgeView label={props.label} kept={kept} />;
        },
    });
}
