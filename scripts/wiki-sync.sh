#!/usr/bin/env bash
#
# Publish the README, cut by heading, and docs/*.md into the GitHub wiki as flat pages.
#
#   scripts/wiki-sync.sh <wiki-working-copy>
#
# This script never commits and never pushes. It edits the working copy only, so the result can be
# read before it goes anywhere:
#
#   git clone https://github.com/BaryoDev/barakoPress.wiki.git /tmp/wiki
#   scripts/wiki-sync.sh /tmp/wiki
#   git -C /tmp/wiki status --short
#
# scripts/wiki-publish.sh runs this, then commits and pushes. .github/workflows/wiki-sync.yml runs
# that on every push to master that touches the README or docs/. It is a port of barakoCMS's
# scripts/wiki-sync.sh, with the README as a second source of pages.
#
# The page set
#   README sections. docs/.wikisections lists them, one per line: a page name, a space, and the
#   text of a level-two README heading. The page holds that heading and everything under it up to
#   the next level-two heading, in the order the list gives. The list is a file rather than "every
#   heading" because a README heading and a doc can want the same page name (Deploying and
#   docs/deploying.md), and a name chosen in review is better than one invented here. A listed
#   heading that is not in the README fails the sync, so a renamed heading cannot quietly drop a
#   page. A README heading that is not listed is named on stderr and left out.
#
#   Docs. Every top-level docs/*.md that git tracks, minus the names in docs/.wikiignore. The page
#   name is the file name: docs/caching.md becomes the page caching.md, linked as (caching). A
#   file that is ignored or not yet added is named on stderr and left out, so a working note on a
#   developer's box cannot reach a public wiki.
#
# Links
#   A link to a published doc, written relative (caching.md#one-secret) or as this repository's
#   blob URL on master, which is how the README writes them so they work on npm, becomes a wiki
#   page link (caching#one-secret). Any other relative link becomes a blob or tree URL on master.
#   Text inside code, fenced or inline, is left alone. A relative link whose target is not in the
#   repository fails the sync.
#
# Generated pages
#   Docs.md and _Sidebar.md are generated here on every run and carry a line saying so. Do not
#   hand edit them. Home.md is written by hand and is never touched.
#
# Provenance, so a sync never deletes someone else's page
#   Every page this script writes is recorded in .wiki-sync-manifest in the wiki root. On the next
#   run, a page in the old manifest that is no longer generated is deleted, and anything not in
#   that manifest is left alone. A page this run would write that already exists and is not in the
#   old manifest belongs to someone else, so the script stops and names it. Only the first sync,
#   with no manifest at all, skips that check.
#
# Target check
#   The argument must be the top level of a git repository whose origin URL ends in .wiki.git or
#   .wiki, with Home.md present. A mistyped path is refused rather than populated.
#
# Failure behaviour
#   Pages are built and link checked in a staging directory. The wiki working copy is not touched
#   until every page is built and every link resolves.

set -euo pipefail

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DOCS_DIR="$REPO_ROOT/docs"
README="$REPO_ROOT/README.md"
BLOB_BASE="https://github.com/BaryoDev/barakoPress/blob/master"
TREE_BASE="https://github.com/BaryoDev/barakoPress/tree/master"
MANIFEST_NAME=".wiki-sync-manifest"
SCRIPT_REF="scripts/wiki-sync.sh"

die() { printf 'wiki-sync: %s\n' "$*" >&2; exit 1; }
say() { printf 'wiki-sync: %s\n' "$*"; }
note() { printf '%s\n' "$*"; }

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'
}

is_protected() {
  case "$1" in
    Home.md) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------- arguments

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "")        usage >&2; die "expected one argument, the wiki working copy (got none)" ;;
esac
[ "$#" -eq 1 ] || die "expected one argument, the wiki working copy (got $#)"

WIKI=$1
[ -d "$WIKI" ] || die "not a directory: $WIKI"
WIKI=$(cd -- "$WIKI" && pwd -P)

wiki_not_proven() {
  die "$WIKI is not the wiki clone ($1).
Checked: top level of a git repository, origin remote URL ending in .wiki.git or .wiki, Home.md present.
Clone the wiki first: git clone https://github.com/BaryoDev/barakoPress.wiki.git"
}
WIKI_TOP=$(git -C "$WIKI" rev-parse --show-toplevel 2>/dev/null) \
  || wiki_not_proven "not a git repository"
WIKI_TOP=$(cd -- "$WIKI_TOP" && pwd -P)
[ "$WIKI_TOP" = "$WIKI" ] \
  || wiki_not_proven "a subdirectory of the git repository at $WIKI_TOP, not its top level"
