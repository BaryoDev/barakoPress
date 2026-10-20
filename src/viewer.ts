import { cookies } from "next/headers";
import { cmsUrlFor, type PressConfig } from "./config.js";
import { carriesSecretsSafely, deliveryHeaders } from "./delivery.js";

/*
 * Viewer sessions (barakoPress #7).
 *
 * A viewer signs in with a barakoCMS account and the CMS token is kept in an http-only cookie, read
 * on the server only. It is never in a rendered page, a prop or a response body, so page script
 * cannot reach it. `getViewer` asks the CMS who the token belongs to and hands back that and
 * nothing else.
 *
 * Off unless the config sets `viewerSessions`. Off, nothing here reads a cookie or calls the CMS.
 */

/** Host-only by its prefix: a browser refuses it with a Domain, without Secure, or off Path=/. */
export const VIEWER_COOKIE = "__Host-press-viewer";

const LONGEST_SESSION_SECONDS = 24 * 60 * 60;
const DEFAULT_SESSION_SECONDS = 60 * 60;
const LONGEST_TOKEN = 8192;

export interface ViewerCredentials {
    username: string;
    password: string;
}

export type SignInResult =
    | { ok: true }
    | { ok: false; reason: "off" | "invalid" | "approval" | "unavailable" };

export interface Viewer {
    id: string;
    username: string;
    tenant: string;
    /** Role names, sorted. */
    roles: string[];
    capabilities: string[];
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function sessionSeconds(expiry: unknown): number {
    const at = typeof expiry === "string" ? Date.parse(expiry) : NaN;
    if (Number.isNaN(at)) return DEFAULT_SESSION_SECONDS;
    return Math.min(LONGEST_SESSION_SECONDS, Math.floor((at - Date.now()) / 1000));
}

export async function signIn(config: PressConfig, credentials: ViewerCredentials): Promise<SignInResult> {
    if (config.viewerSessions !== true) return { ok: false, reason: "off" };
    // A password does not travel over plain http to a CMS that is not on this machine.
    if (!carriesSecretsSafely(cmsUrlFor(config))) return { ok: false, reason: "unavailable" };
    let res: Response;
    try {
        res = await fetch(`${cmsUrlFor(config)}/api/auth/login`, {
            method: "POST",
            headers: { ...(deliveryHeaders(config) as Record<string, string>), "content-type": "application/json" },
            body: JSON.stringify({ username: credentials.username, password: credentials.password }),
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
        });
    } catch {
        return { ok: false, reason: "unavailable" };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, reason: "invalid" };
    if (!res.ok) return { ok: false, reason: "unavailable" };

    let body: { token?: unknown; expiry?: unknown; requiresDeviceApproval?: unknown };
    try {
        body = await res.json();
    } catch {
        return { ok: false, reason: "unavailable" };
    }
    // The password was right but the device is not approved: the CMS issued no token.
    if (body.requiresDeviceApproval === true) return { ok: false, reason: "approval" };
    const token = body.token;
    if (typeof token !== "string" || token === "" || token.length > LONGEST_TOKEN || /[\s;,"\\]/.test(token)) {
        return { ok: false, reason: "unavailable" };
    }
    const maxAge = sessionSeconds(body.expiry);
    if (maxAge <= 0) return { ok: false, reason: "unavailable" };

    (await cookies()).set(VIEWER_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge,
    });
    return { ok: true };
}

export async function signOut(): Promise<void> {
    (await cookies()).set(VIEWER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/**
 * Who is signed in, or null: sessions off, no cookie, a token the CMS no longer accepts, or a CMS
 * that could not be reached. A failed read signs nobody in, it never throws.
 */
export async function getViewer(config: PressConfig): Promise<Viewer | null> {
    if (config.viewerSessions !== true) return null;
    const token = (await cookies()).get(VIEWER_COOKIE)?.value;
    if (!token) return null;
    if (!carriesSecretsSafely(cmsUrlFor(config))) return null;
    try {
        const res = await fetch(`${cmsUrlFor(config)}/api/me`, {
            headers: { ...(deliveryHeaders(config) as Record<string, string>), authorization: `Bearer ${token}` },
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
        });
        if (!res.ok) return null;
        const me = (await res.json()) as Record<string, unknown>;
        if (typeof me.userId !== "string" || typeof me.username !== "string") return null;
        const roles = Array.isArray(me.roles)
            ? me.roles.flatMap((r) => (r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string" ? [(r as { name: string }).name] : []))
            : [];
        return {
            id: me.userId,
            username: me.username,
            tenant: typeof me.tenant === "string" ? me.tenant : "",
            roles: roles.sort(),
            capabilities: strings(me.capabilities),
        };
    } catch (e) {
        // A framework signal (a dynamic-render bailout) is not ours to swallow.
        if (e && typeof e === "object" && "digest" in e) throw e;
        return null;
    }
}

/** The `viewer` binding scope: only what a page may show, never the token. */
export function viewerScope(viewer: Viewer | null): Record<string, unknown> {
    if (!viewer) return {};
    return { Id: viewer.id, Username: viewer.username, Tenant: viewer.tenant, Roles: viewer.roles, Capabilities: viewer.capabilities };
}
