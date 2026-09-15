/*
 * The one local secret this renderer keys its signatures with (barakoPress #50).
 *
 * PRESS_SECRET keys every signed thing, and each thing puts its own purpose label first in what it
 * signs (`revalidate.` for a tenant's webhook key, `press-share.` for a share session cookie), so a
 * signature made for one purpose never verifies as another. When PRESS_SECRET is unset, each purpose
 * reads the variable it used before, so a deployment that set those keeps working unchanged.
 *
 * This file imports nothing, because `barakopress revalidate-key` runs under plain Node, which cannot
 * resolve `next/headers` from `site.ts`.
 */

/** Below this a secret is a guess away. The same rule for every purpose. */
export const MIN_SECRET_LENGTH = 32;

const OLDER_NAMES = {
    revalidate: "REVALIDATE_SECRET",
    "press-share": "PRESS_PREVIEW_SECRET",
} as const;

export type SecretPurpose = keyof typeof OLDER_NAMES;

export interface PressSecret {
    value: string;
    /** The variable it came from, for a log line. Never the value. */
    name: string;
    /** Shorter than MIN_SECRET_LENGTH. */
    short: boolean;
}

/** The secret for a purpose, read when called: PRESS_SECRET, else the purpose's older name. Null when neither is set. */
export function readSecret(
    purpose: SecretPurpose,
    env: Record<string, string | undefined> = process.env,
): PressSecret | null {
    const name = env.PRESS_SECRET ? "PRESS_SECRET" : OLDER_NAMES[purpose];
    const value = env[name];
    return value ? { value, name, short: value.length < MIN_SECRET_LENGTH } : null;
}
