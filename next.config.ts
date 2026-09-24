import type { NextConfig } from "next";

const config: NextConfig = {
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
};

export default config;
