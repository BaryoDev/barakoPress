# Contributing to barakoPress

barakoPress is the renderer for [barakoCMS](https://github.com/BaryoDev/barakoCMS) sites. Bugs in
the API belong over there, and bugs in the console belong in
[barakoBrew](https://github.com/BaryoDev/barakoBrew). Anything a visitor sees on a rendered site
belongs here.

## The coding standard

**The coding standard is [`CLAUDE.md`](CLAUDE.md)**, and `AGENTS.md` points at it. Read it before
you write code. It covers the one line the engine must not cross (no content-shape literal outside
`src/config.ts`), the build, the rules that came from being wrong, and how a change is tested.

## Contributor terms

There is nothing to sign. Opening a pull request means you agree to the
[contributor terms](CLA.md), which are short and in plain English.

The gist: your contribution ships under MIT, you keep your copyright, and you grant a patent
licence, since MIT has none. A release containing your work is always MIT or MPL-2.0, never closed.

## AI agents

Contributions generated with AI agents are welcome. Point the agent at `CLAUDE.md`, and say in the
pull request that the code was AI-generated. It helps review.

## These projects do not pay for work

Contributions here are voluntary and unpaid. There is no budget, no bounty programme, and no
commissioning of work on issues. If you are looking for paid work, this is not the place, and you
should know that before you spend a weekend on something.

## Before you file an issue

Check it does not already exist, and say where you looked. An issue claiming something is missing
should name the file or the search that showed it missing: `git grep` for the thing, and put what
you searched for in the issue.

For anything large, a new screen, a new route factory, or a change to what a consumer imports, open
an issue first, so nobody spends a weekend on something that then has to be turned down.

## Pull requests

1. Fork the repository and branch from `master`.
2. Name the branch `{type}/{issue}-{short-description}`, where type is one of `feature`,
   `bugfix`, `improvement`, `qa` or `chore`.
3. Add tests for what you changed. A bug fix ships with a test that failed before the fix: write it
   first and watch it fail, or revert your change and confirm it goes red.
4. Run what CI runs: `npm run typecheck`, `npm test` and `npm run build`. If the change touches
   what a consumer imports, also do the consumer checks in `CLAUDE.md` section 6: pack the tarball,
   install it into a separate app with no `transpilePackages`, and build it.
5. Title the pull request `Area: Description (closes #123)` and put `Fixes #123` on its own line in
   the body. GitHub only auto-closes from the body.

No em dashes or en dashes anywhere, in code, comments, commits or docs. CI fails on one.

## Licence

barakoPress is released under [MIT](LICENSE), and your contribution ships under it. The
[contributor terms](CLA.md) bound any future release to MIT or MPL-2.0 and carry an explicit patent
grant.
