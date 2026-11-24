/*
 * What the container healthcheck asks for. It answers from this process and reads nothing from the
 * CMS, so a check made before barakoCMS serves the tenant renders no page and caches nothing. The
 * proxy never rewrites /api, so it answers the same for every host.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
    return new Response("ok\n", {
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
}
