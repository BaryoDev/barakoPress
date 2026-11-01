import type { ReactNode } from "react";
import type { PressConfig } from "../config.js";
import { formatDate } from "../cms.js";
import { storeFor } from "../store.js";
import { parseRepos } from "./issue-list.js";
import { progressBarBlock } from "./primitives.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import type { PressTheme } from "../theme.js";

/*
 * The milestones of one public GitHub repository, each drawn on the progress bar (#233).
 *
 * Read the same way as `issueList`: no token, the repo checked against a narrow pattern before it
 * reaches a URL, every good answer kept in the store and a failed read answered from it. A failure
 * with nothing kept lists nothing, because an embed must not fail its page.
 *
 * Closed issues are the bar's `count` and open issues are its `remaining`. The open count is never
 * the total: that would draw the wrong bar.
 */

export const MILESTONES_BLOCK = "milestones";
export const MAX_MILESTONES = 30;
const DEFAULT_ROWS = 10;
const GITHUB_API = "https://api.github.com";
export const MILESTONE_STATES = ["open", "closed", "all"] as const;
type MilestoneState = (typeof MILESTONE_STATES)[number];

export interface MilestoneRow {
    title: string;
    number: number;
    open: number;
    closed: number;
    /** `YYYY-MM-DD`, or null when the milestone has none. A bare date prints as sent, in any site zone. */
    dueOn: string | null;
}

const milestoneKey = (repo: string, state: MilestoneState) => `stale:github-milestones:${repo.toLowerCase()}:${state}`;

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);

function readRows(body: unknown): MilestoneRow[] {
    if (!Array.isArray(body)) return [];
    const rows: MilestoneRow[] = [];
    for (const item of body) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        const open = count(m.open_issues);
        const closed = count(m.closed_issues);
        if (typeof m.title !== "string" || !Number.isInteger(m.number) || open === null || closed === null) continue;
        const due = typeof m.due_on === "string" && !Number.isNaN(Date.parse(m.due_on)) ? m.due_on.slice(0, 10) : null;
        rows.push({ title: m.title, number: m.number as number, open, closed, dueOn: due });
    }
    return rows;
}

/** A kept row, in the shape the API sends, so one reader checks both. */
const toApi = (r: MilestoneRow) => ({
    title: r.title,
    number: r.number,
    open_issues: r.open,
    closed_issues: r.closed,
    due_on: r.dueOn,
});

/** The milestones of the repo, never throwing. */
export async function milestonesOf(
    config: PressConfig,
    repo: string,
    state: MilestoneState,
    limit: number,
): Promise<MilestoneRow[]> {
    if (!parseRepos(repo).includes(repo)) return [];
    const store = storeFor(config);
    const key = milestoneKey(repo, state);
    const take = Math.max(1, Math.min(limit, MAX_MILESTONES));
    try {
        const res = await fetch(`${GITHUB_API}/repos/${repo}/milestones?state=${state}&per_page=${MAX_MILESTONES}`, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "barakopress" },
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
            redirect: "error",
            next: { revalidate: config.backstopSeconds > 0 ? config.backstopSeconds : false },
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const body = await res.json();
        if (!Array.isArray(body)) throw new Error("GitHub answered something other than a list");
        const rows = readRows(body);
        await store.set(key, JSON.stringify(rows), 0);
        return rows.slice(0, take);
    } catch (e) {
        const kept = await store.get(key);
        const why = e instanceof Error ? e.message : String(e);
        if (kept === null) {
            console.warn(`milestones: ${repo} failed (${why}) and nothing was kept`);
            return [];
        }
        console.warn(`milestones: ${repo} failed (${why}), serving the last good answer`);
        try {
            return readRows(JSON.parse(kept).map(toApi)).slice(0, take);
        } catch {
            return [];
        }
    }
}

/** Closed over the whole, as a whole number. No issues is 0, never NaN. */
export function percentClosed(closed: number, open: number): number {
    const total = closed + open;
    return total === 0 ? 0 : Math.floor((closed / total) * 100);
}

export function MilestonesView({
    rows,
    heading,
    config,
    theme,
}: {
    rows: readonly MilestoneRow[];
    heading?: string;
    config: PressConfig;
    theme: PressTheme;
}) {
    const c = theme.colors;
    return (
        <section>
            {heading && (
                <h2
                    style={{
                        margin: `0 0 ${theme.space.md}`,
                        fontFamily: theme.fonts.heading,
                        fontWeight: 600,
                        fontSize: theme.text.title,
                        letterSpacing: "-.03em",
                        color: c.ink,
                    }}
                >
                    {heading}
                </h2>
            )}
            {rows.length === 0 ? (
                <p style={{ margin: 0, color: c.muted }}>Nothing listed.</p>
            ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: theme.space.md }}>
                    {rows.map((row) => {
                        const due = formatDate(config, row.dueOn ?? undefined);
                        return (
                            <li key={row.number} style={{ display: "grid", gap: theme.space.xs }}>
                                {row.closed + row.open === 0 ? (
                                    // The bar refuses a zero total, so a milestone with no issues is its title and the line below.
                                    <p style={{ margin: 0, fontWeight: 600, color: c.ink }}>{row.title}</p>
                                ) : (
                                    progressBarBlock.component({
                                        props: {
                                            label: row.title,
                                            count: String(row.closed),
                                            remaining: String(row.open),
                                        },
                                        slots: {},
                                        theme,
                                    } as never) as ReactNode
                                )}
                                <p
                                    style={{
                                        margin: 0,
                                        fontFamily: theme.fonts.mono,
                                        fontSize: theme.text.meta,
                                        color: c.muted,
                                    }}
                                >
                                    {percentClosed(row.closed, row.open)}% closed · {row.closed} closed · {row.open} open
                                    {due && ` · due ${due}`}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

type MilestonesProps = { repo: string; state?: string; limit?: number; heading?: string };

export function milestones(config: PressConfig): BlockDefinition {
    return defineBlock<MilestonesProps>({
        type: MILESTONES_BLOCK,
        label: "GitHub milestones",
        layer: "block",
        fields: [
            { name: "repo", kind: "text", label: "Repository (owner/name)", required: true },
            { name: "state", kind: "select", label: "Which", options: [...MILESTONE_STATES] },
            { name: "limit", kind: "number", label: "How many", min: 1, max: MAX_MILESTONES },
            { name: "heading", kind: "text", label: "Heading" },
        ],
        component: async ({ props, theme }) => {
            const state = MILESTONE_STATES.find((s) => s === props.state) ?? "open";
            const rows = await milestonesOf(config, (props.repo ?? "").trim(), state, props.limit ?? DEFAULT_ROWS);
            return <MilestonesView rows={rows} heading={props.heading} config={config} theme={theme} />;
        },
    });
}
