#!/usr/bin/env bash
# Tests that the wiki sync cuts the README by the listed headings, rewrites links to published docs
# into wiki links, refuses a stale list without touching the wiki, and that wiki-publish.sh exits
# zero only when it pushed or had nothing to push.
#
# No network. A throwaway source repository holds a copy of the two scripts, a small README and a
# small docs/, and a local bare repository named *.wiki.git stands in for the wiki.
#
#   bash scripts/test-wiki-sync.sh

set -uo pipefail

SCRIPTS=$(cd -- "$(dirname -- "$0")" && pwd)

# The developer's own git configuration must not decide the result.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GITHUB_STEP_SUMMARY

pass=0
fail=0
check() { # $1 = description, $2 = exit code of the condition
  if [ "$2" = 0 ]; then
    echo "  ok    $1"
    pass=$((pass + 1))
  else
    echo "  FAIL  $1"
    fail=$((fail + 1))
  fi
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

SRC="$WORK/source"
REMOTE="$WORK/remote/fixture.wiki.git"
WIKI="$WORK/wiki"
BLOB="https://github.com/BaryoDev/barakoPress/blob/master"

fixture_git() { git -c user.name=fixture -c user.email=fixture@example.invalid "$@"; }
remote_head() { git -C "$REMOTE" rev-parse --verify --quiet refs/heads/master; }
publish() {
  WIKI_COMMIT_NAME="wiki bot" WIKI_COMMIT_EMAIL="wiki-bot@example.invalid" \
    bash "$SRC/scripts/wiki-publish.sh" "$WIKI" >"$WORK/out" 2>&1
}
sync() { bash "$SRC/scripts/wiki-sync.sh" "$WIKI" >"$WORK/out" 2>&1; }
fresh_clone() { rm -rf "$WIKI"; git clone --quiet "$REMOTE" "$WIKI"; }
commit_source() { fixture_git -C "$SRC" add -A && fixture_git -C "$SRC" commit --quiet -m "$1"; }

# ---------------------------------------------------------------- fixture

mkdir -p "$SRC/scripts" "$SRC/docs" "$WORK/remote"
cp "$SCRIPTS/wiki-sync.sh" "$SCRIPTS/wiki-publish.sh" "$SRC/scripts/"
cat >"$SRC/README.md" <<EOF
# barakoPress

The intro, which Home covers.

## Install

Run \`npm install barakopress\`. See [Caching]($BLOB/docs/caching.md#one-secret).

## Deploying

The short version. The long one is [Deploying]($BLOB/docs/deploying.md).

\`\`\`md
## Not a heading, it is in a fence
\`\`\`

### A subsection stays with its section

Written as \`[links](/docs)\` in a code span.

## Unlisted

Not published.
EOF
printf '# Caching and the webhook\n\n## One secret\n\nSee [deploying](deploying.md) and [the script](../scripts/wiki-sync.sh).\n' >"$SRC/docs/caching.md"
printf '# Deploying\n\nThe long version.\n' >"$SRC/docs/deploying.md"
printf '# Review rules\n\nFor the review agent.\n' >"$SRC/docs/review-rules.md"
printf 'review-rules.md\n' >"$SRC/docs/.wikiignore"
printf '# comment\ninstall Install\ndeploying-in-brief Deploying\n' >"$SRC/docs/.wikisections"
git init --quiet --initial-branch=master "$SRC"
commit_source "source fixture"

git init --quiet --bare --initial-branch=master "$REMOTE"
git clone --quiet "$REMOTE" "$WORK/seed" 2>/dev/null
printf '# Home\n\nWritten by hand.\n' >"$WORK/seed/Home.md"
fixture_git -C "$WORK/seed" add -A
fixture_git -C "$WORK/seed" commit --quiet -m "first page"
git -C "$WORK/seed" push --quiet origin HEAD:refs/heads/master
SEEDED=$(remote_head)

# ---------------------------------------------------------------- cases

echo "== the README is cut by the listed headings =="
fresh_clone
sync; check "the sync exits zero" $?
for page in install.md deploying-in-brief.md caching.md deploying.md Docs.md _Sidebar.md; do
  [ -f "$WIKI/$page" ]; check "it writes $page" $?
done
[ ! -e "$WIKI/review-rules.md" ]; check "a doc in .wikiignore is withheld" $?
[ ! -e "$WIKI/unlisted.md" ] && ! grep -rq 'Not published' "$WIKI"; check "an unlisted README section is not published" $?
grep -q 'README heading "Unlisted" is not in docs/.wikisections' "$WORK/out"; check "an unlisted README heading is named" $?
[ "$(head -1 "$WIKI/install.md")" = "# Install" ]; check "the section heading becomes the page title" $?
! grep -q 'The intro' "$WIKI/install.md"; check "the text above the first section is not in it" $?
! grep -q 'The short version' "$WIKI/install.md"; check "a section stops at the next level-two heading" $?
grep -q '^## Not a heading, it is in a fence$' "$WIKI/deploying-in-brief.md"; check "a fenced heading does not cut the section" $?
grep -q '^### A subsection stays with its section$' "$WIKI/deploying-in-brief.md"; check "a level-three heading stays in its section" $?
grep -qF '[Caching](caching#one-secret)' "$WIKI/install.md"; check "a blob link to a published doc becomes a wiki link" $?
grep -qF '[Deploying](deploying)' "$WIKI/deploying-in-brief.md"; check "a section named apart from a doc links to that doc" $?
grep -qF '`[links](/docs)`' "$WIKI/deploying-in-brief.md"; check "a link inside a code span is left alone" $?
grep -qF '[deploying](deploying)' "$WIKI/caching.md"; check "a relative link between docs becomes a wiki link" $?
grep -qF "[the script]($BLOB/scripts/wiki-sync.sh)" "$WIKI/caching.md"; check "a link to another repository file becomes a blob URL" $?
grep -qF -- '- [Deploying](deploying-in-brief)' "$WIKI/_Sidebar.md"; check "the sidebar lists a README section" $?
grep -qF -- '- [Caching and the webhook](caching)' "$WIKI/_Sidebar.md"; check "the sidebar lists a doc" $?
[ "$(git -C "$WIKI" show HEAD:Home.md)" = "$(cat "$WIKI/Home.md")" ]; check "Home is untouched" $?

echo "== a heading renamed in the README and not in the list fails, and leaves the wiki alone =="
sed -i 's/^## Install$/## Installing/' "$SRC/README.md"
commit_source "rename a heading"
fresh_clone
sync; status=$?
[ "$status" != 0 ]; check "the sync exits non-zero" $?
grep -q 'names the README heading "Install", which is not a level-two heading' "$WORK/out"; check "it names the stale heading" $?
[ -z "$(git -C "$WIKI" status --porcelain)" ]; check "the wiki clone is untouched" $?
sed -i 's/^## Installing$/## Install/' "$SRC/README.md"
commit_source "rename it back"

echo "== a section page named like a doc fails =="
printf 'deploying Deploying\n' >"$SRC/docs/.wikisections"
commit_source "collide"
fresh_clone
sync; status=$?
[ "$status" != 0 ]; check "the sync exits non-zero" $?
grep -q 'which docs/deploying.md already publishes' "$WORK/out"; check "it names the collision" $?
printf 'install Install\ndeploying-in-brief Deploying\n' >"$SRC/docs/.wikisections"
commit_source "uncollide"

echo "== a first publish commits and pushes =="
fresh_clone
SOURCE_SHA=$(git -C "$SRC" rev-parse HEAD)
publish; check "it exits zero" $?
PUSHED=$(remote_head)
[ -n "$PUSHED" ] && [ "$PUSHED" != "$SEEDED" ]; check "the wiki moved to a new commit" $?
[ "$(git -C "$REMOTE" log -1 --format=%B master)" = "sync docs from BaryoDev/barakoPress@$SOURCE_SHA" ]
check "the message names the source commit" $?
git -C "$REMOTE" show master:install.md | grep -q '^# Install$'; check "the pushed tree has the README section" $?

echo "== a second run with nothing changed pushes nothing =="
fresh_clone
publish; check "it exits zero" $?
[ "$(remote_head)" = "$PUSHED" ]; check "the wiki did not move" $?
grep -q '^wiki-publish: nothing to publish' "$WORK/out"; check "it says there was nothing to publish" $?

echo "== a README change is published, and a dropped section is removed =="
sed -i 's/The short version\./The short version, edited./' "$SRC/README.md"
printf 'deploying-in-brief Deploying\n' >"$SRC/docs/.wikisections"
commit_source "edit a section and drop one"
fresh_clone
publish; check "it exits zero" $?
git -C "$REMOTE" show master:deploying-in-brief.md | grep -q 'The short version, edited\.'; check "the page holds the new text" $?
! git -C "$REMOTE" ls-tree --name-only master | grep -qxF install.md; check "the dropped section's page is gone" $?

echo "== a page someone else wrote is not overwritten =="
printf 'install Install\ndeploying-in-brief Deploying\n' >"$SRC/docs/.wikisections"
commit_source "list it again"
fresh_clone
printf '# Install\n\nWritten on the web.\n' >"$WIKI/install.md"
fixture_git -C "$WIKI" add -A && fixture_git -C "$WIKI" commit --quiet -m "a hand page"
git -C "$WIKI" push --quiet origin HEAD:refs/heads/master
BEFORE=$(remote_head)
fresh_clone
publish; status=$?
[ "$status" != 0 ]; check "it exits non-zero" $?
grep -q 'refusing to overwrite: install.md' "$WORK/out"; check "it names the page" $?
[ "$(remote_head)" = "$BEFORE" ]; check "the wiki did not move" $?

echo
echo "$pass passed, $fail failed"
[ "$pass" -gt 0 ] && [ "$fail" -eq 0 ]
