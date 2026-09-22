// A Node module hook that stands in for the handful of things a component test needs from `next`
// and cannot resolve without Next's own bundler: next/link, next/headers, next/navigation,
// next/server. `next`'s package.json publishes no `exports` map, so a strict ESM resolver (this
// loader's own host, and Playwright's test runner) refuses a bare specifier like "next/link"
// outright rather than guessing an extension the way webpack and Turbopack both do (see CLAUDE.md
// 2a for the fuller version of that story). The existing unit tests dodge this with
// `vi.mock("next/link", ...)`; a component test run by Playwright has no such hook of its own, so
// this file is the same trade made at the loader level, for the same modules those tests already
// mock.
//
// Registered by next-stub-register.mjs via `node:module`'s `register`, which needs a Node process
// started with `--import ./look/next-stub-register.mjs`. `look:components` sets that through
// NODE_OPTIONS, which every child Node process (Playwright's own test workers included) reads.
const STUBS = {
    "next/link": "./next-stub-link.mjs",
    "next/headers": "./next-stub-headers.mjs",
    "next/navigation": "./next-stub-navigation.mjs",
    "next/server": "./next-stub-server.mjs",
};

export async function resolve(specifier, context, nextResolve) {
    const stub = STUBS[specifier];
    if (stub) return { url: new URL(stub, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
}
