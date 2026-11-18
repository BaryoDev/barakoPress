import type { ReactNode } from "react";
import { formatDate } from "../cms.js";
import type { PressConfig } from "../config.js";
import { MAX_MILESTONES, MILESTONE_STATES, milestoneLimit, repoMilestones, type MilestoneState } from "../github-milestones.js";
import { progressBar } from "./primitives.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * A repository's GitHub milestones, each on the progress bar (#233).
 *
 * Closed issues are the bar's `count` and open issues its `remaining`, which makes the total the
 * sum. `total` is not used: it would read the open count as the whole. A milestone with no issues
 * has no total to divide by, so it is drawn as 0 percent rather than left without a bar.
 *
 * The engine picks no words. "Due", "closed" and "open" are fields the tenant fills in, and an
 * empty label says nothing. The due date is formatted in the site's locale and zone, and a
 * milestone without one shows no date. Nothing here throws: no reading draws nothing, or the
 * `empty` words when the tenant gave some.
 */

export const MILESTONES_BLOCK = "milestones";

type MilestonesProps = {
    repo: string;
    state?: string;
    limit?: number | string;
    dueLabel?: string;
    closedLabel?: string;
    openLabel?: string;
    empty?: string;
};

function percentText(config: PressConfig, percent: number): string {
    try {
        return new Intl.NumberFormat(config.locale, { style: "percent", maximumFractionDigits: 0 }).format(percent / 100);
    } catch {
        return `${percent}%`;
    }
}

export function milestonesBlocks(config: PressConfig): BlockDefinition[] {
    return [
        defineBlock<MilestonesProps>({
            type: MILESTONES_BLOCK,
            label: "GitHub milestones",
            layer: "block",
            fields: [
                { name: "repo", kind: "text", label: "Repository (owner/name)", required: true },
                { name: "state", kind: "select", label: "Which milestones", options: [...MILESTONE_STATES] },
                { name: "limit", kind: "number", label: "How many", min: 1, max: MAX_MILESTONES },
                { name: "dueLabel", kind: "text", label: "Say this before the due date" },
                { name: "closedLabel", kind: "text", label: "Say this beside the closed count" },
                { name: "openLabel", kind: "text", label: "Say this beside the open count" },
                { name: "empty", kind: "text", label: "Say this when there is nothing" },
            ],
            component: async ({ props, theme }) => {
                const state = MILESTONE_STATES.includes(props.state as MilestoneState) ? (props.state as MilestoneState) : "open";
                const found = await repoMilestones(config, props.repo, state, milestoneLimit(props.limit));
                const empty = props.empty?.trim();
                const list = found?.value ?? [];
                if (list.length === 0) {
                    return empty ? (
                        <p data-press="milestones" style={{ margin: 0, color: theme.colors.secondaryInk }}>
                            {empty}
                        </p>
                    ) : null;
                }

                const dueLabel = props.dueLabel?.trim();
                const closedLabel = props.closedLabel?.trim();
                const openLabel = props.openLabel?.trim();
                return (
                    <ul
                        data-press="milestones"
                        style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: theme.space.md }}
                    >
                        {list.map((m, i) => {
                            const total = m.closed + m.open;
                            // Floored, so the text never says 100 while an issue is open.
                            const percent = total > 0 ? Math.floor((m.closed / total) * 100) : 0;
                            // GitHub stores the day the maintainer chose, so it is the UTC calendar day in every zone.
                            const due = m.due ? formatDate(config, new Date(m.due).toISOString().slice(0, 10)) : "";
                            const bar = progressBar.component({
                                props: {
                                    label: m.title,
                                    ...(total > 0 ? { count: String(m.closed), remaining: String(m.open) } : { value: "0" }),
                                },
                                slots: {},
                                theme,
                            }) as ReactNode;
                            return (
                                <li key={`${i}-${m.title}`} data-press="milestone" style={{ display: "flex", flexDirection: "column", gap: theme.space.xs }}>
                                    {bar}
                                    <div
                                        style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: theme.space.sm,
                                            fontFamily: theme.fonts.mono,
                                            fontSize: theme.text.meta,
                                            color: theme.colors.secondaryInk,
                                        }}
                                    >
                                        <span data-press="milestone-percent">{percentText(config, percent)}</span>
                                        {closedLabel && <span data-press="milestone-closed">{`${closedLabel} ${m.closed}`}</span>}
                                        {openLabel && <span data-press="milestone-open">{`${openLabel} ${m.open}`}</span>}
                                        {due && <span data-press="milestone-due">{dueLabel ? `${dueLabel} ${due}` : due}</span>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                );
            },
        }),
    ];
}
