"use client";

import { useState, type CSSProperties } from "react";
import { FILTER_CHOSEN_ATTR, filterRule } from "./filter.js";

/*
 * The buttons of a `filterBar`. It is handed the bar's id and its values, never the rows: the rows
 * are already in the page as markup, and a client component's props are serialised into it.
 *
 * Buttons with `aria-pressed`, not a tablist. The tab pattern promises arrow keys and panels, and
 * this is a set of toggles over one list.
 *
 * At rest nothing is chosen and no rule is written, so a reader with no script sees every row.
 */

export interface FilterButtonsProps {
    id: string;
    values: string[];
    allLabel: string;
    label?: string;
    on: CSSProperties;
    off: CSSProperties;
    row: CSSProperties;
}

export function FilterButtons({ id, values, allLabel, label, on, off, row }: FilterButtonsProps) {
    const [chosen, setChosen] = useState<string | null>(null);
    const button = (value: string | null, text: string) => (
        <button
            key={value ?? ""}
            type="button"
            aria-pressed={chosen === value}
            style={chosen === value ? on : off}
            onClick={() => setChosen(value)}
        >
            {text}
        </button>
    );
    const chosenAttr = chosen === null ? {} : { [FILTER_CHOSEN_ATTR]: chosen };
    return (
        <div role="group" aria-label={label} style={row} {...chosenAttr}>
            {button(null, allLabel)}
            {values.map((value) => button(value, value))}
            {chosen !== null && <style dangerouslySetInnerHTML={{ __html: filterRule(id, chosen) }} />}
        </div>
    );
}
