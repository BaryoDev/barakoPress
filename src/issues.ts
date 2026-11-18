import type { PressConfig } from "./config.js";
import { syncedJson, type Synced } from "./synced.js";
import { validId } from "./versions.js";

/*
 * Open issues with one label, from a public GitHub repository (#234).
 *
 * Every repository is its own `syncedJson` read, so a repository that cannot be reached answers
 * with its own last good list and does not hide the others. No token: the unauthenticated API is
 * rate limited per address, which is why a read is kept for the window and not made per render.
 */

export interface IssueRow {
    /** owner/name, as the reader typed it. */
    repo: string;
    number: number;
    title: string;
    url: string;
    /** Epoch milliseconds the issue was opened. */
    createdAt: number;
}

/** The most repositories one block reads, and the bounds on how many rows it shows. */
export const MAX_REPOS = 10;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 10;
const MAX_LABEL = 100;
const MAX_TITLE = 300;
const HTML_URL_PREFIX = "https://github.com/";

/** A label is one line of text. Control characters and an empty value are refused, not repaired. */
function validLabel(label: unknown): label is string {
    return typeof label === "string" && label.trim() !== "" && label.length <= MAX_LABEL && !/[\u0000-\u001f\u007f]/.test(label);
}

export function clampLimit(limit: unknown): number {
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
}

/** The valid, distinct repositories, capped. Anything else in the list is dropped without a request. */
export function cleanRepos(repos: unknown): string[] {
    if (!Array.isArray(repos)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of repos) {
        const id = typeof r === "string" ? r.trim() : "";
        if (!validId("github", id) || seen.has(id.toLowerCase())) continue;
        seen.add(id.toLowerCase());
        out.push(id);
        if (out.length === MAX_REPOS) break;
    }
    return out;
}

/** The API's own link when it is a github.com page, otherwise one built from what is known. */
function linkFor(repo: string, number: number, htmlUrl: unknown): string {
    return typeof htmlUrl === "string" && htmlUrl.startsWith(HTML_URL_PREFIX) ? htmlUrl : `${HTML_URL_PREFIX}${repo}/issues/${number}`;
}

/** Open issues only. A pull request comes back from the issues endpoint with a `pull_request` key. */
function pickIssues(repo: string, json: unknown): IssueRow[] | undefined {
    if (!Array.isArray(json)) return undefined;
    const rows: IssueRow[] = [];
    for (const entry of json) {
        const e = entry as Record<string, unknown> | null;
        if (!e || typeof e !== "object" || "pull_request" in e || e.state !== "open") continue;
        const created = typeof e.created_at === "string" ? Date.parse(e.created_at) : NaN;
        const title = typeof e.title === "string" ? e.title.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_TITLE) : "";
        if (typeof e.number !== "number" || !Number.isInteger(e.number) || e.number < 1 || !Number.isFinite(created) || title === "") continue;
        rows.push({ repo, number: e.number, title, url: linkFor(repo, e.number, e.html_url), createdAt: created });
    }
    return rows;
}

const isRows = (v: unknown): v is IssueRow[] =>
    Array.isArray(v) &&
    v.every(
        (r) =>
            r &&
            typeof r.repo === "string" &&
            typeof r.title === "string" &&
            typeof r.url === "string" &&
            typeof r.number === "number" &&
            typeof r.createdAt === "number",
    );

/** Newest first across every repository, then cut to the limit. Never throws. */
export async function openIssues(
    config: PressConfig,
    input: { repos: unknown; label: unknown; limit?: unknown },
    options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<Synced<IssueRow[]>[]> {
    const repos = cleanRepos(input.repos);
    if (repos.length === 0 || !validLabel(input.label)) return [];
    const label = input.label.trim();
    const limit = clampLimit(input.limit);
    // Pull requests share the endpoint and are dropped after, so ask for more than the limit.
    const perPage = Math.min(100, limit * 2);

    const reads = await Promise.all(
        repos.map((repo) =>
            syncedJson(config, {
                key: `github-issues:${repo.toLowerCase()}:${encodeURIComponent(label.toLowerCase())}:${perPage}`,
                url: `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=${perPage}`,
                pick: (json) => pickIssues(repo, json),
                check: isRows,
                ...options,
            }),
        ),
    );
    return reads.flatMap((r) => (r ? [r] : []));
}

/** The rows of every read, newest first, cut to `limit`. */
export function mergeIssues(reads: Synced<IssueRow[]>[], limit: unknown): IssueRow[] {
    return reads
        .flatMap((r) => r.value)
        .sort((a, b) => b.createdAt - a.createdAt || b.number - a.number)
        .slice(0, clampLimit(limit));
}
