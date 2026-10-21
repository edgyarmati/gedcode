import * as Schema from "effect/Schema";

export const ReviewPolicyInput = Schema.Struct({
  scope: Schema.Literals(["project", "change"]),
  mode: Schema.Literals(["skip", "required"]),
  reason: Schema.String.check(Schema.isPattern(/[^\s\p{Cf}\p{Cc}]/u), Schema.isMaxLength(4000)),
  branch: Schema.optional(Schema.String),
  headSha: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))),
});

export const ReviewPolicyStatus = Schema.Struct({
  required: Schema.Boolean,
  valid: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  projectMode: Schema.Literals(["skip", "required"]),
  scope: Schema.NullOr(Schema.Literals(["project", "change"])),
  reason: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  headSha: Schema.NullOr(Schema.String),
});

export const ReviewGateStatus = Schema.Literals(["current", "legacy", "custom", "missing"]);

/** Trusted bundled code, shared with the standalone gate; never loaded from a checkout. */
export const REVIEW_POLICY_SCRIPT = String.raw`
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const [action, targetSha] = process.argv.slice(1);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const text = (s) => typeof s === "string" && s.length <= 4000 && /[^\s\p{Cf}\p{Cc}]/u.test(s);
const branchName = (s) => typeof s === "string" && s !== "HEAD" && /^[A-Za-z0-9._/-]+$/.test(s)
  && !s.startsWith("-") && !s.includes("..");
const sha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const empty = () => ({ schemaVersion: 1, project: null, changes: [] });
let branch = null, headSha = null;
const status = (policy, error = null) => {
  const match = policy.project ?? policy.changes.find((c) => c.branch === branch && c.headSha === headSha);
  return { required: error !== null || !match, valid: error === null, error,
    projectMode: policy.project ? "skip" : "required",
    scope: match ? (policy.project ? "project" : "change") : null,
    reason: match?.reason ?? null, branch, headSha };
};
const noLink = (file, directory) => {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw new Error("Review policy path is a symlink or has the wrong file type.");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
};
try {
  const common = fs.realpathSync(git("rev-parse", "--path-format=absolute", "--git-common-dir"));
  const dir = path.join(common, "ged");
  const file = path.join(dir, "review-policy.json");
  // Status is also useful in an unborn or detached checkout. Neither can receive a change skip.
  try { branch = git("symbolic-ref", "--quiet", "HEAD").replace(/^refs\/heads\//, ""); } catch {}
  try { headSha = git("rev-parse", "--verify", "HEAD^{commit}"); } catch {}
  noLink(dir, true);
  noLink(file, false);
  let input;
  if (action === "set") {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!object(input) || !["project", "change"].includes(input.scope)
      || !["skip", "required"].includes(input.mode) || !text(input.reason))
      throw new Error("Explicit scope, mode and a visible reason are required.");
  }
  let policy = empty();
  // Project reset is the explicit recovery path for corrupt records; it never follows links.
  if (!(input?.scope === "project" && input.mode === "required")) {
    try {
      if (fs.statSync(file).size > 256 * 1024) throw new Error("Review policy exceeds 256 KiB.");
      policy = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch (e) { if (e.code !== "ENOENT") throw new Error("Review policy is unreadable or invalid JSON."); }
    if (!object(policy) || policy.schemaVersion !== 1
      || !(policy.project === null || (object(policy.project) && text(policy.project.reason)))
      || !Array.isArray(policy.changes)) throw new Error("Invalid review policy record.");
    const branches = new Set();
    for (const c of policy.changes) {
      if (!object(c) || !branchName(c.branch) || !sha(c.headSha) || !text(c.reason) || branches.has(c.branch))
        throw new Error("Invalid or duplicate change review policy record.");
      branches.add(c.branch);
    }
  }
  if (action === "set") {
    if (input.scope === "project") {
      policy = input.mode === "required" ? empty() : { ...policy, project: { reason: input.reason } };
    } else {
      if (!branchName(branch) || !sha(headSha)) throw new Error("Change policy needs an attached, committed, supported branch.");
      if (input.mode === "skip") {
        if (input.branch !== branch || input.headSha !== headSha)
          throw new Error("Change skip must name the exact current branch and final HEAD.");
        if (git("status", "--porcelain=v1", "-uall", "--", ":!.ged/verdicts"))
          throw new Error("Commit the final change and clean the working tree before recording a change skip.");
      }
      policy = { ...policy, changes: policy.changes.filter((c) => c.branch !== branch) };
      if (input.mode === "skip") policy.changes.push({ branch, headSha, reason: input.reason });
    }
    fs.mkdirSync(dir, { recursive: true });
    noLink(dir, true);
    noLink(file, false);
    const body = JSON.stringify(policy, null, 2) + "\n";
    if (Buffer.byteLength(body) > 256 * 1024) throw new Error("Review policy exceeds 256 KiB.");
    const tmp = path.join(dir, ".review-policy-" + randomUUID());
    try {
      fs.writeFileSync(tmp, body, { flag: "wx", mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  const result = status(policy);
  if (action === "gate") {
    if (!result.required && (result.scope === "project" || headSha === targetSha)) {
      console.log("ALLOWED: independent review SKIPPED (" + result.scope + "): " + result.reason);
      process.exit(0);
    }
    process.exit(3); // Required: continue with the gate's existing verdict protections.
  }
  console.log(JSON.stringify(result));
} catch (e) {
  if (action === "status") console.log(JSON.stringify(status(empty(), e.message)));
  else { console.error("BLOCKED: " + e.message); process.exit(1); }
}
`;
