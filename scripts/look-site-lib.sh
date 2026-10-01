# The parts of scripts/look-site.sh that decide whether a run can be trusted, kept apart so that
# scripts/look-site-selftest.sh can run them without a build or a browser. Sourced, never run.

# Prints the name the fixture directory $1 gives its site, and returns 2 when it gives none.
site_name() {
  local name
  name=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).Name ?? ""))' "$1/site.json") || return 1
  if [ -z "$name" ]; then
    echo "$1/site.json names no \"Name\", so there is nothing to tell this site's pages apart from whatever else is on the port" >&2
    return 2
  fi
  printf '%s' "$name"
}

# True when the page at $1 carries the name $2.
#
# The body is read whole before it is matched. Piped into `grep -q` it was not: grep stops reading at
# its first match, curl was still writing the rest of a 181KB page into a closed pipe, and under
# `pipefail` the pipeline that had just found the name reported that it had not.
#
# An empty name is refused here as well as by the caller, since every page carries the empty string.
page_says() {
  local body
  [ -n "$2" ] || return 2
  body=$(curl -s "$1") || return 1
  [[ $body == *"$2"* ]]
}

# Removes the pages `next start` rendered for tenant $2 on an earlier run, under the build in $1.
#
# Next writes a page it renders at request time beside the build output, at
# server/app/_press/<tenant>~public~-.html with its .meta, .rsc and .segments, and under
# <tenant>~public~-/ for a path below the root. The next `next start` answers its first request from
# those files, so a fixture edited since would be compared as it was before the edit. `-` is the
# host of a tenant found by CMS_DEFAULT_TENANT, which is how look-site.sh reaches every site.
#
# Only that one name goes. The build's own app/_press/[site] is left alone, and so is any other
# tenant's render. A tenant that is not a handle is refused, because it is about to be part of a
# path handed to `rm -rf`, and the rule is the one in src/delivery.ts.
clear_site_renders() {
  local renders="$1/server/app/_press" tenant="$2"
  if [[ ! $tenant =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]]; then
    echo "\"$tenant\" is not a tenant handle, so no render of it is removed" >&2
    return 2
  fi
  rm -rf "$renders/$tenant~public~-" "$renders/$tenant~public~-".*
}
