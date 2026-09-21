// Loaded through NODE_OPTIONS="--import ./look/next-stub-register.mjs". Registers the hook in
// next-stub-loader.mjs before any other module (including the block registry) is resolved.
import { register } from "node:module";

register("./next-stub-loader.mjs", import.meta.url);
