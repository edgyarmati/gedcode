#!/usr/bin/env sh
# Ged land gate: refuse to land a change without a current, passing, independent verdict.
# Usage: .ged/bin/land-gate.sh [ref]     (default: HEAD)
# Exit:  0 = allowed, 1 = blocked, 2 = usage/environment error
set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "land-gate: not a git repository" >&2; exit 2; }
cd "$repo_root"

ref=${1:-HEAD}
head_sha=$(git rev-parse "$ref" 2>/dev/null) || {
  echo "land-gate: cannot resolve ref '$ref'" >&2; exit 2; }
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

slug=$(printf '%s' "$branch" | tr '/' '-')
record=".ged/verdicts/${slug}.json"

if [ ! -f "$record" ]; then
  echo "BLOCKED: no verdict record for branch '$branch' (expected $record)" >&2
  echo "  Nothing lands without an independent verifier's ruling." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "land-gate: node is required" >&2; exit 2; }

node --input-type=module -e '
import { readFileSync } from "node:fs";
const [record, headSha, branch] = process.argv.slice(1);
const fail = (m) => { console.error("BLOCKED: " + m); process.exit(1); };

let v;
try { v = JSON.parse(readFileSync(record, "utf8")); }
catch (e) { fail(`verdict record is unreadable or not valid JSON (${e.message})`); }

if (v.schemaVersion !== 1) fail(`unsupported schemaVersion ${JSON.stringify(v.schemaVersion)}`);
if (v.branch !== branch) fail(`record is for branch ${JSON.stringify(v.branch)}, not ${JSON.stringify(branch)}`);

if (v.headSha !== headSha) {
  fail(`verdict is stale.\n  verified: ${v.headSha}\n  current:  ${headSha}\n`
     + "  The tree changed after verification. Re-verify.");
}
if (v.status !== "pass") fail(`verdict status is ${JSON.stringify(v.status)}`);

const criteria = v.criteria;
if (!Array.isArray(criteria) || criteria.length === 0) fail("verdict records no criteria");

const unmet = criteria.filter((c) => c?.verdict !== "met");
if (unmet.length > 0) {
  console.error(`BLOCKED: ${unmet.length} of ${criteria.length} criteria did not pass:`);
  for (const c of unmet) console.error(`  [${c?.verdict ?? "missing"}] ${c?.criterion ?? "(no text)"}`);
  console.error("  Note: `unverifiable` is not a pass.");
  process.exit(1);
}
if (criteria.some((c) => typeof c.evidence !== "string" || c.evidence.trim() === "")) {
  fail("a criterion is marked met with no evidence");
}

const iv = v.implementer?.driverKind, vv = v.verifier?.driverKind;
if (!iv || !vv) fail("record does not name both implementer and verifier driverKind");
if (iv === vv) fail(`verifier and implementer are the same vendor (${vv}); independence is void`);

console.log(`land-gate: OK — ${criteria.length} criteria met, verified by ${vv} against ${iv} at ${headSha.slice(0, 12)}`);
' "$record" "$head_sha" "$branch"
