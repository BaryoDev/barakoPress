/*
 * The one place this package reads the environment (barakoPress #51).
 *
 * Nothing else in `src/` names `process.env`, and `src/env.test.ts` fails if something starts to.
 * Before this, a value's read time depended on which value it was: `CMS_URL` and `CMS_TENANT` were
 * read inside `defineConfig`, which runs at module scope in a consumer's `press.config.ts`, while
 * the secrets, the default tenant, the renderer key and the console origins were read per request
 * in whichever file happened to want them. Nobody could say when a given variable was read without
 * going to look.
 *
 * So the rule is one rule: `readEnv` reads every value, and it is called where the value is used,
 * never at module scope. A value read at module scope is baked into whatever is prerendered at
 * build time, and one image here serves many tenants and many deployments.
 *
 * Values come back exactly as the environment has them. Trimming, splitting and length rules belong
 * to whoever uses the value: a secret with a trailing space is a different HMAC key, and trimming it
 * here would silently stop every webhook that verifies today.
 *
 * This file imports nothing, because `barakopress revalidate-key` runs under plain Node, which
 * cannot resolve `next/headers` from `site.ts`.
 */

export type Env = Record<string, string | undefined>;

/** Every environment value barakoPress reads, under the name the code uses for it. */
export interface PressEnv {
    /** `CMS_URL`. Where the delivery API is, from this server. */
    cmsUrl?: string;
    /** `CMS_TENANT`. Pins this process to one tenant, whatever host a request came to. */
    tenant?: string;
    /** `CMS_DEFAULT_TENANT`. The tenant for a host the CMS does not know. */
    defaultTenant?: string;
    /** `CMS_RENDERER_KEY`. Sent when a share link is redeemed, so the CMS rate limits the visitor. */
    rendererKey?: string;
    /** `PRESS_CONSOLE_ORIGINS`. Comma separated browser origins allowed to read the block schema. */
    consoleOrigins?: string;
    /** `PRESS_SECRET`. The HMAC key for everything this renderer signs. */
    secret?: string;
    /** `REVALIDATE_SECRET`. The webhook key before `PRESS_SECRET`, read only while that is unset. */
    revalidateSecret?: string;
    /** `PRESS_PREVIEW_SECRET`. The share key before `PRESS_SECRET`, read only while that is unset. */
    previewSecret?: string;
}

/** The variable each value comes from. A log line names this, never the value. */
export const ENV_NAMES = {
    cmsUrl: "CMS_URL",
    tenant: "CMS_TENANT",
    defaultTenant: "CMS_DEFAULT_TENANT",
    rendererKey: "CMS_RENDERER_KEY",
    consoleOrigins: "PRESS_CONSOLE_ORIGINS",
    secret: "PRESS_SECRET",
    revalidateSecret: "REVALIDATE_SECRET",
    previewSecret: "PRESS_PREVIEW_SECRET",
} as const satisfies Record<keyof PressEnv, string>;

/** Reads every value, now. Call it where the value is used, never at module scope. */
export function readEnv(env: Env | undefined = process.env): PressEnv {
    const out: PressEnv = {};
    for (const key of Object.keys(ENV_NAMES) as (keyof PressEnv)[]) {
        const value = env[ENV_NAMES[key]];
        if (value !== undefined) out[key] = value;
    }
    return out;
}
