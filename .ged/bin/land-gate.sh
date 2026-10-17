#!/usr/bin/env sh
# Ged land gate: refuse to land a change without a current, passing, independent verdict.
# Usage: .ged/bin/land-gate.sh [ref]     (default: HEAD)
# Exit:  0 = allowed, 1 = blocked, 2 = usage/environment error
#
# Fails closed. Every unexpected condition blocks.
set -eu

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "land-gate: not a git repository" >&2; exit 2; }
cd "$repo_root"

ref=${1:-HEAD}
# --end-of-options stops a ref like `--git-dir` being read as an option;
# ^{commit} resolves annotated tags to the commit they point at.
head_sha=$(git rev-parse --verify --end-of-options "${ref}^{commit}" 2>/dev/null) || {
  echo "land-gate: cannot resolve '$ref' to a commit" >&2; exit 2; }
case "$head_sha" in
  ????????????????????????????????????????) ;;
  *) echo "land-gate: resolved SHA is malformed" >&2; exit 2 ;;
esac

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || {
  echo "land-gate: cannot determine branch" >&2; exit 2; }
if [ "$branch" = "HEAD" ]; then
  echo "land-gate: detached HEAD — no branch to key a verdict to" >&2; exit 2
fi

# Uncommitted changes are unverified by construction: the verifier reviewed a commit.
# `.ged/verdicts/` is excluded because verdict records are deliberately untracked —
# see .ged/verdicts/README.md. Including them would make the tree permanently dirty.
dirty=$(git status --porcelain=v1 -uall -- ':!.ged/verdicts' 2>/dev/null) || {
  echo "land-gate: cannot inspect working tree" >&2; exit 2; }
if [ -n "$dirty" ]; then
  echo "BLOCKED: working tree is dirty. The verdict covers $head_sha, not your uncommitted changes." >&2
  printf '%s\n' "$dirty" | sed 's/^/  /' >&2
  exit 1
fi

slug=$(printf '%s' "$branch" | tr '/' '-')
# Reject anything that could be read as an option or escape the directory.
case "$slug" in
  -*|*/*|*..*|"") echo "land-gate: unusable branch name '$branch'" >&2; exit 2 ;;
esac
if printf '%s' "$slug" | LC_ALL=C grep -q '[^A-Za-z0-9._-]'; then
  echo "land-gate: branch '$branch' contains characters that cannot be mapped to a record name" >&2
  exit 2
fi

record=".ged/verdicts/${slug}.json"
if [ -L "$record" ]; then
  echo "BLOCKED: $record is a symlink; refusing to follow it" >&2; exit 1
fi
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

// Must match ProviderDriverKind in packages/contracts/src/model.ts.
const DRIVER_KINDS = new Set([
  "codex", "claudeagent", "cursor", "grok", "muse", "pi", "acpregistry", "opencode",
]);

let v;
try { v = JSON.parse(readFileSync(record, "utf8")); }
catch (e) { fail(`verdict record is unreadable or not valid JSON (${e.message})`); }

if (v === null || typeof v !== "object" || Array.isArray(v)) fail("verdict record is not a JSON object");
if (v.schemaVersion !== 2) fail(`unsupported schemaVersion ${JSON.stringify(v.schemaVersion)}; re-verify to record a current verdict`);
if (v.branch !== branch) fail(`record is for branch ${JSON.stringify(v.branch)}, not ${JSON.stringify(branch)}`);

if (typeof v.headSha !== "string" || v.headSha !== headSha) {
  fail(`verdict is stale or malformed.\n  verified: ${JSON.stringify(v.headSha)}\n  current:  ${headSha}\n`
     + "  The tree changed after verification. Re-verify.");
}

const norm = (x) => (typeof x === "string" ? x.trim().toLowerCase() : null);
const iv = norm(v.implementer?.driverKind);
if (iv === null) fail("implementer driverKind must be a string");
if (!DRIVER_KINDS.has(iv)) fail(`unknown implementer driverKind ${JSON.stringify(v.implementer.driverKind)}`);

const reviews = v.reviews;
if (!Array.isArray(reviews) || reviews.length === 0) fail("verdict records no reviews");

// Strip whitespace and every invisible format character (zero-width, bidi
// controls, soft hyphen) before judging emptiness, so nothing unseen can stand
// in for evidence.
const substantive = (s) =>
  typeof s === "string" && s.replace(/[\s\p{Cf}]/gu, "").length >= 3;

const verifiers = [];
for (const r of reviews) {
  if (r === null || typeof r !== "object" || Array.isArray(r)) fail("a review is not a JSON object");
  const vv = norm(r.verifier?.driverKind);
  if (vv === null) fail("a review has no verifier driverKind");
  if (!DRIVER_KINDS.has(vv)) fail(`unknown verifier driverKind ${JSON.stringify(r.verifier.driverKind)}`);
  const who = r.verifier.model ? `${vv} (${r.verifier.model})` : vv;
  if (r.status !== "pass") fail(`the review by ${who} has status ${JSON.stringify(r.status)}`);
  const criteria = r.criteria;
  if (!Array.isArray(criteria) || criteria.length === 0) fail(`the review by ${who} records no criteria`);
  const unmet = criteria.filter((c) => c === null || typeof c !== "object" || c.verdict !== "met");
  if (unmet.length > 0) {
    console.error(`BLOCKED: ${unmet.length} of ${criteria.length} criteria did not pass the review by ${who}:`);
    for (const c of unmet) console.error(`  [${c?.verdict ?? "missing"}] ${c?.criterion ?? "(no text)"}`);
    console.error("  Note: `unverifiable` is not a pass.");
    process.exit(1);
  }
  for (const c of criteria) {
    if (!substantive(c.criterion)) fail(`a criterion in the review by ${who} has no text`);
    if (!substantive(c.evidence)) {
      fail(`a criterion is marked met without substantive evidence by ${who}: ${JSON.stringify(c.criterion)}`);
    }
  }
  if (typeof r.otherVendorAvailable !== "boolean") fail(`the review by ${who} does not record otherVendorAvailable`);
  verifiers.push({ vv, who, otherVendorAvailable: r.otherVendorAvailable });
}

const foreign = verifiers.filter((r) => r.vv !== iv);
if (foreign.length === 0) {
  if (verifiers.some((r) => r.otherVendorAvailable)) {
    fail(`verified only by the implementer vendor (${iv}), while another vendor was installed.\n`
       + "  Add a review from another vendor; same-vendor review shares the blind spots of the implementer.");
  }
  console.error(`WARNING: verified only by the implementer vendor (${iv}); no other vendor was installed.`);
}

const names = verifiers.map((r) => r.who).join(" + ");
console.log(`land-gate: OK — ${reviews.length} review(s) passed, verified by ${names} against ${iv} at ${headSha.slice(0, 12)}`);
' "$record" "$head_sha" "$branch"
