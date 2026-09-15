import { createHmac } from "node:crypto";
import { isTenantHandle } from "./delivery.js";
import { MIN_SECRET_LENGTH, readSecret } from "./secret.js";

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

export interface CommandResult {
    code: number;
    out?: string;
    err?: string;
}

const USAGE = "usage: barakopress revalidate-key <tenant handle>, with PRESS_SECRET (or REVALIDATE_SECRET) in the environment";

/** `barakopress revalidate-key <tenant>`. Prints the tenant's key and never the secret. */
export function runCli(args: string[], env: Record<string, string | undefined>): CommandResult {
    const [command, tenant, ...rest] = args;
    if (command !== "revalidate-key" || rest.length > 0) return { code: 2, err: USAGE };
    if (!isTenantHandle(tenant)) return { code: 2, err: `not a tenant handle. ${USAGE}` };
    const secret = readSecret("revalidate", env);
    if (!secret) return { code: 1, err: "neither PRESS_SECRET nor REVALIDATE_SECRET is set" };
    // The route refuses a short PRESS_SECRET, so a key printed from one would never verify.
    if (secret.short && secret.name === "PRESS_SECRET") {
        return { code: 1, err: `PRESS_SECRET is shorter than ${MIN_SECRET_LENGTH} characters` };
    }
    return { code: 0, out: revalidateKeyFor(secret.value, tenant) };
}
