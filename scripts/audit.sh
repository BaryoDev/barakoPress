#!/usr/bin/env bash
# The dependency audit, with a finding and a failure to ask told apart (barakoPress #70).
#
#   scripts/audit.sh [dir]       audit the lockfile in dir (default: the repository)
#   scripts/audit.sh --self-test prove it goes red on a real advisory and says so when it cannot ask
#
# Exit 0: no high or critical advisory left unaccepted. Exit 1: at least one, listed. Exit 2: the
# registry could not be asked, which is an outage to retry and not a vulnerability.
#
# .github/audit-allowlist.json accepts an advisory for a while: an array of
# { "id": "GHSA-...", "package": "...", "reason": "...", "expires": "YYYY-MM-DD" }. An entry counts
# only with an id, a reason and an expires date written YYYY-MM-DD that is today (UTC) or later. A finding is accepted
# when every advisory behind it, followed through its via chain, is accepted. A missing file accepts
# nothing. A file that is not valid JSON fails the audit. AUDIT_ALLOWLIST overrides the path.
#
# npm 10 posts to the quick audit endpoint npm is retiring, so a pinned npm 11 runs it: that posts to
# the bulk advisory endpoint. Pinned rather than "latest" so the step does not change under a pull
# request. AUDIT_NPM overrides it.
set -uo pipefail

NPM_SPEC=${AUDIT_NPM:-npm@11.19.1}
ALLOWLIST=${AUDIT_ALLOWLIST:-$(cd "$(dirname "$0")/.." && pwd)/.github/audit-allowlist.json}
export ALLOWLIST

# Reads `npm audit --json` on stdin. Exit 0, 1 or 2 as above.
# shellcheck disable=SC2016 # the node program is single-quoted on purpose
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
      const vulns = report.vulnerabilities ?? {};
      const found = Object.values(vulns)
        .filter((v) => v.severity === "high" || v.severity === "critical");
      const today = new Date().toISOString().slice(0, 10);
      const accepted = new Map();
      const path = process.env.ALLOWLIST;
      if (path && require("fs").existsSync(path)) {
        let list;
        try { list = JSON.parse(require("fs").readFileSync(path, "utf8")); } catch (e) {
          console.log(`audit: ${path} is not valid JSON, failing closed: ${e.message}`);
          process.exit(1);
        }
        if (!Array.isArray(list)) {
          console.log(`audit: ${path} is not a JSON array, failing closed`);
          process.exit(1);
        }
        for (const e of list) {
          const exp = String(e?.expires ?? "");
          if (e && e.id && e.reason && /^\d{4}-\d{2}-\d{2}$/.test(exp) && exp >= today) accepted.set(e.id, exp);
        }
      }
      // Every advisory id behind a package, following via through other packages.
      const idsOf = (name, seen = new Set()) => {
        if (seen.has(name)) return [];
        seen.add(name);
        const ids = [];
        for (const via of vulns[name]?.via ?? []) {
          if (typeof via === "string") ids.push(...idsOf(via, seen));
          else {
            const m = /GHSA-[a-z0-9-]+/i.exec(via?.url ?? "");
            ids.push(m ? m[0] : `unknown:${via?.title ?? name}`);
          }
        }
        return ids;
      };
      if ((counts.high ?? 0) + (counts.critical ?? 0) === 0) {
        console.log(`audit: no high or critical advisory in ${counts.total ?? 0} reported`);
        process.exit(0);
      }
      let failed = false;
      for (const v of found) {
        const ids = [...new Set(idsOf(v.name))];
        if (ids.length > 0 && ids.every((id) => accepted.has(id))) {
          for (const id of ids) console.log(`audit: accepted until ${accepted.get(id)}: ${v.severity} ${v.name} ${id}`);
        } else {
          failed = true;
          console.log(`audit: ${v.severity} ${v.name} ${v.range ?? ""}`);
        }
      }
      process.exit(failed ? 1 : 0);
    });
  '
}

audit() { # $1 dir, then extra npm arguments
  local dir=$1
  shift
  # npm exits 1 on a finding; judge decides, so its own status must not leak through pipefail.
  (cd "$dir" && { npx -y "$NPM_SPEC" audit --json --audit-level=high "$@" 2>/dev/null || true; }) | judge
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

  # Cases 1 and 2 run with nothing accepted, whatever the repository allowlist says.
  export ALLOWLIST="$TMP/none.json"
  audit "$TMP"
  seeded=$?
  audit "$TMP" --registry http://127.0.0.1:1/
  dead=$?
  future=$(node -e 'console.log(new Date(Date.now() + 864e5 * 30).toISOString().slice(0, 10))')
  printf '[{"id":"GHSA-68fv-2mgg-jv7q","package":"source-map-js","reason":"self-test","expires":"%s"}]\n' "$future" > "$TMP/live.json"
  printf '[{"id":"GHSA-68fv-2mgg-jv7q","package":"source-map-js","reason":"self-test","expires":"2000-01-01"}]\n' > "$TMP/old.json"
  export ALLOWLIST="$TMP/live.json"
  audit "$TMP" >/dev/null
  accepted=$?
  export ALLOWLIST="$TMP/old.json"
  audit "$TMP" >/dev/null
  expired=$?
  if [ "$seeded" -eq 1 ] && [ "$dead" -eq 2 ] && [ "$accepted" -eq 0 ] && [ "$expired" -eq 1 ]; then
    echo "self-test: a seeded high advisory exits 1, an unreachable registry exits 2, an allowlisted one exits 0 until it expires"
    exit 0
  fi
  echo "self-test: FAIL, seeded advisory exited $seeded (want 1), unreachable registry exited $dead (want 2), allowlisted exited $accepted (want 0), expired entry exited $expired (want 1)"
  exit 1
fi

audit "${1:-$(cd "$(dirname "$0")/.." && pwd)}"
