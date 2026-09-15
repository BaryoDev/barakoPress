import { createHmac } from "node:crypto";
import { isTenantHandle } from "./delivery.js";

/*
 * The key one tenant's webhook signs with, on a request-time site.
 *
 * Every tenant's workflow used to hold REVALIDATE_SECRET itself, and a tenant admin can read and
 * sign with what they pasted, so any tenant could purge any other. Each tenant now gets its own
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

const USAGE = "usage: barakopress revalidate-key <tenant handle>, with REVALIDATE_SECRET in the environment";

/** `barakopress revalidate-key <tenant>`. Prints the tenant's key and never the secret. */
export function runCli(args: string[], env: Record<string, string | undefined>): CommandResult {
    const [command, tenant, ...rest] = args;
    if (command !== "revalidate-key" || rest.length > 0) return { code: 2, err: USAGE };
    if (!isTenantHandle(tenant)) return { code: 2, err: `not a tenant handle. ${USAGE}` };
    const secret = env.REVALIDATE_SECRET;
    if (!secret) return { code: 1, err: "REVALIDATE_SECRET is not set" };
    return { code: 0, out: revalidateKeyFor(secret, tenant) };
}
