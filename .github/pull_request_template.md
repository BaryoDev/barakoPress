<!-- Title format: Area: Description (closes #123) -->

<!-- The coding standard is CLAUDE.md. Opening this pull request means you agree to the
     contributor terms in CLA.md: your contribution ships under MIT, with a patent grant. -->

## What changed and why

<!-- What was wrong, and what this does about it. Link the issue. -->

Fixes #

## Which test fails without this change

<!-- Name the test. For a bug fix, either write it first and watch it fail, or revert the fix and
     confirm it goes red. For docs, build or dependency changes, write "not applicable". -->

## Checklist

- [ ] I have read the [contributor terms](https://github.com/BaryoDev/barakoPress/blob/master/CLA.md) and agree my contribution ships under them
- [ ] A test covers this, and I confirmed it fails without the change
- [ ] `npm run typecheck`, `npm test` and `npm run build` are clean
- [ ] If this touches what a consumer imports, a packed tarball builds in a separate app with no
      `transpilePackages` (CLAUDE.md section 6)
- [ ] No content-shape literal outside `src/config.ts`

## Anything reviewers should know

<!-- Trade-offs, things deliberately left out, follow-up issues filed. Leave blank if nothing. -->
