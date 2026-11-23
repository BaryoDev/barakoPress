#!/usr/bin/env bash
# Proves check-action-pins.sh goes red on an unpinned action and green on a pinned one.
#
#   bash scripts/test-check-action-pins.sh
#
# The fixtures are written to a scratch directory at run time, so this repository never holds a
# workflow with a tag ref that the real check would have to skip.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
check="$here/check-action-pins.sh"
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT

sha=3d3c42e5aac5ba805825da76410c181273ba90b1
digest=$(printf 'a%.0s' $(seq 1 64))
fail=0

# wf NAME: one workflow dir whose steps are read from stdin.
wf() {
  mkdir -p "$d/$1"
  { printf 'name: fixture\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n'; cat; } > "$d/$1/w.yml"
}

# expect NAME pass|fail
expect() {
  local out code want=$2
  out=$(bash "$check" "$d/$1" 2>&1); code=$?
  if { [ "$want" = pass ] && [ "$code" -eq 0 ]; } || { [ "$want" = fail ] && [ "$code" -ne 0 ]; }; then
    echo "ok   $1 ($want)"
  else
    echo "FAIL $1: wanted $want, exit $code"
    echo "$out" | sed 's/^/     /'
    fail=1
  fi
}

wf good <<STEPS
      - uses: actions/checkout@$sha # v7
STEPS
wf tag <<STEPS
      - uses: actions/checkout@v7
STEPS
wf branch <<STEPS
      - uses: actions/checkout@main
STEPS
wf short <<STEPS
      - uses: actions/checkout@3d3c42e
STEPS
wf mixed <<STEPS
      - uses: actions/checkout@$sha # v7
      - uses: actions/setup-node@v7
STEPS
wf local <<STEPS
      - uses: actions/checkout@$sha # v7
      - uses: ./.github/actions/thing
STEPS
wf docker-digest <<STEPS
      - uses: docker://alpine:3.20@sha256:$digest
STEPS
wf docker-tag <<STEPS
      - uses: docker://alpine:3.20
STEPS
wf none <<STEPS
      - run: echo no actions here
STEPS

expect good pass
expect tag fail
expect branch fail
expect short fail
expect mixed fail
expect local pass
expect docker-digest pass
expect docker-tag fail
expect none fail

echo "this repository's workflows:"
if [ -d "$here/../.github/workflows" ]; then
  expect_dir=$here/../.github/workflows
  if bash "$check" "$expect_dir" > /dev/null; then echo "ok   real workflows (pass)"; else echo "FAIL real workflows"; fail=1; fi
fi

[ "$fail" -eq 0 ] && echo "check-action-pins self-test passed" || echo "check-action-pins self-test FAILED"
exit "$fail"
