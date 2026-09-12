# Releasing

barakoPress publishes to npm as [`barakopress`](https://www.npmjs.com/package/barakopress). Every
release after the first is a tag, and no token is stored anywhere.

```bash
# bump "version" in package.json, commit it, then
git tag v0.2.1
git push origin v0.2.1
```

`.github/workflows/release.yml` publishes it with npm trusted publishing: the runner proves who it is
over OIDC, npm checks the request came from this repository and this workflow file, and mints a
short-lived credential itself. Provenance is attached automatically, which is why there is no
`--provenance` flag in the workflow.

## One time, before any of that works

**0.2.0 is published.** It went out by hand on 12 September 2026 from `fb4640a`, for the reason
below, and the steps in this section are done. They are kept because they are the record of why the
first one was different, and because the trusted-publisher settings have to be re-entered if
`release.yml` is ever renamed.

One ordering point that cost a red run to learn, and is the reason `release.yml` now asks the
registry before uploading: the tag for a hand-published version has to be pushed *after* the publish,
and pushing it runs the whole workflow. The workflow handles that now. It runs every check, sees the
version is already on the registry, skips the upload and says so.

**The first publish cannot use trusted publishing.** npmjs.com only lets you attach a trusted
publisher to a package that already exists, and `barakopress` does not exist yet, so there is no
settings page to configure. That is a known npm limitation, tracked at
[npm/cli#8544](https://github.com/npm/cli/issues/8544) and still open. PyPI allows configuring a
publisher for a package that has never been released; npm does not, yet.

So, once:

**1. Publish the first version by hand.**

```bash
git checkout v0.2.0            # a clean checkout of the tag you mean to ship
npm ci
npm pack --dry-run             # read the file list before you send it
npm login                      # your account, on your machine
npm publish --access public
```

`prepare` builds `dist` for both of those commands, so there is no separate build step and no way to
ship a stale `dist`. Check the dry run lists `dist/index.js`, `dist/index.d.ts` and `src/styles.css`.

**2. Attach the trusted publisher.** On npmjs.com, open the package, then Settings, then Trusted
Publisher, and enter exactly:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `BaryoDev` |
| Repository | `barakoPress` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

The workflow filename is the file name alone, not a path. It has to match the workflow that
publishes, which is why renaming `release.yml` later means updating this setting too, and why a rename
without it fails at publish with an authorisation error rather than a missing-file error.

**3. Check `repository.url` in `package.json` still points at this repository.** npm matches it
against the repository the OIDC token came from.

After that, `npm logout` if you like. Nothing on any machine needs npm credentials again.

## What the workflow refuses to do

- publish from anything but a `v` tag push. A `workflow_dispatch` run does every check and stops
  before the publish, which makes it a rehearsal and not a second way to release
- publish when the tag and the `package.json` version disagree. The check and the publish carry the
  same `if`, so there is no path that publishes a version nothing compared against a tag
- publish when the package does not build, or builds without an entry point and declarations
- publish when an em dash or en dash is in anything that ships
- publish on an npm older than 11.5.1, which cannot do trusted publishing and would fall back to
  asking for a token that is not there. The workflow installs a pinned npm rather than `@latest`,
  because that job is the one holding `id-token: write`
- publish a version the registry already has. It checks before uploading, so a tag pushed for a
  hand-published version, and a re-run of a job that uploaded and then failed on a later step, both
  run every check and then stop at the upload instead of failing on something npm would refuse
  anyway. The run says the version is already on the registry rather than going green as though it
  published. It does not say which of the two it was, and cannot: a 200 is the only signal, and
  nothing in it distinguishes a hand publish from an upload an earlier run already made

The consumer test lives in `ci.yml` rather than here, because it needs a CMS and a content model: it
installs the packed tarball into a separate app with a deliberately non-blueprint model and asserts
the rendered site. A tag is only worth publishing if that job passed on the commit.

## Version numbers

This package's version is the number a client site pins, so it moves for anything a consumer can see.

- a new factory, a new config field, a new optional prop: minor
- a removed or renamed export, a changed factory signature, a config default that changes what an
  existing site renders, a raised peer floor: minor while this is 0.x, major after 1.0
- the shape of the published package itself (what `exports` points at, whether a consumer needs
  `transpilePackages`): minor at least, and say so in the release notes, because that is the part a
  consumer cannot discover from the types

0.2.0 is the first published version. 0.1.0 exists only as the tarball vendored into barakocms-site,
it was never on npm, and it pointed `exports` at TypeScript sources. Anyone depending on a file
tarball moves to the registry version and drops `transpilePackages`.