WIKI_ORIGIN=$(git -C "$WIKI" remote get-url origin 2>/dev/null) \
  || wiki_not_proven "git repository with no origin remote"
case "$WIKI_ORIGIN" in
  *.wiki.git|*.wiki) ;;
  *) wiki_not_proven "origin remote is $WIKI_ORIGIN, which ends in neither .wiki.git nor .wiki" ;;
esac
[ -f "$WIKI/Home.md" ] || wiki_not_proven "no Home.md, so this is not a populated wiki clone"
[ -f "$README" ] || die "no README at $README"

TRACKED_LIST=$(git -C "$REPO_ROOT" -c core.quotepath=false ls-files -- README.md ':(glob)docs/*.md' 2>/dev/null) \
  || die "$REPO_ROOT is not a git checkout, so the tracked docs cannot be listed"
is_tracked() { printf '%s\n' "$TRACKED_LIST" | grep -qxF -- "$1"; }
is_tracked README.md || die "README.md is not tracked by git"

STAGING=$(mktemp -d "${TMPDIR:-/tmp}/wiki-sync.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT

# ---------------------------------------------------------------- README sections

SECTIONS_FILE="$DOCS_DIR/.wikisections"
[ -f "$SECTIONS_FILE" ] || die "no $SECTIONS_FILE, so there is no list of README sections to publish"

# Level-two headings outside fences, in README order.
README_HEADINGS=$(awk '
  /^[ \t]*(```|~~~)/ { fenced = !fenced; next }
  fenced             { next }
  /^## /             { sub(/^## /, ""); sub(/[ \t]+$/, ""); print }
' "$README")

SECTION_PAGES=()
declare -A SECTION_HEADING=()
LISTED_HEADINGS=""
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ -n "$line" ] || continue
  name="${line%% *}"
  heading="${line#* }"
  [ "$name" != "$line" ] || die "$SECTIONS_FILE has a line with no heading: $line"
  case "$name" in
    *[!a-z0-9-]*|-*|'') die "$SECTIONS_FILE: page name $name must be lower case letters, digits and dashes" ;;
  esac
  printf '%s\n' "$README_HEADINGS" | grep -qxF -- "$heading" \
    || die "$SECTIONS_FILE names the README heading \"$heading\", which is not a level-two heading in README.md. Fix the list."
  for seen in "${SECTION_PAGES[@]+"${SECTION_PAGES[@]}"}"; do
    [ "$seen" != "$name.md" ] || die "$SECTIONS_FILE names the page $name twice"
  done
  SECTION_PAGES+=("$name.md")
  SECTION_HEADING["$name.md"]=$heading
  LISTED_HEADINGS="$LISTED_HEADINGS$heading"$'\n'
done <"$SECTIONS_FILE"
[ "${#SECTION_PAGES[@]}" -gt 0 ] || die "$SECTIONS_FILE lists no sections"

while IFS= read -r heading; do
  [ -n "$heading" ] || continue
  printf '%s' "$LISTED_HEADINGS" | grep -qxF -- "$heading" \
    || note "wiki-sync: the README heading \"$heading\" is not in docs/.wikisections, so it is not published" >&2
done <<<"$README_HEADINGS"

# ---------------------------------------------------------------- docs pages

IGNORE_FILE="$DOCS_DIR/.wikiignore"
EXCLUDED=()
if [ -f "$IGNORE_FILE" ]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [ -n "$line" ] || continue
    [ -f "$DOCS_DIR/$line" ] || die "$IGNORE_FILE names $line, which is not in $DOCS_DIR. Fix the list."
    EXCLUDED+=("$line")
  done <"$IGNORE_FILE"
fi
is_excluded() {
  local candidate="$1" e
  for e in "${EXCLUDED[@]+"${EXCLUDED[@]}"}"; do [ "$e" = "$candidate" ] && return 0; done
  return 1
}

DOC_PAGES=()
SKIPPED=()
if [ -d "$DOCS_DIR" ]; then
  while IFS= read -r path; do
    base="$(basename -- "$path")"
    if ! is_tracked "docs/$base"; then
      note "wiki-sync: docs/$base is not tracked by git, so it is not published" >&2
    elif is_excluded "$base"; then
      SKIPPED+=("$base")
    else
      DOC_PAGES+=("$base")
    fi
  done < <(find "$DOCS_DIR" -maxdepth 1 -name '*.md' -type f | sort)
fi
[ "${#SKIPPED[@]}" -eq 0 ] || say "withheld by $(basename -- "$IGNORE_FILE"): ${SKIPPED[*]}"

for page in "${DOC_PAGES[@]+"${DOC_PAGES[@]}"}"; do
  case "$page" in
    *[[:space:]]*) die "docs/$page has whitespace in its file name, so it cannot be linked as a wiki page. Rename it with dashes." ;;
  esac
  for section in "${SECTION_PAGES[@]}"; do
    [ "$section" != "$page" ] \
      || die "docs/.wikisections names the page ${page%.md}, which docs/$page already publishes. Pick another name."
  done
done

PAGES=("${SECTION_PAGES[@]}" "${DOC_PAGES[@]+"${DOC_PAGES[@]}"}")
for page in "${PAGES[@]}"; do
  is_protected "$page" && die "$page would overwrite the protected wiki page"
  case "$page" in Docs.md|_Sidebar.md) die "$page is generated by this script and cannot also be a source page" ;; esac
done
PAGES+=("Docs.md" "_Sidebar.md")

# ---------------------------------------------------------------- link rewriting

REWRITER="$STAGING/.rewrite-links.pl"
cat >"$REWRITER" <<'PERL'
#!/usr/bin/perl
# Rewrite markdown link targets in one page for the wiki. stdin to stdout.
use strict;
use warnings;

my $repo  = $ENV{WS_REPO_ROOT};
my $blob  = $ENV{WS_BLOB_BASE};
my $tree  = $ENV{WS_TREE_BASE};
my $src   = $ENV{WS_SRC};
my $base  = $ENV{WS_BASE_DIR};
my %page  = map { $_ => 1 } split ' ', $ENV{WS_PAGES};
my $errors = 0;

sub normalise {
    my ($path) = @_;
    my @out;
    for my $seg (split m{/}, $path) {
        next if $seg eq '' or $seg eq '.';
        if ($seg eq '..') {
            return undef unless @out;
            pop @out;
            next;
        }
        push @out, $seg;
    }
    return join '/', @out;
}

sub as_page {
    my ($rel, $frag) = @_;
    if ($rel =~ m{^docs/([^/]+\.md)$} and $page{$1}) {
        (my $name = $1) =~ s{\.md$}{};
        return $name . $frag;
    }
    return undef;
}

sub rewrite {
    my ($target) = @_;

    if (index($target, "$blob/") == 0) {
        my ($path, $frag) = split /\#/, substr($target, length("$blob/")), 2;
        $frag = defined $frag ? "#$frag" : '';
        my $wiki = as_page($path, $frag);
        return defined $wiki ? $wiki : $target;
    }
    return $target if $target =~ m{^[A-Za-z][A-Za-z0-9+.\-]*:};
    return $target if $target =~ m{^//};
    return $target if $target =~ m{^\#};

    my ($path, $frag) = split /\#/, $target, 2;
    $frag = defined $frag ? "#$frag" : '';

    my $rel = normalise($base eq '' ? $path : "$base/$path");
    if (!defined $rel or $rel eq '') {
        warn "  $src: link escapes the repository root ($target)\n";
        $errors++;
        return $target;
    }
    my $wiki = as_page($rel, $frag);
    return $wiki if defined $wiki;
    return "$tree/$rel$frag" if -d "$repo/$rel";
    return "$blob/$rel$frag" if -f "$repo/$rel";

    warn "  $src: link target does not exist in the repository ($target -> $rel)\n";
    $errors++;
    return $target;
}

sub rewrite_text {
    my ($text) = @_;
    $text =~ s{\]\(([^()\s]+)(\s+"[^"]*")?\)}{ '](' . rewrite($1) . (defined $2 ? $2 : '') . ')' }ge;
    return $text;
}

my $fenced = 0;
while (my $line = <STDIN>) {
    if ($line =~ m{^[ \t]*(```|~~~)}) { $fenced = !$fenced; print $line; next; }
    if ($fenced)                       { print $line; next; }
    # Code spans are copied as they are: a run of backticks opens one, and the next run of the
    # same length closes it. Only the text between spans is rewritten.
    my $out = '';
    while ($line =~ m{\G(.*?)(`+)}gcs) {
        my ($text, $ticks) = ($1, $2);
        $out .= rewrite_text($text) . $ticks;
        if ($line =~ m{\G(.*?(?<!`)\Q$ticks\E(?!`))}gcs) {
            $out .= $1;
        }
    }
    $out .= rewrite_text(substr($line, pos($line) // 0));
    print $out;
}

exit($errors ? 3 : 0);
PERL

# The same span rule as the rewriter, for the link check below, so a link-shaped example inside
# backticks is neither rewritten nor counted.
STRIP_CODE="$STAGING/.strip-code.pl"
cat >"$STRIP_CODE" <<'PERL'
#!/usr/bin/perl
use strict;
use warnings;
my $fenced = 0;
while (my $line = <STDIN>) {
    if ($line =~ m{^[ \t]*(```|~~~)}) { $fenced = !$fenced; print "\n"; next; }
    if ($fenced)                       { print "\n"; next; }
    $line =~ s{(`+).*?(?<!`)\1(?!`)}{}g;
    print $line;
}
PERL

export WS_REPO_ROOT="$REPO_ROOT" WS_BLOB_BASE="$BLOB_BASE" WS_TREE_BASE="$TREE_BASE"
export WS_PAGES="${PAGES[*]}"

declare -A TITLE=()
build_failed=0

footer() { # $1 = source description, $2 = blob path
  printf '\n---\n\n'
  printf 'Generated from [%s](%s/%s) by `%s`. Edit the repository, not this page.\n' \
    "$1" "$BLOB_BASE" "$2" "$SCRIPT_REF"
}

# ---------------------------------------------------------------- build pages

for page in "${SECTION_PAGES[@]}"; do
  heading=${SECTION_HEADING[$page]}
  TITLE["$page"]=$heading
  # The section, with its level-two heading raised to the page title.
  awk -v want="$heading" '
    /^[ \t]*(```|~~~)/ { fenced = !fenced }
    !fenced && /^## / {
      h = $0; sub(/^## /, "", h); sub(/[ \t]+$/, "", h)
      if (inside) exit
      if (h == want) { inside = 1; print "# " h; next }
    }
    inside { print }
  ' "$README" >"$STAGING/.section"
  if WS_SRC="README.md ($heading)" WS_BASE_DIR="" perl "$REWRITER" <"$STAGING/.section" >"$STAGING/$page"; then
    :
  else
    note "wiki-sync: unresolved links in the README section \"$heading\""
    build_failed=1
  fi
  footer "the README" "README.md" >>"$STAGING/$page"
done

for page in "${DOC_PAGES[@]+"${DOC_PAGES[@]}"}"; do
  src="$DOCS_DIR/$page"
  heading=$(awk '
    /^[ \t]*(```|~~~)/ { fenced = !fenced; next }
    fenced             { next }
    /^# /              { sub(/^# /, ""); print; exit }
  ' "$src")
  [ -n "$heading" ] || die "docs/$page has no level-one heading to take a title from"
  TITLE["$page"]=$heading
  if WS_SRC="docs/$page" WS_BASE_DIR="docs" perl "$REWRITER" <"$src" >"$STAGING/$page"; then
    :
  else
    note "wiki-sync: unresolved links in docs/$page"
    build_failed=1
  fi
  footer "\`docs/$page\`" "docs/$page" >>"$STAGING/$page"
done

[ "$build_failed" -eq 0 ] || die "link rewriting failed, the wiki was not touched"

# ---------------------------------------------------------------- Docs.md and _Sidebar.md

list_pages() { # $1 = sidebar (1) or index (0), then the pages
  local sidebar=$1 page text
  shift
  for page in "$@"; do
    text=${TITLE[$page]}
    # Sidebar text is the title up to the first comma or colon, to keep the column narrow.
    if [ "$sidebar" = 1 ]; then text=${text%%,*}; text=${text%%:*}; fi
    printf -- '- [%s](%s)\n' "$text" "${page%.md}"
  done
}

{
  printf '# Docs\n\n'
  printf '<!-- Generated by %s. Do not edit this page. -->\n' "$SCRIPT_REF"
  printf 'Generated by `%s` from the [README](%s/README.md) and [`docs/`](%s/docs) on master. Hand edits are overwritten on the next sync.\n\n' \
    "$SCRIPT_REF" "$BLOB_BASE" "$TREE_BASE"
  printf '## From the README\n\n'
  list_pages 0 "${SECTION_PAGES[@]}"
  if [ "${#DOC_PAGES[@]}" -gt 0 ]; then
    printf '\n## Guides\n\n'
    list_pages 0 "${DOC_PAGES[@]}"
  fi
} >"$STAGING/Docs.md"

{
  printf '### barakoPress\n\n'
  printf '<!-- Generated by %s. Do not edit this page. -->\n\n' "$SCRIPT_REF"
  printf -- '- [Home](Home)\n'
  printf -- '- [All docs](Docs)\n\n'
  printf '**From the README**\n\n'
  list_pages 1 "${SECTION_PAGES[@]}"
  if [ "${#DOC_PAGES[@]}" -gt 0 ]; then
    printf '\n**Guides**\n\n'
    list_pages 1 "${DOC_PAGES[@]}"
  fi
} >"$STAGING/_Sidebar.md"

# ---------------------------------------------------------------- plan the apply

OLD_MANIFEST=()
if [ -f "$WIKI/$MANIFEST_NAME" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    OLD_MANIFEST+=("$line")
  done <"$WIKI/$MANIFEST_NAME"
fi

in_pages() {
  local needle=$1 page
  for page in "${PAGES[@]}"; do [ "$page" = "$needle" ] && return 0; done
  return 1
}
in_old_manifest() {
  local needle=$1 page
  for page in "${OLD_MANIFEST[@]+"${OLD_MANIFEST[@]}"}"; do [ "$page" = "$needle" ] && return 0; done
  return 1
}

if [ -f "$WIKI/$MANIFEST_NAME" ]; then
  FOREIGN=()
  for page in "${PAGES[@]}"; do
    [ -e "$WIKI/$page" ] || continue
    in_old_manifest "$page" || FOREIGN+=("$page")
  done
  [ "${#FOREIGN[@]}" -eq 0 ] \
    || die "these pages exist in the wiki and were not written by an earlier sync, refusing to overwrite: ${FOREIGN[*]}
Rename the source, or rename the wiki page. The wiki was not touched."
fi

TO_DELETE=()
for page in "${OLD_MANIFEST[@]+"${OLD_MANIFEST[@]}"}"; do
  is_protected "$page" && die "$MANIFEST_NAME lists the protected page $page, refusing to sync"
  case "$page" in */*|..|.) die "$MANIFEST_NAME has a suspicious entry ($page), refusing to sync" ;; esac
  in_pages "$page" && continue
  [ -e "$WIKI/$page" ] || continue
  TO_DELETE+=("$page")
done

# ---------------------------------------------------------------- link check

FINAL_PAGES="$STAGING/.final-pages"
{
  printf '%s\n' "${PAGES[@]}"
  for path in "$WIKI"/*.md; do
    [ -e "$path" ] || continue
    printf '%s\n' "$(basename -- "$path")"
  done
} | sort -u >"$FINAL_PAGES"
if [ "${#TO_DELETE[@]}" -gt 0 ]; then
  grep -vxF -f <(printf '%s\n' "${TO_DELETE[@]}") "$FINAL_PAGES" >"$FINAL_PAGES.keep" || true
  mv "$FINAL_PAGES.keep" "$FINAL_PAGES"
fi

LINKS="$STAGING/.links"
: >"$LINKS"
for path in "$STAGING"/*.md; do
  perl "$STRIP_CODE" <"$path" | awk -v file="$(basename -- "$path")" '
    {
      line = $0
      while (match(line, /\]\([^()]*\)/)) {
        print file "\t" substr(line, RSTART + 2, RLENGTH - 3)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' >>"$LINKS"
done

total=0; absolute=0; anchors=0; internal=0; broken=0
while IFS=$'\t' read -r file target; do
  total=$((total + 1))
  case "$target" in
    [A-Za-z]*:*|//*) absolute=$((absolute + 1)); continue ;;
    '#'*)            anchors=$((anchors + 1)); continue ;;
  esac
  name=${target%%#*}
  name=${name%% *}
  if grep -qxF "$name.md" "$FINAL_PAGES"; then
    internal=$((internal + 1))
  else
    broken=$((broken + 1))
    note "wiki-sync: $file links to ($target) but no page $name.md will exist" >&2
  fi
done <"$LINKS"

note "wiki-sync: ${#PAGES[@]} pages, $total links ($absolute absolute, $internal wiki pages, $anchors in-page anchors, $broken broken)"
[ "$broken" -eq 0 ] || die "$broken broken links, the wiki was not touched"

# ---------------------------------------------------------------- apply

for page in "${TO_DELETE[@]+"${TO_DELETE[@]}"}"; do
  rm -f -- "$WIKI/$page"
  note "wiki-sync: removed $page (its source is gone)"
done

for page in "${PAGES[@]}"; do
  cp -- "$STAGING/$page" "$WIKI/$page"
done

{
  printf '# Pages written by %s. Deleting a line here orphans that page.\n' "$SCRIPT_REF"
  printf '%s\n' "${PAGES[@]}" | sort
} >"$WIKI/$MANIFEST_NAME"

note "wiki-sync: synced into $WIKI"
note "wiki-sync: nothing is committed or pushed here. Review with 'git -C $WIKI status --short'; scripts/wiki-publish.sh commits and pushes."
