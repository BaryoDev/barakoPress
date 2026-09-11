# barakoPress

A blog on [barakoCMS](https://github.com/BaryoDev/barakoCMS). Server rendered, cached until the CMS
says otherwise, so ordinary traffic never reaches Postgres and a publish is live in one request.

```bash
cp .env.example .env      # point CMS_URL at your instance, set REVALIDATE_SECRET
npm install
npm run build && npm start
```

## The caching design, which is the whole point

A static site reads content at build time, so an edit is invisible until someone rebuilds and
redeploys. A naive dynamic site reads the database on every page view. This does neither.

```
request  ->  Next cache  ->  HTML                        (no database)
publish  ->  signed webhook  ->  revalidate  ->  next render reads once
```

Every read in `lib/delivery.ts` is tagged `cms`. `POST /api/revalidate` drops that tag the moment
barakoCMS says something changed, through a Webhook action on publish, so a publish is live in one
request and the steady state is no database reads.

Each read also carries a 300 second backstop. That is not for correctness, it is for the case where
somebody deploys and never creates the workflow: without it their blog would be empty forever and
nothing would say why. With it, a missing webhook degrades publishing from instant to a few minutes.

**The cache invalidation is configuration, not code.** In barakoBrew: a workflow on the `post`
content type, trigger `Published`, one Webhook action with the URL and a shared secret. Nothing is
deployed to change it.

## Wiring the webhook

1. Put a long random value in `REVALIDATE_SECRET`.
2. In barakoBrew, create a workflow: content type `post`, event `Published`.
3. Add a Webhook action with `Url` set to `https://your-site/api/revalidate` and `Secret` set to the
   same value.

barakoCMS refuses to sign a delivery to an `http://` URL unless `Webhooks:AllowInsecureSignedUrls`
is on, which is for a loopback receiver in a lab. In production the URL is https, so this is not in
your way.

Verification follows the recipe in the API's `docs/webhooks.md`: HMAC-SHA256 over
`"<timestamp>.<raw body>"`, compared in constant time, with a 300 second tolerance so a captured
delivery cannot be replayed later. An unsigned, missigned or stale delivery gets a 401. If
`REVALIDATE_SECRET` is unset the endpoint answers 503 and purges nothing, because an open
cache-purge endpoint is a free denial of service.

## Three behaviours that were measured, not assumed

**Next serves one stale response after a purge.** The first request after a publish gets the
previous render while the new one builds in the background. So the webhook requests the main pages
itself after purging, and this server takes that stale response instead of a reader. Verified: the
first request after a publish is fresh on the home page, the feed and the sitemap.

**`revalidateTag` needs `{ expire: 0 }`, not a named profile.** Next 16 made the second argument
mandatory. Passing `"max"` left the prerendered sitemap stale indefinitely. The sitemap also needs
its own `revalidatePath`, because a metadata route does not follow the data tag on its own.

**The home page and the sitemap are prerendered at build.** The image is built with no CMS
reachable, deliberately, so it is not tied to one instance. That means both ship baked empty, which
is what the backstop above rescues. Verified with a short window: no webhook was ever fired and the
page filled itself in.

## Why this does not use the published client

It should, and it is written to switch back. `@baryodev/barako-client@0.3.0` cannot express what a
blog needs: `PublicListQuery` is `{ page, pageSize }` with no `include`, `filter` or `sort`, and
`bySlug` takes no options so a preview token cannot be passed. All three are supported by the API.
`lib/delivery.ts` is the smallest thing that closes the gap, and it should shrink to a mapping layer
once the client can do this.

## What it reads

The `blog` blueprint that barakoCMS already ships: `post`, `category`, `author`, `page`. Apply it
with `POST /api/content-types/blueprints/blog`. Field names are PascalCase because that is what the
blueprint creates, and `lib/cms.ts` is the only file that knows them.

| Route | What |
| --- | --- |
| `/` | Published posts, featured first |
| `/blog/[slug]` | One post, with SEO, Open Graph and Twitter tags from the API's resolved `seo` block |
| `/blog/[slug]?preview=TOKEN` | A draft, uncached, from a token an editor minted with `POST /api/preview` |
| `/authors/[slug]`, `/categories/[slug]` | Archives |
| `/feed.xml`, `/sitemap.xml` | Built from the same cached read, so they cannot disagree with the site |

## Security

Markdown is rendered as untrusted input in `lib/markdown.ts`: raw HTML is escaped rather than passed
through, link and image destinations must be http, https or mailto, and text is escaped into every
attribute. An editor is authenticated, so this is the second line of defence, not the first. The
trade is that an author cannot embed raw HTML or an iframe.

## Deploying to a VM

The stack is Postgres, the API, the console, this site, and Caddy in front getting its own TLS
certificate. Caddy is there instead of nginx because it obtains and renews certificates itself,
which is the difference between a deploy command succeeding and having a website.

```bash
baryovm vm provision blog1                     # or bring your own VM
baryovm vm bootstrap blog1                     # installs Docker, and only Docker
baryovm vm harden blog1                        # sshd policy and fail2ban
baryovm stack add blog --vm blog1 --sudo --release-file ./baryovm.release.json
baryovm stack release blog
```

Before the first release, three DNS names have to point at the machine and a `.env` has to exist on
it at `/opt/barakopress/.env`. The release refuses to start without that file, and refuses again if
`REVALIDATE_SECRET` is empty, because a stack that comes up with no secret can never be told that
content changed.

| Name | Serves |
| --- | --- |
| `SITE_DOMAIN` | the blog |
| `API_DOMAIN` | the API, whose delivery endpoints are anonymous by design |
| `CONSOLE_DOMAIN` | barakoBrew |

Only ports 80 and 443 are published. The API, the console and the site are reachable only through
Caddy on the compose network.

### What is still manual

Creating the workflow that invalidates the cache. Until that exists in the console, a publish is
live within the backstop window rather than immediately. That is a degradation rather than a
breakage, which is the whole reason the backstop exists.

## Status

Early. The blog works end to end against a real instance. Known gaps, all tracked upstream:
no media picker, no rich editor, no site settings object, and a content type's fields cannot be
changed after it is created.
