import { defineBlock, definePlugin } from "barakopress";

/*
 * A tally: a number, what it counts, and an optional note underneath. The shape every plugin takes:
 * `defineBlock` for each block, typed by the props its component reads, and `definePlugin` as the
 * package's default export.
 *
 * The component gets the block's props, its rendered slots and the theme, and nothing else. What it
 * shows is what an editor typed, or what a binding resolved in the engine before it got here.
 */
type TallyProps = {
    count: number;
    label: string;
    tone?: string;
};

const tally = defineBlock<TallyProps, "note">({
    type: "sampleTally",
    label: "Tally",
    fields: [
        { name: "count", kind: "number", label: "Count", required: true, min: 0 },
        { name: "label", kind: "text", label: "What it counts", required: true },
        { name: "tone", kind: "select", label: "Colour", options: ["accent", "ink"] },
        { name: "note", kind: "slots", label: "Note", max: 1 },
    ],
    component: ({ props, slots, theme }) => (
        <figure className="sample-tally" style={{ margin: 0 }}>
            <strong
                style={{
                    display: "block",
                    fontFamily: theme.fonts.heading,
                    fontSize: theme.text.display,
                    color: props.tone === "ink" ? theme.colors.ink : theme.colors.accent,
                }}
            >
                {props.count.toLocaleString("en")}
            </strong>
            <figcaption style={{ color: theme.colors.muted }}>{props.label}</figcaption>
            {slots.note}
        </figure>
    ),
});

export default definePlugin({ name: "sample", label: "Sample", blocks: [tally] });
