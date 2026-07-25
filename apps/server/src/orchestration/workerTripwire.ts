// Server-owned Codex `PreToolUse` tripwire for orchestrator workers.
//
// Workers run with full access (see `workerSafety.ts`), so this is not a
// security boundary and never pretends to be one: it is best-effort accident
// prevention that rejects clearly destructive operations whose explicit target
// resolves outside the worker's task worktree. Anything a worker does through a
// script, an opaque subprocess, or a tool that opts out of hooks is invisible
// here by design.
//
// The script is materialized to disk and handed to Codex as a session-flag hook,
// so it must stay self-contained: `apps/server` ships as a single bundled file,
// which means the hook cannot import anything from this package at runtime.
// `workerTripwire.test.ts` executes this exact script, so the rules have one
// source of truth.
export const WORKER_TRIPWIRE_HOOK_SCRIPT = `import { readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const allow = () => process.exit(0);

const deny = (reason) => {
  // One concise decision on stdout, exit 0: Codex reports the reason to the
  // worker and the turn continues. A non-zero exit would surface as a hook
  // failure, and an approval request would stall an unattended worker.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};

const isInside = (root, candidate) => {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// Symlinked roots are the norm on macOS (\`/tmp\` -> \`/private/tmp\`), so both the
// worktree and the target are resolved through their nearest existing ancestor.
// Comparing unresolved paths would deny ordinary in-worktree work.
const canonicalize = (target) => {
  let candidate = resolve(target);
  const trailing = [];
  for (;;) {
    try {
      const resolved = realpathSync(candidate);
      return trailing.length > 0 ? join(resolved, ...trailing) : resolved;
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(target);
      trailing.unshift(basename(candidate));
      candidate = parent;
    }
  }
};

// Caches, package-manager homes, and temp space are shared build infrastructure,
// not the user's work: pruning them is ordinary and must never be blocked.
const home = process.env.HOME ?? homedir();
const EXTERNAL_MAINTENANCE_ROOTS = [
  tmpdir(),
  "/tmp",
  "/private/tmp",
  "/var/tmp",
  "/var/folders",
  join(home, "Library", "Caches"),
  ...[
    ".cache",
    ".config",
    ".local",
    ".npm",
    ".bun",
    ".cargo",
    ".rustup",
    ".deno",
    ".yarn",
    ".pnpm-store",
    ".gradle",
    ".m2",
    ".nvm",
    ".pyenv",
    ".uv",
  ].map((entry) => join(home, entry)),
].map(canonicalize);

const isExternalMaintenance = (target) =>
  EXTERNAL_MAINTENANCE_ROOTS.some((root) => isInside(root, target)) ||
  target.split(sep).includes("node_modules");

const WORD = 0;
const OPERATOR = 1;

// Words are split the way a shell would: quotes and escapes hold a path
// together, and unquoted control characters separate one command from the next,
// so a destructive verb is found wherever it sits in a composed command line.
const tokenize = (input) => {
  const items = [];
  let current = "";
  let quote = null;
  let hasWord = false;
  const flush = () => {
    if (!hasWord) return;
    items.push({ kind: WORD, value: current });
    current = "";
    hasWord = false;
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      hasWord = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
      continue;
    }
    if (char === "\\\\") {
      const next = input[index + 1];
      if (next !== undefined) {
        current += next;
        hasWord = true;
        index += 1;
      }
      continue;
    }
    if (/\\s/.test(char)) {
      flush();
      continue;
    }
    if (char === ";" || char === "&" || char === "|" || char === "(" || char === ")") {
      flush();
      items.push({ kind: OPERATOR });
      continue;
    }
    // Redirects become their own word so \`> file\`, \`>file\`, and \`1> file\` all
    // expose the same overwrite target.
    if (char === ">" || char === "<") {
      flush();
      let operator = char;
      while (input[index + 1] === char) {
        operator += char;
        index += 1;
      }
      items.push({ kind: WORD, value: operator });
      continue;
    }
    current += char;
    hasWord = true;
  }
  flush();
  return items;
};

// The shell expands home and temp references before the command runs, so the
// tripwire has to expand them too or it would read \`~/Documents\` as a
// worktree-relative path and wave it through.
const expandPath = (token) => {
  if (token === "~") return home;
  if (token.startsWith("~/")) return join(home, token.slice(2));
  for (const [reference, value] of [
    ["\${HOME}", home],
    ["$HOME", home],
    ["\${TMPDIR}", tmpdir()],
    ["$TMPDIR", tmpdir()],
  ]) {
    if (token === reference) return value;
    if (token.startsWith(\`\${reference}/\`)) return join(value, token.slice(reference.length + 1));
  }
  return token;
};

// Deletion, destructive moves, truncation, and ownership or mode changes.
// Everything else — builds, installers, compilers, git, editors — is left alone.
const DESTRUCTIVE_VERBS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "mv",
  "shred",
  "truncate",
  "chown",
  "chgrp",
  "chmod",
  "dd",
]);

// Prefixes that carry no target of their own; the real verb follows them.
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "time",
  "nice",
  "ionice",
  "command",
  "exec",
  "builtin",
  "stdbuf",
  "nohup",
  "xargs",
]);

const NESTED_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const dropWrappers = (words) => {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (ASSIGNMENT.test(word)) {
      index += 1;
      continue;
    }
    if (!WRAPPERS.has(basename(word))) break;
    index += 1;
    while (index < words.length && (words[index].startsWith("-") || ASSIGNMENT.test(words[index]))) {
      index += 1;
    }
  }
  return words.slice(index);
};

// The words a destructive verb acts on. Bare flags carry no path, but shells
// pass \`--file=...\` and \`of=...\` through verbatim, so inline values still count.
// \`if=\` is skipped: it names the source a command reads, never what it destroys.
const candidateTargets = (words) => {
  const candidates = [];
  for (const word of words) {
    const separator = word.indexOf("=");
    if (separator > 0) {
      const key = word.slice(0, separator).replace(/^-+/, "");
      if (key !== "if") candidates.push(word.slice(separator + 1));
      continue;
    }
    if (word.startsWith("-")) continue;
    candidates.push(word);
  }
  return candidates;
};

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow();
}

const command = payload?.tool_input?.command;
const sessionCwd = payload?.cwd;
if (typeof command !== "string" || typeof sessionCwd !== "string") allow();

// The worktree is the session cwd Codex reports, not anything the command says:
// a \`cd\` inside a command only changes how its relative paths resolve.
const worktree = canonicalize(sessionCwd);

const describe = (verb, target) =>
  \`GedCode worker tripwire: refusing "\${verb}" on \${target}, which is outside this task worktree (\${worktree}). Keep destructive changes inside the worktree, and ask the PM if an external change is genuinely required.\`;

const inspectCommand = (input, startDir, depth) => {
  if (depth > 3) return null;
  const segments = [[]];
  for (const item of tokenize(input)) {
    if (item.kind === OPERATOR) {
      segments.push([]);
      continue;
    }
    segments[segments.length - 1].push(item.value);
  }

  let current = startDir;
  for (const segment of segments) {
    // A lone \`>\` truncates its target before the command even runs, whatever the
    // command is. \`>>\` appends, which adds to a file instead of destroying it.
    for (let index = 0; index + 1 < segment.length; index += 1) {
      if (segment[index] !== ">") continue;
      const target = canonicalize(resolve(current, expandPath(segment[index + 1])));
      if (!isInside(worktree, target) && !isExternalMaintenance(target)) {
        return describe(">", target);
      }
    }

    const words = dropWrappers(segment);
    if (words.length === 0) continue;
    const verb = basename(words[0]);
    const operands = words.slice(1);

    if (verb === "cd" || verb === "pushd") {
      const target = operands.find((word) => !word.startsWith("-"));
      if (target !== undefined) current = resolve(current, expandPath(target));
      continue;
    }

    if (NESTED_SHELLS.has(verb)) {
      const flagIndex = operands.indexOf("-c");
      const nested = flagIndex >= 0 ? operands[flagIndex + 1] : undefined;
      if (nested !== undefined) {
        const reason = inspectCommand(nested, current, depth + 1);
        if (reason !== null) return reason;
      }
      continue;
    }

    if (!DESTRUCTIVE_VERBS.has(verb)) continue;

    for (const candidate of candidateTargets(operands)) {
      const target = canonicalize(resolve(current, expandPath(candidate)));
      if (!isInside(worktree, target) && !isExternalMaintenance(target)) {
        return describe(verb, target);
      }
    }
  }
  return null;
};

// Codex edits files through \`apply_patch\`, whose command body names every path it
// touches. Those paths are the patch's explicit targets.
const PATCH_TARGET = /^\\*\\*\\* (?:Add File|Update File|Delete File|Move to): (.+)$/;

const inspectPatch = (patch) => {
  for (const line of patch.split(/\\r?\\n/)) {
    const matched = PATCH_TARGET.exec(line.trim());
    if (matched === null) continue;
    const target = canonicalize(resolve(worktree, expandPath(matched[1].trim())));
    if (!isInside(worktree, target) && !isExternalMaintenance(target)) {
      return describe("apply_patch", target);
    }
  }
  return null;
};

const reason =
  payload?.tool_name === "apply_patch"
    ? inspectPatch(command)
    : inspectCommand(command, worktree, 0);
if (reason !== null) deny(reason);
allow();
`;
