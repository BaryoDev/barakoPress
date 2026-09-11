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
src/delivery.ts      HTTP against the public delivery API. Takes config, reads no globals
src/cms.ts           maps a stored entry onto what a page renders. The only place field names live
src/markdown.ts      markdown to HTML, treating the input as untrusted
src/screens/*.tsx    factories that take config and return a page component
src/routes/*.ts      factories for the feed, sitemap, robots and the revalidate endpoint
src/styles.css       Signal tokens. A consumer may take the markup and none of this
app/                 the reference deployment: thin re-exports
```

The screens are in `src/screens`, not `src/pages`, because Next claims `pages` and `app` as router
directories and a `src/pages` inside a transpiled package is read as a second router.

## 3. The rules that came from being wrong

Each of these is here because it broke, not because it sounded right.

**Nothing reads `process.env` at module scope.** A value read there is baked into a prerender at
build time. Site identity did exactly that, so a client's masthead said "barakoPress" until
something revalidated it. Per-site values are literals in the consumer's `press.config.ts`; only
per-environment values (`CMS_URL`, `REVALIDATE_SECRET`) come from the environment, and neither is
rendered.

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
compared in constant time, timestamp refused outside the window, each signature honoured once.

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

When iterating locally, give each packed tarball a different name. npm caches a `file:` tarball by
path and version, so reinstalling the same name serves the old code, which once made a fixed bug
look unfixed.

## 7. Style

Follow the house style in the repository owner's global rules: plain, direct, short. No em dashes
anywhere, in code, comments, commits or docs. CI fails on one.

Comments earn their place by explaining a non-obvious why, an invariant the types cannot express,
or a decision that will look wrong later. Most of the comments in `src/` are the second kind.
