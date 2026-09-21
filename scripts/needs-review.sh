#!/usr/bin/env bash
# Prints one line per review-worthy rule the current diff against origin/master fires.
#
# Advisory, never a gate: it always exits 0 and prints nothing on a diff that fires no rule. A rule
# firing means a reviewer should look closely at that file, not that anything is wrong.
#
# Every rule below was derived from a defect that actually reached review in this repository, not
# from a list of things that sound risky. The counts in the comments are from one day in September
# 2026 across four pull requests. When a rule stops firing on anything real for several batches,
# delete it; when a reviewer keeps finding the same thing and no rule names it, add one.
#
# Untracked files are folded in as new files, because a rule that only reads committed changes
# misses the file an agent has written and not yet added. That also means running this in a
# checkout full of other work walks all of it, so run it in a clean copy of the branch.
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

merge_base=$(git merge-base origin/master HEAD 2>/dev/null) || merge_base=""
if [ -z "$merge_base" ]; then
  echo "needs-review: no merge base with origin/master found; nothing to check"
  exit 0
fi

tracked=$(git diff "$merge_base" -- . 2>/dev/null || true)
untracked=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  untracked="$untracked
$(git diff --no-index -- /dev/null "$f" 2>/dev/null || true)"
done < <(git ls-files --others --exclude-standard 2>/dev/null)

diff_file=$(mktemp)
trap 'rm -f "$diff_file"' EXIT
printf '%s\n%s\n' "$tracked" "$untracked" > "$diff_file"

# The diff goes through a file, not a pipe. `python3 - <<EOF` reads the program from stdin, so a
# pipe into it is swallowed by the heredoc and sys.stdin.read() returns the program or nothing.
# The first version of this script did exactly that and reported nothing on every diff, which is
# the failure mode this whole script exists to look for.
python3 - "$diff_file" <<'INNER'
import re, sys, os

diff = open(sys.argv[1], encoding='utf-8', errors='replace').read()

added = {}
path = None
for line in diff.splitlines():
    if line.startswith('+++ b/'):
        path = line[6:]
        added.setdefault(path, [])
    elif line.startswith('+') and not line.startswith('+++') and path:
        added[path].append(line[1:])

# This file holds every pattern below as literal text, so it matches itself on any diff that
# touches it. A rule that always fires teaches people to skip the output.
SKIP = ('node_modules/', 'dist/', '.next/', 'scripts/needs-review.sh')
paths = [p for p in added if not any(s in p for s in SKIP)]

hits = {}
def hit(rule, p): hits.setdefault(rule, set()).add(p)

# Four findings in one day came from regular expressions walking markup, CSS or a URL: an end tag
# written with a space, a single pass that closes up what it removes, a pattern that took 4.6
# seconds to not match, and a replacement string where $' spliced in the rest of the document.
markup_re = re.compile(r'(replace|replaceAll|match|exec|test)\s*\(\s*/|new RegExp\(')
markupish = re.compile(r'<\s*\w|</|url\s*\(|style|href|src', re.I)

# Three findings, on two separate changes: a limit clamped on one code path and not the other, and
# a budget that silently followed another number up. A constant that bounds something is read in
# more than one place almost by definition.
limit_re = re.compile(r'\b(MAX_[A-Z_]+|[A-Z_]*LIMIT[A-Z_]*|pageSize|maxItems|budget|cap)\b')

# Two findings: a generation that expired while the thing it guarded never did. Any two lifetimes
# in the same system have to be compared, and nothing compares them for you.
lifetime_re = re.compile(r'\b(ttl|maxAge|max_age|revalidate|expires|staleWhile|backstop|generation)\b', re.I)

# One finding, high blast radius: engine keys laid over a tenant's own field names in a binding
# scope, where hasOwn counts an undefined as a hit.
scope_re = re.compile(r'\b(itemScope|pageScope|siteScope|queryScope|scopes\s*[:=])')

# Two findings, and neither a test nor a screenshot could see them: the only text in the
# accessibility tree was hidden by the animation that was meant to reveal it.
a11y_re = re.compile(r'aria-hidden|visibility\s*:\s*hidden|opacity\s*:\s*0|display\s*:\s*contents|animation|@keyframes|position\s*:\s*(sticky|fixed)')

# One finding, and it is the worst kind: a runner checked that something answered on a port rather
# than that it was the process it had just started, so a stale server passes the whole suite.
harness_re = re.compile(r'(curl|wait-on|waitOn|nc -z|listen|localhost:\d+|127\.0\.0\.1:\d+|spawn|execa|next start|npm run dev)')

# One finding: a replay claim written before the purge it claimed, so a failure told the retry the
# work was already done. Order matters whenever a guard is written separately from its work.
guard_re = re.compile(r'\b(claim|lock|guard|mark(ed)?(Purged|Seen|Done)|dedupe|replay)\b', re.I)

for p in paths:
    lines = added[p]
    base = os.path.basename(p)
    is_script = p.startswith('scripts/') or base.endswith('.sh')
    for l in lines:
        if markup_re.search(l) and markupish.search(l):
            hit('markup-regex', p)
        if limit_re.search(l):
            hit('limit-or-budget', p)
        if lifetime_re.search(l):
            hit('two-lifetimes', p)
        if scope_re.search(l):
            hit('binding-scope', p)
        if a11y_re.search(l):
            hit('hidden-from-the-tree', p)
        if is_script and harness_re.search(l):
            hit('harness-trust', p)
        if guard_re.search(l):
            hit('guard-ordering', p)
    if p.startswith('look/fixtures/') or base.endswith('.golden.json'):
        hit('committed-fixture', p)

LABELS = {
 'markup-regex': 'a regular expression over markup, CSS or a URL (an end tag with a space, a single pass that closes up, catastrophic backtracking, $ tokens in a replacement)',
 'limit-or-budget': 'a limit or budget constant (is it clamped on every path, and does anything say when it is hit)',
 'two-lifetimes': 'two lifetimes that have to agree (what happens when one never expires)',
 'binding-scope': 'keys written into a binding scope (can an engine key shadow a field a tenant named)',
 'hidden-from-the-tree': 'markup hidden by CSS or animation (is anything left for a screen reader, and can the element move inside its wrapper)',
 'harness-trust': 'a script that starts or waits on a server (does it check the thing answering is the thing it started)',
 'guard-ordering': 'a claim or guard written separately from the work it protects (what happens if the work then fails)',
 'committed-fixture': 'a committed fixture or golden file (does a test read it, so it cannot rot unnoticed)',
}

if not hits:
    sys.exit(0)

print('needs-review: this diff touches things reviewers have found defects in before.')
print()
for rule, files in sorted(hits.items()):
    print('  %s' % LABELS[rule])
    for f in sorted(files)[:6]:
        print('      %s' % f)
    if len(files) > 6:
        print('      ... and %d more' % (len(files) - 6))
    print()
INNER
exit 0
