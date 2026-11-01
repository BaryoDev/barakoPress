import type { PressConfig } from "../config.js";
import { storeFor } from "../store.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import type { PressTheme } from "../theme.js";

/*
 * Open issues with one label from public GitHub repositories (#234).
 *
 * The read is unauthenticated on purpose: no token is sent, so the block can only ever see what any
 * visitor could. The repo and label come from a stored page, which is untrusted, so both are checked
 * against a narrow pattern before they reach a URL, and the link on each row is built from the
 * checked repo and the issue number, never taken from the response.
 *
 * Every good answer is kept in the store, keyed by repo and label, and a read that fails answers
 * from it. Nothing about a tenant is in the key because nothing about the answer is a tenant's.
 * A failure with no kept answer lists nothing for that repo: an embed must not fail its page.
 */

export const ISSUE_LIST_BLOCK = "issueList";
export const MAX_ISSUE_REPOS = 5;
export const MAX_ISSUE_ROWS = 50;
const DEFAULT_ROWS = 10;
const GITHUB_API = "https://api.github.com";
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const MAX_LABEL = 50;
/** One page of the API. Pull requests share the endpoint, so a page larger than `limit` leaves room to drop them. */
const PER_PAGE = 100;

export interface IssueRow {
    title: string;
    number: number;
    /** `owner/name`, which is also where the link goes. */
    repo: string;
    createdAt: string;
}

/** `owner/name`, one or more, separated by commas or spaces. Anything that is not a repo is dropped. */
export function parseRepos(value: string | undefined): string[] {
    const seen = new Set<string>();
    for (const part of (value ?? "").split(/[\s,]+/)) {
        if (REPO_PATTERN.test(part)) seen.add(part);
        if (seen.size === MAX_ISSUE_REPOS) break;
    }
    return [...seen];
}

const issueKey = (repo: string, label: string) => `stale:github-issues:${repo.toLowerCase()}:${label}`;

/** Open issues only: the issues endpoint also returns pull requests, and a state the API did not set is not trusted. */
function openIssues(body: unknown, repo: string): IssueRow[] {
    if (!Array.isArray(body)) return [];
    const rows: IssueRow[] = [];
    for (const item of body) {
        if (!item || typeof item !== "object") continue;
        const i = item as Record<string, unknown>;
        if (i.pull_request !== undefined || i.state !== "open") continue;
        if (typeof i.title !== "string" || !Number.isInteger(i.number) || typeof i.created_at !== "string") continue;
        rows.push({ title: i.title, number: i.number as number, repo, createdAt: i.created_at });
    }
    return rows;
}

/** A kept row, in the shape the API sends, so one filter checks both. */
const toApi = (r: IssueRow) => ({ title: r.title, number: r.number, created_at: r.createdAt, state: "open" });

async function readRepo(config: PressConfig, repo: string, label: string): Promise<IssueRow[]> {
    const store = storeFor(config);
    const key = issueKey(repo, label);
    try {
        const res = await fetch(
            `${GITHUB_API}/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=${PER_PAGE}`,
            {
                headers: { Accept: "application/vnd.github+json", "User-Agent": "barakopress" },
                signal: AbortSignal.timeout(config.cmsTimeoutMs),
                redirect: "error",
                next: { revalidate: config.backstopSeconds > 0 ? config.backstopSeconds : false },
            },
        );
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const body = await res.json();
        if (!Array.isArray(body)) throw new Error("GitHub answered something other than a list");
        const rows = openIssues(body, repo);
        await store.set(key, JSON.stringify(rows), 0);
        return rows;
    } catch (e) {
        const kept = await store.get(key);
        const why = e instanceof Error ? e.message : String(e);
        if (kept === null) {
            console.warn(`issueList: ${repo} failed (${why}) and nothing was kept`);
            return [];
        }
        console.warn(`issueList: ${repo} failed (${why}), serving the last good answer`);
        try {
            return openIssues(JSON.parse(kept).map(toApi), repo);
        } catch {
            return [];
        }
    }
}

/** The newest open issues with the label across the repos. Never throws. */
export async function issuesByLabel(
    config: PressConfig,
    repos: readonly string[],
    label: string,
    limit: number,
): Promise<IssueRow[]> {
    if (repos.length === 0 || !label.trim() || label.length > MAX_LABEL) return [];
    const lists = await Promise.all(repos.map((repo) => readRepo(config, repo, label)));
    return lists
        .flat()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, Math.max(1, Math.min(limit, MAX_ISSUE_ROWS)));
}

/** "3 days ago", in the largest whole unit. A date that does not parse or is in the future reads as "today". */
export function issueAge(createdAt: string, now: number): string {
    const days = Math.floor((now - Date.parse(createdAt)) / 86_400_000);
    if (!Number.isFinite(days) || days < 1) return "today";
    if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`;
    if (days < 365) {
        const months = Math.floor(days / 30);
        return `${months} ${months === 1 ? "month" : "months"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? "year" : "years"} ago`;
}

export function IssueListView({
    rows,
    heading,
    theme,
    now,
}: {
    rows: readonly IssueRow[];
    heading?: string;
    theme: PressTheme;
    now: number;
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
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: theme.space.sm }}>
                    {rows.map((row) => (
                        <li
                            key={`${row.repo}#${row.number}`}
                            style={{
                                padding: theme.space.md,
                                borderRadius: theme.radii.panel,
                                background: c.surface,
                                border: `1px solid ${c.hairline}`,
                            }}
                        >
                            <a
                                href={`https://github.com/${row.repo}/issues/${row.number}`}
                                rel="noopener noreferrer"
                                style={{ color: c.ink, fontWeight: 600, textDecoration: "none" }}
                            >
                                {row.title}
                            </a>
                            <p
                                style={{
                                    margin: "8px 0 0",
                                    fontFamily: theme.fonts.mono,
                                    fontSize: theme.text.meta,
                                    color: c.muted,
                                }}
                            >
                                {row.repo.split("/")[1]} #{row.number} · {issueAge(row.createdAt, now)}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

type IssueListProps = { repo: string; label: string; limit?: number; heading?: string };

export function issueList(config: PressConfig): BlockDefinition {
    return defineBlock<IssueListProps>({
        type: ISSUE_LIST_BLOCK,
        label: "Issues by label",
        layer: "block",
        fields: [
            { name: "repo", kind: "text", label: "Repositories (owner/name, comma separated)", required: true },
            { name: "label", kind: "text", label: "Label", required: true },
            { name: "limit", kind: "number", label: "How many", min: 1, max: MAX_ISSUE_ROWS },
            { name: "heading", kind: "text", label: "Heading" },
        ],
        component: async ({ props, theme }) => {
            const rows = await issuesByLabel(config, parseRepos(props.repo), props.label, props.limit ?? DEFAULT_ROWS);
            return <IssueListView rows={rows} heading={props.heading} theme={theme} now={Date.now()} />;
        },
    });
}
