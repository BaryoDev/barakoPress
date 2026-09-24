import type { PressConfig } from "../config.js";
import { readEnv } from "../env.js";
import { registryFor } from "../blocks/registry.js";
import { withEnabledPlugins } from "../blocks/plugins.js";
import { blockSchema, installedPlugins, type BlockRegistry } from "../blocks/schema.js";
import { siteConfigOrNull, tenantVary } from "../site.js";

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
 *
 * Given the config, a request-time site answers with the requesting tenant's schema (#134): the
 * tenant is found the way a page finds it, from the host through the CMS, or CMS_TENANT, the header
 * the operator named, or CMS_DEFAULT_TENANT, and nothing a caller sends picks a tenant any other way.
 * The proxy does not rewrite /api, so this reads the request's headers, as the binding report and the
 * revalidate endpoint do. The tenant's presets and tones come from its settings, read through the
 * same cached read every page makes, so they are cached under the tenant's tag and a settings change
 * shows after the delivery that purges it. A host with no tenant is a 404, as it is on a page.
 *
 * Given the config, a plugin's blocks are listed only for a site or tenant that enabled the plugin
 * (#25), and `plugins` names every plugin the image carries with whether it is on.
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

function isRegistry(value: PressConfig | BlockRegistry): value is BlockRegistry {
    return typeof (value as BlockRegistry).values === "function" && typeof (value as BlockRegistry).get === "function";
}

/** The schema of one registry, as every site answered before a config could be passed. */
export function createBlockSchemaRoute(
    registry: BlockRegistry,
    options?: BlockSchemaRouteOptions,
): (request?: Request) => Response;
/** The schema of the tenant a request belongs to, or of `registry` itself on a build-time site. */
export function createBlockSchemaRoute(
    config: PressConfig,
    registry: BlockRegistry,
    options?: BlockSchemaRouteOptions,
): (request: Request) => Promise<Response>;
export function createBlockSchemaRoute(
    first: PressConfig | BlockRegistry,
    second?: BlockRegistry | BlockSchemaRouteOptions,
    third: BlockSchemaRouteOptions = {},
) {
    if (isRegistry(first)) {
        const registry = first;
        const options = (second ?? {}) as BlockSchemaRouteOptions;
        return function GET(request?: Request): Response {
            return Response.json(blockSchema(registry), { headers: corsHeaders(allowedOrigin(request, options)) });
        };
    }

    const base = first;
    const registry = second as BlockRegistry;
    const options = third;
    // Required, not optional: Next's route type check refuses a handler whose request may be absent.
    return async function GET(request: Request): Promise<Response> {
        const headers = corsHeaders(allowedOrigin(request, options));
        if (!base.sites) return Response.json(schemaFor(base, registry, withEnabledPlugins(registry, base.plugins)), { headers });

        const vary = tenantVary(base);
        if (vary) headers.set("vary", `Origin, ${vary}`);
        let config: PressConfig | null;
        try {
            config = await siteConfigOrNull(base);
        } catch (e) {
            // Next's own signals, a dynamic bailout among them, are not failures and go back to it.
            if (e && typeof e === "object" && "digest" in e) throw e;
            const why = e instanceof Error ? e.message : String(e);
            console.warn(`blocks: the tenant for this request could not be resolved (${why})`);
            return Response.json({ error: "unavailable" }, { status: 503, headers });
        }
        if (!config) return Response.json({ error: "no site" }, { status: 404, headers });
        return Response.json(schemaFor(config, registry, registryFor(config, registry)), { headers });
    };
}

/*
 * Installed is read off the whole registry and enabled off the config, so a tenant sees the switch for
 * a plugin it has not turned on without seeing that plugin's blocks.
 */
function schemaFor(config: PressConfig, all: BlockRegistry, rendered: BlockRegistry) {
    const plugins = installedPlugins(all).map((name) => ({ name, enabled: config.plugins.includes(name) }));
    return blockSchema(rendered, plugins);
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
