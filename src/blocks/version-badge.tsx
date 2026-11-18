import type { CSSProperties } from "react";
import { VERSION_SOURCES, type PressConfig, type VersionSource } from "../config.js";
import { latestVersion } from "../versions.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * The current version of a package or release, read from its registry (#232), so no page types one.
 *
 * The version is as old as the cache window and says so: the tooltip and a text form for a screen
 * reader both carry the time it was last checked. When the registry cannot be reached the last good
 * value is drawn, and when there never was one the label stands alone. Nothing here throws, because
 * a block that throws fails the page and an outage at npm must not do that.
 */

export const VERSION_BADGE_BLOCK = "versionBadge";

/** Visually hidden, still read aloud. */
const VISUALLY_HIDDEN: CSSProperties = {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
};

/** `2026-11-19 10:30 UTC`, the same wherever the page is read. */
export function checkedLabel(at: number): string {
    return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

type VersionBadgeProps = { source: string; id: string; label?: string };

export function versionBadgeBlocks(config: PressConfig): BlockDefinition[] {
    return [
        defineBlock<VersionBadgeProps>({
            type: VERSION_BADGE_BLOCK,
            label: "Version badge",
            layer: "block",
            fields: [
                { name: "source", kind: "select", label: "Registry", required: true, options: [...VERSION_SOURCES] },
                { name: "id", kind: "text", label: "Package or repository (owner/repo for github)", required: true },
                { name: "label", kind: "text", label: "Label" },
            ],
            component: async ({ props, theme }) => {
                const found = VERSION_SOURCES.includes(props.source as VersionSource)
                    ? await latestVersion(config, { source: props.source as VersionSource, id: props.id })
                    : null;
                const label = props.label?.trim();
                if (!found && !label) return null;

                const c = theme.colors;
                const checked = found ? `Last checked ${checkedLabel(found.checkedAt)}` : undefined;
                return (
                    <span
                        data-press="version-badge"
                        title={checked}
                        style={{
                            display: "inline-flex",
                            gap: theme.space.xs,
                            padding: `0 ${theme.space.sm}`,
                            border: `1px solid ${c.hairline}`,
                            borderRadius: theme.radii.control,
                            fontFamily: theme.fonts.mono,
                            fontSize: theme.text.small,
                            color: c.ink,
                        }}
                    >
                        {label && <span style={{ color: c.secondaryInk }}>{label}</span>}
                        {found && <span>{found.value}</span>}
                        {found && <span style={VISUALLY_HIDDEN}>{`, last checked ${checkedLabel(found.checkedAt)}`}</span>}
                    </span>
                );
            },
        }),
    ];
}
