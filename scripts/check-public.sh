#!/bin/sh
# Refuse a commit whose staged content could leak private details into this public repository.
# Checks the staged blob of every added or modified file, not the working tree.
#
# Refused patterns (written as character classes so this file does not match itself):
#   private tailnet hostnames, absolute home paths, Cloudflare user API tokens,
#   Artifacts repo tokens, and bare 32-hex identifiers (account ids, resource ids).
set -eu

PATTERN='\.ts[.]net|/hom[e]/|cfu[t]_|art_v[0-9]+_[0-9a-z]|(^|[^0-9A-Fa-f])[0-9a-f]{32}([^0-9A-Fa-f]|$)'

status=0
files=$(mktemp)
trap 'rm -f "$files"' EXIT
# Verbatim Cloudflare doc archives (cloudflare-*-docs/) are exempt: Cloudflare's examples carry placeholder tokens and sample
# account ids that match the patterns. Nothing of ours may be written under this path.
git diff --cached --name-only --diff-filter=ACM | grep -vE '^docs/plan/sources/cloudflare-[a-z]+-docs/' > "$files" || true
while IFS= read -r f; do
  # -a scans binary blobs too, so an image or archive cannot carry a token past the check.
  hits=$(git show ":$f" 2>/dev/null | grep -anE "$PATTERN" || true)
  if [ -n "$hits" ]; then
    # Print the file and line numbers only, never the matched text.
    echo "check-public: refused $f at line(s): $(echo "$hits" | cut -d: -f1 | tr '\n' ' ')" >&2
    status=1
  fi
done < "$files"

if [ "$status" -ne 0 ]; then
  echo "check-public: remove the private value, or move it to an environment variable." >&2
fi
exit "$status"
