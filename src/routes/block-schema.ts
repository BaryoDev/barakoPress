import { readEnv } from "../env.js";
import { blockSchema, type BlockRegistry } from "../blocks/schema.js";

/*
 * Publishes what this site can render, so an editor can offer exactly these blocks and these
 * fields without knowing anything about the site. It reads no CMS and holds nothing secret: the
 * field lists are already visible in any page's markup.
 *
 * The editor is barakoBrew, which normally runs on another origin than the site, so a browser only
 * hands it this answer when the site names that origin (barakoPress #32). Origins come from
 * `consoleOrigins`, or `PRESS_CONSOLE_ORIGINS` read per request, and none are allowed when both are
 * unset. The allowed origin is echoed rather than `*`, credentials are never allowed because the
 * schema is public, and every answer carries `Vary: Origin` so a shared cache cannot hand one
 * origin's answer to another.
 */

export interface BlockSchemaRouteOptions {
    /** Browser origins allowed to read the schema. Defaults to PRESS_CONSOLE_ORIGINS, comma separated. */
    consoleOrigins?: string[];
}

/** The http or https origins in a list, normalised. A path, a wildcard or `null` is dropped. */
export function parseOrigins(values: readonly string[] | string | undefined): string[] {
    const list = typeof values === "string" ? values.split(",") : (values ?? []);
    const out = new Set<string>();
    for (const raw of list) {
        const value = raw.trim();
        if (!value) continue;
        try {
            const url = new URL(value);
            const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
            if ((url.protocol === "http:" || url.protocol === "https:") && bare) out.add(url.origin);
        } catch {
            // Not a URL, so not an origin.
        }
    }
    return [...out];
}

function allowedOrigin(request: Request | undefined, options: BlockSchemaRouteOptions): string | null {
    const origin = request?.headers.get("origin");
    if (!origin) return null;
    const allowed = parseOrigins(options.consoleOrigins ?? readEnv().consoleOrigins);
    return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Headers {
    const headers = new Headers({ vary: "Origin" });
    if (origin) headers.set("access-control-allow-origin", origin);
    return headers;
}

export function createBlockSchemaRoute(registry: BlockRegistry, options: BlockSchemaRouteOptions = {}) {
    return function GET(request?: Request): Response {
        return Response.json(blockSchema(registry), { headers: corsHeaders(allowedOrigin(request, options)) });
    };
}

/** The preflight for the schema route. Mount it as `OPTIONS` beside `createBlockSchemaRoute`. */
export function createBlockSchemaPreflight(options: BlockSchemaRouteOptions = {}) {
    return function OPTIONS(request: Request): Response {
        const origin = allowedOrigin(request, options);
        const headers = corsHeaders(origin);
        if (origin) {
            headers.set("access-control-allow-methods", "GET, OPTIONS");
            headers.set("access-control-allow-headers", "Accept, Content-Type");
            headers.set("access-control-max-age", "600");
        }
        return new Response(null, { status: 204, headers });
    };
}
