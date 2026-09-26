/*
 * The one local secret this renderer keys its signatures with (barakoPress #50).
 *
 * PRESS_SECRET keys every signed thing. A share session cookie always signs `press-share.` first. A
 * tenant's webhook key is derived under `revalidate.` on a request-time site (`sites`), and its
 * binding report key under `bindings.` when the tenant is pinned or resolved per request, so a key
 * derived for one purpose never verifies as another. Where nothing is derived, PRESS_SECRET itself is
 * the key: the webhook of a site without `sites`, and the binding report of a site with no tenant.
 * A build-time site with no pinned tenant therefore verifies both with the same value. The key
 * `barakopress bindings-key` prints is always a derived one, and opens neither there.
 *
 * When PRESS_SECRET is unset, each purpose reads the variable it used before, so a deployment that
 * set those keeps working unchanged.
 *
 * The values come from `readEnv` like every other environment value (barakoPress #51), untrimmed:
 * a secret with a trailing space is a different HMAC key, so trimming it would stop every webhook
 * that verifies today.
 *
 * Its one import is `env.js`, which imports nothing, because `barakopress revalidate-key` runs under
 * plain Node, which cannot resolve `next/headers` from `site.ts`.
 */

import { ENV_NAMES, readEnv, type Env } from "./env.js";

/** Below this a secret is a guess away. The same rule for every purpose. */
export const MIN_SECRET_LENGTH = 32;

/**
 * The `PressEnv` key each purpose falls back to while `PRESS_SECRET` is unset. A purpose with no
 * older name shipped after PRESS_SECRET did, so there is nothing for it to fall back to and it
 * needs PRESS_SECRET set.
 */
const OLDER = {
    revalidate: "revalidateSecret",
    "press-share": "previewSecret",
    bindings: undefined,
} as const;

export type SecretPurpose = keyof typeof OLDER;

export interface PressSecret {
    value: string;
    /** The variable it came from, for a log line. Never the value. */
    name: string;
    /** Shorter than MIN_SECRET_LENGTH. */
    short: boolean;
}

/** The secret for a purpose, read when called: PRESS_SECRET, else the purpose's older name. Null when neither is set. */
export function readSecret(purpose: SecretPurpose, env?: Env): PressSecret | null {
    const values = readEnv(env);
    const key = values.secret ? "secret" : OLDER[purpose];
    if (!key) return null;
    const value = values[key];
    return value ? { value, name: ENV_NAMES[key], short: value.length < MIN_SECRET_LENGTH } : null;
}
