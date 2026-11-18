import type { PressConfig } from "./config.js";
import { syncedJson, type Synced } from "./synced.js";
import { validId } from "./versions.js";

/*
 * A repository's milestones, from GitHub's public endpoint with no token (#233).
 *
 * Read through `syncedJson`, so the window, the snapshot file and the never-throws rule are the
 * ones the version badge has. The repo id is checked the way a github version id is, and the limit
 * is capped, before either goes in a URL.
 */

export const MILESTONE_STATES = ["open", "closed", "all"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const MAX_MILESTONES = 30;

export interface Milestone {
    title: string;
    /** The due date as GitHub sent it, or null when there is none or it is not a date. */
    due: string | null;
    open: number;
    closed: number;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function toMilestone(raw: unknown): Milestone | undefined {
    const m = raw as { title?: unknown; due_on?: unknown; open_issues?: unknown; closed_issues?: unknown } | null;
    if (!m || typeof m.title !== "string") return undefined;
    const title = m.title.replace(/[\r\n]/g, " ").trim();
    if (title === "") return undefined;
    const due = typeof m.due_on === "string" && Number.isFinite(Date.parse(m.due_on)) ? m.due_on : null;
    return { title, due, open: count(m.open_issues), closed: count(m.closed_issues) };
}

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isMilestones = (v: unknown): v is Milestone[] =>
    Array.isArray(v) &&
    v.every((m) => {
        const x = m as Partial<Milestone> | null;
        return !!x && typeof x.title === "string" && (x.due === null || typeof x.due === "string") && isCount(x.open) && isCount(x.closed);
    });

/** 1 to 30, whole. A non-number is the cap. */
export function milestoneLimit(value: unknown): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return MAX_MILESTONES;
    return Math.min(MAX_MILESTONES, Math.max(1, n));
}

/** The milestones, when they were read, and whether that is a kept copy. Null when unknown or the repo id is refused. */
export async function repoMilestones(
    config: PressConfig,
    repo: unknown,
    state: MilestoneState,
    limit: number,
    options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<Synced<Milestone[]> | null> {
    if (!validId("github", repo)) return null;
    const n = milestoneLimit(limit);
    return syncedJson(config, {
        key: `github-milestones:${repo.toLowerCase()}:${state}:${n}`,
        url: `https://api.github.com/repos/${repo}/milestones?state=${state}&per_page=${n}`,
        pick: (json) => (Array.isArray(json) ? json.slice(0, n).flatMap((m) => toMilestone(m) ?? []) : undefined),
        check: isMilestones,
        ...options,
    });
}
