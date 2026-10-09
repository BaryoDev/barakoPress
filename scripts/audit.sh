#!/usr/bin/env bash
# The dependency audit, with a finding and a failure to ask told apart (barakoPress #70).
#
#   scripts/audit.sh [dir]       audit the lockfile in dir (default: the repository)
#   scripts/audit.sh --self-test prove it goes red on a real advisory and says so when it cannot ask
#
# Exit 0: no high or critical advisory. Exit 1: at least one, listed. Exit 2: the registry could not
# be asked, which is an outage to retry and not a vulnerability.
#
# npm 10 posts to the quick audit endpoint npm is retiring, so a pinned npm 11 runs it: that posts to
# the bulk advisory endpoint. Pinned rather than "latest" so the step does not change under a pull
# request. AUDIT_NPM overrides it.
set -uo pipefail

NPM_SPEC=${AUDIT_NPM:-npm@11.19.1}

# Reads `npm audit --json` on stdin. Exit 0, 1 or 2 as above.
judge() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let report;
      try { report = JSON.parse(raw); } catch { report = null; }
      const counts = report?.metadata?.vulnerabilities;
      if (!counts || typeof counts !== "object") {
        const why = report?.message || report?.error?.summary || "no report came back";
        console.log(`audit: could not ask the registry: ${why}`);
        process.exit(2);
      }
      const found = Object.values(report.vulnerabilities ?? {})
        .filter((v) => v.severity === "high" || v.severity === "critical");
      if ((counts.high ?? 0) + (counts.critical ?? 0) === 0) {
        console.log(`audit: no high or critical advisory in ${counts.total ?? 0} reported`);
        process.exit(0);
      }
      for (const v of found) console.log(`audit: ${v.severity} ${v.name} ${v.range ?? ""}`);
      process.exit(1);
    });
  '
}

audit() { # $1 dir, then extra npm arguments
  local dir=$1
  shift
  (cd "$dir" && npx -y "$NPM_SPEC" audit --json --audit-level=high "$@" 2>/dev/null) | judge
}

if [ "${1:-}" = "--self-test" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  # source-map-js 1.2.1 carries GHSA-68fv-2mgg-jv7q, high. A lockfile only, nothing installed.
  printf '{"name":"audit-seed","version":"1.0.0","private":true,"dependencies":{"source-map-js":"1.2.1"}}\n' > "$TMP/package.json"
  if ! (cd "$TMP" && npx -y "$NPM_SPEC" install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1); then
    echo "self-test: could not write the seeded lockfile"
    exit 2
  fi

  audit "$TMP"
  seeded=$?
  audit "$TMP" --registry http://127.0.0.1:1/
  dead=$?
  if [ "$seeded" -eq 1 ] && [ "$dead" -eq 2 ]; then
    echo "self-test: a seeded high advisory exits 1, an unreachable registry exits 2"
    exit 0
  fi
  echo "self-test: FAIL, seeded advisory exited $seeded (want 1), unreachable registry exited $dead (want 2)"
  exit 1
fi

audit "${1:-$(cd "$(dirname "$0")/.." && pwd)}"
