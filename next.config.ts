import type { NextConfig } from "next";

/*
 * BASE_PATH serves the whole site under a prefix, such as /kape-ana behind a proxy that forwards that
 * path to this container. Next reads basePath at build time, so it is a build argument, and the same
 * value is set at runtime for src/base-path.ts. Normalised the way src/base-path.ts does it. Empty is left out so a site with no prefix builds as before.
 */
// Same rules as normalizeBasePath in src/base-path.ts, duplicated because this file cannot import
// the package's TypeScript: a segment that is dot-only, or holds a backslash, control character,
// "?" or "#", gives no base path at all.
function normalizeBasePath(raw: string | undefined): string {
  const parts = (raw ?? "").trim().split("/").filter((p) => p !== "");
  if (parts.some((p) => p === "." || p === ".." || /[\\\u0000-\u001f\u007f?#]/.test(p))) return "";
  return parts.length ? `/${parts.join("/")}` : "";
}
const basePath = normalizeBasePath(process.env.BASE_PATH);

const config: NextConfig = {
  ...(basePath ? { basePath } : {}),

  /*
   * Standalone output, so the container carries a server and its traced dependencies rather than
   * the whole node_modules tree. Without this the Dockerfile's runtime stage has nothing to copy.
   */
  output: "standalone",

  /*
   * Not a static export, deliberately, and this is the one decision the whole project turns on.
   *
   * The site this replaces used output: 'export', which meant an edit was invisible until somebody
   * rebuilt and redeployed. Rendering on the server instead means a publish is live in one request.
   * The cost that usually comes with that, a database read on every page view, is paid off by
   * src/cms.ts: every read is cached with no expiry and tagged, and only the signed webhook in
   * app/api/revalidate drops it. Ordinary traffic never reaches Postgres.
   */

  /*
   * No transpilePackages, and its absence is the point. This app consumes the engine by its package
   * name, the same way a client site does, so if the published package needed a line of consumer
   * config to compile, this file would need it too.
   */

  images: {
    // The CMS serves images from its own host with on-demand width variants, so Next's optimiser
    // would be a second resizer in front of a resizer. It also pulls in sharp, which is LGPL.
    unoptimized: true,
  },

  // Read once, at build time, from the Dockerfile's build argument. See PRESS_TRAILING_SLASH there.
  trailingSlash: process.env.PRESS_TRAILING_SLASH === "true",

  // Keep regenerated pages in memory only. The compose files run the site on a read-only root, where
  // writing them under .next/server fails and logs a warning on every regeneration. The image is
  // built with no CMS, so there were no rendered pages on disk worth keeping across a restart.
  experimental: { isrFlushToDisk: false },

  /*
   * Security headers the app sends itself, so the image is safe behind any proxy. The Caddyfile
   * sends the same ones plus HSTS and its own full Content-Security-Policy, and a response that
   * carries both is held to both.
   *
   * This header holds only the directives that never depend on a site: object-src, base-uri,
   * frame-ancestors (a browser ignores that one in a meta tag) and form-action. headers() is fixed
   * at build time, so it cannot know a tenant's embed hosts or the analytics origin. The script,
   * style, font, image, media, connect and frame policy is built per site in src/csp.ts and sent in a
   * meta tag at the top of every page head. PRESS_CSP=off turns that off.
   */
  async headers() {
    // Kept equal to STATIC_POLICY in src/csp.ts, which a test checks. This file cannot import the package's TypeScript.
    const STATIC_POLICY = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: STATIC_POLICY },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
