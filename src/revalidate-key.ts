import { createHmac } from "node:crypto";
import { isTenantHandle } from "./delivery.js";
import { MIN_SECRET_LENGTH, readSecret, type SecretPurpose } from "./secret.js";

/*
 * The key one tenant's webhook signs with, on a request-time site.
 *
 * Every tenant's workflow used to hold the secret itself (PRESS_SECRET, or REVALIDATE_SECRET before
 * it), and a tenant admin can read and sign with what they pasted, so any tenant could purge any other. Each tenant now gets its own
 * key derived from that secret, so what one tenant holds verifies on its own host and no other.
 * Derived rather than stored, so a new tenant needs no configuration on the renderer.
 *
 * Lowercase hex, because barakoCMS keys the HMAC with the UTF-8 bytes of whatever is pasted into
 * the action's Secret, and this is used the same way here.
 */
export function revalidateKeyFor(secret: string, tenant: string): string {
    return createHmac("sha256", secret).update(`revalidate.${tenant}`, "utf8").digest("hex");
}

/**
 * The key one tenant's console reads its binding report with (#63), derived the same way and under
 * its own purpose label, so the key that reads a page's problems cannot also purge that page.
 */
export function bindingsKeyFor(secret: string, tenant: string): string {
    return createHmac("sha256", secret).update(`bindings.${tenant}`, "utf8").digest("hex");
}

export interface CommandResult {
    code: number;
    out?: string;
    err?: string;
}

const USAGE =
    "usage: barakopress revalidate-key <tenant handle>, or barakopress bindings-key <tenant handle>, with PRESS_SECRET (or REVALIDATE_SECRET for revalidate-key) in the environment";

const COMMANDS = {
    "revalidate-key": { purpose: "revalidate", derive: revalidateKeyFor },
    "bindings-key": { purpose: "bindings", derive: bindingsKeyFor },
} as const satisfies Record<string, { purpose: SecretPurpose; derive: (secret: string, tenant: string) => string }>;

/** `barakopress revalidate-key <tenant>` and `bindings-key <tenant>`. Prints a key, never the secret. */
export function runCli(args: string[], env: Record<string, string | undefined>): CommandResult {
    const [command, tenant, ...rest] = args;
    if (!command || !Object.hasOwn(COMMANDS, command) || rest.length > 0) return { code: 2, err: USAGE };
    const { purpose, derive } = COMMANDS[command as keyof typeof COMMANDS];
    if (!isTenantHandle(tenant)) return { code: 2, err: `not a tenant handle. ${USAGE}` };
    const secret = readSecret(purpose, env);
    if (!secret) {
        return {
            code: 1,
            err: purpose === "revalidate" ? "neither PRESS_SECRET nor REVALIDATE_SECRET is set" : "PRESS_SECRET is not set",
        };
    }
    // The route refuses a short PRESS_SECRET, so a key printed from one would never verify.
    if (secret.short && secret.name === "PRESS_SECRET") {
        return { code: 1, err: `PRESS_SECRET is shorter than ${MIN_SECRET_LENGTH} characters` };
    }
    return { code: 0, out: derive(secret.value, tenant) };
}
