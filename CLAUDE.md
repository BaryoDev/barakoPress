# barakoPress

A blog engine on [barakoCMS](https://github.com/BaryoDev/barakoCMS). A site depends on it as a
package and re-exports what it wants from its own route files.

This file is the working agreement for anyone changing code here, person or agent. It is named for
the tool that reads it automatically.

---

## 1. What this is, and the line it must not cross

It is **an engine, not a site**. There is exactly one test that matters, and everything below is
downstream of it:

> A client whose content type is `article` with a field called `Headline`, no authors, no
> categories, and posts mounted at `/writing`, gets a working site by writing a config file.

barakoCMS content types are defined at runtime. A client's model being nothing like the `blog`
blueprint is the normal case, not the exception. The day a type name, a field name or a route
prefix is written as a literal in `src/`, the engine has become one blog wearing a package name,
and the third client forks it.

So: **no content-shape literal outside `src/config.ts`.** If you need one, it is a config field.
CI builds a consumer with a deliberately non-blueprint model on every push, and that is the gate.

`app/` is the reference deployment, not the product. It exists to prove the package works from
the outside, which is why its route files are two lines that import from `barakopress`, the same
way a consumer's are.

## 2. Layout

```
src/config.ts        the seam. Type names, field map, routes, page sizes, identity, cache tag
src/site.ts          request-time sites: host to tenant, settings to identity and theme
src/delivery.ts      HTTP against the public delivery API. Takes config, reads no globals
src/cms.ts           maps a stored entry onto what a page renders, through the field names config holds
src/markdown.ts      markdown to HTML, treating the input as untrusted
src/screens/*.tsx    factories that take config and return a page component
src/routes/*.ts      factories for the feed, sitemap, robots and the revalidate endpoint
src/styles.css       Signal tokens. A consumer may take the markup and none of this
app/                 the reference deployment: thin re-exports
look/                the look check: pair list, capture, comparison, fixtures. Not published
dist/                the published package: what tsc makes of src. Never edited, never committed
tsconfig.build.json  the package build. The repo's tsconfig is typecheck only
```

The screens are in `src/screens`, not `src/pages`, because Next claims `pages` and `app` as router
directories and a `src/pages` inside a transpiled package is read as a second router.

`app/` imports `barakopress` by name and resolves through `dist`, the same as a client site, so
`dist` has to exist before the reference app builds. `npm run dev` and `npm run build` build the
package first for that reason; `npm run watch` is the loop while changing `src/`.

## 2a. The build, and why there is one

The package ships compiled JS plus declarations. It used to ship TypeScript and point `exports` at
`src/index.ts`, which worked only because every consumer added `transpilePackages: ["barakopress"]`.
That is a fine bargain for one site the author owns and a bad one for a published package: it makes
the consumer's build configuration part of the install instructions, it makes our `strict` settings
and our TS version their problem, and a consumer with `jsx: "preserve"` and no transpile line gets a
parse error out of `node_modules`. Compiling here costs one build step in this repository and removes
a step from every consumer, forever. That is the trade, and it is why the decision went this way.

What the build may not do, because of what is exported:

- **No bundler.** `tsc` transpiles per file, one in and one out. The module graph is the contract
  here: `next/*` and `react` must stay external so the consumer's copies are what run, and the
  export names are what a consumer writes in its own route files. A bundler that inlines or reorders
  that hands Next something it cannot wire up. It also keeps the `"use client"` directive where Next
  looks for it. Three files in `src` carry one (`src/blocks/search-keys.tsx`,
  `src/blocks/filter-bar.tsx`, `src/screens/header-menu.tsx`): a directive is a file level marker
  Next reads off the module it resolves, and a bundler is free to move it.
- **No minifying or mangling.** Same reason. An export name is load-bearing, and so is a directive.
- **Every relative import carries `.js`, and the reason is narrower than it looks.** The package is
  `type: module`, so `./config.js` is the specifier ESM asks for and `./config` is not, and `tsc`
  never rewrites a specifier. What this does **not** buy is a default Next build. Measured on Next
  16.3.4: strip every extension, pack, install into a fresh app with no `transpilePackages`, and the
  build exits 0 under Turbopack and under `--webpack`, and serves the same pages. Next's webpack
  config sets `fullySpecified: false` for `.m?js`, so webpack does not ask. Two resolvers do ask. A
  consumer on webpack with `experimental.fullySpecified: true` fails on the extensionless build
  (`Did you mean 'config.js'?`) and builds clean on this one. Node's own resolver, reached when a
  consumer sets `serverExternalPackages: ["barakopress"]`, refuses the extensionless `dist` at
  `dist/config`, and refuses this one too at `next/link`, which has no exports map: extensions are
  necessary there and not sufficient, so that configuration is broken either way today. CI greps for
  an extensionless specifier to hold the form. `nodenext` would enforce it at compile time, but it
  refuses `next/link` for that same missing exports map.

`src` ships alongside `dist` so the source maps resolve in a consumer's stack trace. Nothing imports
it: `exports` points at `dist`, and `./styles.css` is the one file served from `src`.

Publishing is in `RELEASING.md`. `prepare` runs the build, so `npm pack` and `npm publish` cannot
ship a stale `dist`.

## 3. The rules that came from being wrong

Each of these is here because it broke, not because it sounded right.

**Nothing reads `process.env` at module scope.** A value read there is baked into a prerender at
build time. Site identity did exactly that, so a client's masthead said "barakoPress" until
something revalidated it. A build-time site keeps per-site values as literals in its
`press.config.ts`. A request-time site (`sites` in the config, barakoCMS D22) reads them from the
tenant's settings inside the render, in `src/site.ts`, and every factory resolves that first. Only
per-environment values (`CMS_URL`, `PRESS_SECRET`, `CMS_TENANT`, `CMS_DEFAULT_TENANT`) come from
the environment.

**A request-time read carries its tenant, or does not happen.** The tenant goes in the header, the
cache tag and the key of the last good answer. `cacheTagFor` throws for a request-time config that
was never resolved, so a new call site that forgets `siteConfig` fails loudly instead of caching an
answer no tenant owns. A handle is never read from the request unless the operator named the header.

**Route segment config belongs to the consumer.** Next reads `export const revalidate` from the
file that owns the route and does not reliably follow a re-export.

**A route that reads the CMS must not throw.** The feed and the sitemap are prerendered, so a
throw fails the consumer's whole build, and at runtime it hands a crawler a 500. Both have failed
this way. Catch and return empty.

**Ordering is asked of the API.** Sorting the page that came back only orders those rows, so past
one page the "newest" list is newest-of-an-arbitrary-page.

**Preview forces a route dynamic.** Reading `searchParams` means `output: "export"` refuses the
build outright. That is why there are two post screens over one `PostView`: a static site takes
`createBlogPost` and gives up preview.

**Measure before you claim.** A cache-warming step lived here for a day with fourteen lines of
comment explaining behaviour it did not have. An instrumented CMS showed it caused zero reads.

## 4. The revalidate endpoint

It is the only writer to the cache and it is reachable by anyone who finds the URL, so the order
of the checks is part of the design: cheap checks first, body read last and bounded, signature
compared in constant time, timestamp refused outside the window, each signature honoured once per
tenant. A request-time site verifies with the key derived for the tenant its host resolves to, never
with `PRESS_SECRET` itself (`src/revalidate-key.ts`). Every secret is read through `readSecret` in
`src/secret.ts`, one length rule for every purpose, with the older names as fallbacks.

The signing recipe is barakoCMS `docs/webhooks.md`. The signature covers the **raw body bytes**:
parse the JSON first and you have re-serialised it into something that will never verify.

A consumer with `trailingSlash: true` must configure the webhook URL **with** the slash. Next
answers 308 otherwise, and barakoCMS does not follow redirects on a webhook, deliberately.

## 5. Markdown is untrusted

An editor is authenticated, so `src/markdown.ts` is the second line of defence, not the first. It
escapes raw HTML rather than passing it through, allows only http, https and mailto destinations,
and escapes text into every attribute. The trade is that an author cannot embed an iframe. When
that is wanted the answer is a content field the frontend renders deliberately, not a hole here.

## 6. Testing

The engine's own build proves almost nothing. What proves something:

- build the reference app **with no CMS reachable**, which is how the image is built
- pack the tarball, install it into a separate app, and build that
- do it against a content model that is not the blueprint
- do it with **no `transpilePackages`** in the consumer, which is the claim the package makes

When iterating locally, give each packed tarball a different name. npm caches a `file:` tarball by
path and version, so reinstalling the same name serves the old code, which once made a fixed bug
look unfixed.

A consumer test that only typechecks proves less than it looks like it does. `next build` resolves
`dist` through Turbopack or webpack and then renders with it, and `tsc` does neither. Build the
consumer, and start it and read a page if the change touched rendering.

Claims about a resolver are cheap to make and cheap to check, so check them. Turbopack, webpack and
Node do not agree about extensionless specifiers, and which of them cares today is one `next build`
away: strip, pack, install, build, read the exit code.

## 7. Style

Follow the house style in the repository owner's global rules: plain, direct, short. No em dashes
anywhere, in code, comments, commits or docs. CI fails on one.

Comments earn their place by explaining a non-obvious why, an invariant the types cannot express,
or a decision that will look wrong later. Most of the comments in `src/` are the second kind.
