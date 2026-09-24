import type { PressPlugin } from "barakopress";

/*
 * The plugin packages this image carries. Empty in the published image: a derived image's build
 * rewrites this file with scripts/plugins.mjs from the packages it installs (barakoPress #25). Each
 * tenant then turns on the ones it uses with its `Plugins` setting.
 */
export const plugins: PressPlugin[] = [];
