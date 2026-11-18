import type { PressConfig } from "../config.js";
import { clampLimit, MAX_LIMIT, MAX_REPOS, MIN_LIMIT, mergeIssues, openIssues } from "../issues.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * Open issues with one label from public repositories (#234), so a list such as "known gaps" is the
 * issue tracker and closing an issue removes the line.
 *
 * Titles are written by strangers and go in as React text, never as HTML. The words around them
 * (the heading and the empty line) are the tenant's fields, and the engine picks none: with no
 * `emptyText` an empty list draws nothing at all, not even the heading. The age is formatted for
 * the site's locale. Nothing here throws, because a block that throws fails the page and a GitHub
 * outage must not do that.
 */

export const ISSUE_LIST_BLOCK = "issueList";

type IssueListProps = { repos: string[]; label: string; limit?: number; heading?: string; emptyText?: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in the site's own language. Falls back to the ISO date if the locale is refused. */
export function ageText(locale: string, at: number, now: number): string {
    const diff = Math.max(0, now - at);
    const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
        diff < HOUR ? [Math.floor(diff / MINUTE), "minute"]
        : diff < DAY ? [Math.floor(diff / HOUR), "hour"]
        : diff < 30 * DAY ? [Math.floor(diff / DAY), "day"]
        : diff < 365 * DAY ? [Math.floor(diff / (30 * DAY)), "month"]
        : [Math.floor(diff / (365 * DAY)), "year"];
    try {
        return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-value, unit);
    } catch {
        return new Date(at).toISOString().slice(0, 10);
    }
}

export function issueListBlocks(config: PressConfig): BlockDefinition[] {
    return [
        defineBlock<IssueListProps>({
            type: ISSUE_LIST_BLOCK,
            label: "Issue list",
            layer: "block",
            fields: [
                {
                    name: "repos",
                    kind: "list",
                    label: "Repositories (owner/name)",
                    required: true,
                    max: MAX_REPOS,
                    item: { kind: "text", label: "Repository" },
                },
                { name: "label", kind: "text", label: "Label", required: true },
                { name: "limit", kind: "number", label: "Most shown", min: MIN_LIMIT, max: MAX_LIMIT },
                { name: "heading", kind: "text", label: "Heading" },
                { name: "emptyText", kind: "text", label: "Line when there are none" },
            ],
            component: async ({ props, theme }) => {
                const limit = clampLimit(props.limit);
                const rows = mergeIssues(await openIssues(config, { repos: props.repos, label: props.label, limit }), limit);
                const heading = props.heading?.trim();
                const empty = props.emptyText?.trim();
                if (rows.length === 0 && !empty) return null;

                const c = theme.colors;
                const now = Date.now();
                return (
                    <section
                        data-press="issue-list"
                        style={{
                            background: c.surface,
                            border: `1px solid ${c.hairline}`,
                            borderRadius: theme.radii.panel,
                            padding: theme.space.md,
                            color: c.ink,
                        }}
                    >
                        {heading && <h2 style={{ margin: 0, fontSize: theme.text.subheading, fontFamily: theme.fonts.heading }}>{heading}</h2>}
                        {rows.length === 0 ? (
                            <p data-press="issue-list-empty" style={{ margin: 0, color: c.secondaryInk }}>
                                {empty}
                            </p>
                        ) : (
                            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: theme.space.sm }}>
                                {rows.map((row) => (
                                    <li key={`${row.repo}#${row.number}`} data-press="issue-list-row">
                                        <a href={row.url} rel="noopener noreferrer" style={{ color: c.ink }}>
                                            {row.title}
                                        </a>
                                        <span style={{ display: "block", color: c.muted, fontSize: theme.text.small }}>
                                            <span>{row.repo.split("/")[1]}</span> <span>{`#${row.number}`}</span>{" "}
                                            <time dateTime={new Date(row.createdAt).toISOString()}>{ageText(config.locale, row.createdAt, now)}</time>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                );
            },
        }),
    ];
}
