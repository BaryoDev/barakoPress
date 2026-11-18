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
    /** Epoch milliseconds the issue was opened. Absent when the API gave none that can be read. */
    createdAt?: number;
}

/** The most repositories one block reads, and the bounds on how many rows it shows. */
export const MAX_REPOS = 10;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 10;
const PER_PAGE = 100;
/** Short, so the snapshot file name made from it stays well under a file system's limit. */
const MAX_LABEL = 50;
const MAX_TITLE = 300;
const HTML_URL_PREFIX = "https://github.com/";

/**
 * A label is one line of text. Control characters and an empty value are refused, not repaired. A
 * comma is refused too: GitHub splits `labels` on it and would filter on several labels at once.
 */
function validLabel(label: unknown): label is string {
    return (
        typeof label === "string" &&
        label.trim() !== "" &&
        label.trim().length <= MAX_LABEL &&
        !label.includes(",") &&
        !/[\u0000-\u001f\u007f]/.test(label)
    );
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
        if (typeof e.number !== "number" || !Number.isInteger(e.number) || e.number < 1 || title === "") continue;
        // A row whose date cannot be read is still an open issue, so it stays and shows no age.
        rows.push({
            repo,
            number: e.number,
            title,
            url: linkFor(repo, e.number, e.html_url),
            ...(Number.isFinite(created) ? { createdAt: created } : {}),
        });
    }
    return rows;
}

/** A kept value is checked as closely as a fresh one: it is drawn as a link and as a number. */
export const isRows = (v: unknown): v is IssueRow[] =>
    Array.isArray(v) &&
    v.every(
        (r) =>
            r &&
            typeof r.repo === "string" &&
            typeof r.title === "string" &&
            typeof r.url === "string" &&
            r.url.startsWith(HTML_URL_PREFIX) &&
            Number.isInteger(r.number) &&
            (r.createdAt === undefined || Number.isFinite(r.createdAt)),
    );

/** The reads that came back, and whether any did. No read at all is an outage or a bad id, not an empty list. */
export interface IssueReads {
    reads: Synced<IssueRow[]>[];
    ok: boolean;
}

/**
 * One read per repository, and every read asks for a full page (100) and is cut to the limit after
 * filtering, so blocks that differ only in their limit share one call. There is no paging past 100.
 * Never throws.
 */
export async function openIssues(
    config: PressConfig,
    input: { repos: unknown; label: unknown },
    options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<IssueReads> {
    const repos = cleanRepos(input.repos);
    if (repos.length === 0 || !validLabel(input.label)) return { reads: [], ok: false };
    const label = input.label.trim();

    const reads = await Promise.all(
        repos.map(async (repo) => {
            const read = await syncedJson(config, {
                key: `github-issues:${repo.toLowerCase()}:${label.toLowerCase()}`,
                url: `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=${PER_PAGE}`,
                pick: (json) => pickIssues(repo, json),
                check: isRows,
                ...options,
            });
            // The kept rows carry the case of whichever block read first. The name shown is this block's own.
            return read ? { ...read, value: read.value.map((row) => ({ ...row, repo })) } : null;
        }),
    );
    const got = reads.flatMap((r) => (r ? [r] : []));
    return { reads: got, ok: got.length > 0 };
}

/** The rows of every read, newest first (rows with no date last), cut to `limit`. */
export function mergeIssues(reads: Synced<IssueRow[]>[], limit: unknown): IssueRow[] {
    return reads
        .flatMap((r) => r.value)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.number - a.number)
        .slice(0, clampLimit(limit));
}
