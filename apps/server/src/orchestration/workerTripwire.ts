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

// Standard pseudo devices are sinks and sources, never the user's work. Agents
// silence commands with \`>/dev/null\` constantly, so reading those as external
// files would refuse ordinary builds while protecting nothing. Real devices such
// as \`/dev/disk0\` are deliberately not listed.
const DISCARD_DEVICES = new Set([
  "/dev/null",
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/tty",
  "/dev/console",
]);

const isDiscardDevice = (target) =>
  DISCARD_DEVICES.has(target) || target.startsWith("/dev/fd/");

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
    // A newline ends a command the same way \`;\` does. Treating it as ordinary
    // whitespace made every line after the first read as operands of the first
    // line's verb, which hid the destructive verbs in a shell script.
    if (char === "\\n" || char === "\\r") {
      flush();
      items.push({ kind: OPERATOR, value: ";" });
      continue;
    }
    if (/\\s/.test(char)) {
      flush();
      continue;
    }
    // Operators keep their spelling: a \`cd\` only outlives its segment when the
    // separator that ends it runs in the same shell, and \`(\`/\`)\` bound a subshell
    // whose directory changes die with it.
    if (char === ";" || char === "&" || char === "|" || char === "(" || char === ")") {
      flush();
      items.push({ kind: OPERATOR, value: char });
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

// The script a nested shell was handed, or \`undefined\` if it was not given one.
// Short flags cluster, so \`bash -lc "…"\` carries its script exactly like
// \`bash -c "…"\` does; matching \`-c\` exactly let the clustered spelling through.
const nestedShellScript = (operands) => {
  for (let index = 0; index < operands.length; index += 1) {
    const word = operands[index];
    if (!word.startsWith("-") || word.startsWith("--")) continue;
    if (!word.includes("c")) continue;
    return operands[index + 1];
  }
  return undefined;
};

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

// The shell tool carries its own working directory, and the command runs there
// rather than in the session cwd. Resolving relative paths against the worktree
// instead would read \`rm -rf .\` in a sibling checkout as an in-worktree delete.
const toolWorkdir = payload?.tool_input?.workdir ?? payload?.tool_input?.cwd;
const startDir =
  typeof toolWorkdir === "string" && toolWorkdir.length > 0
    ? resolve(worktree, expandPath(toolWorkdir))
    : worktree;

const describe = (verb, target) =>
  \`GedCode worker tripwire: refusing "\${verb}" on \${target}, which is outside this task worktree (\${worktree}). Keep destructive changes inside the worktree, and ask the PM if an external change is genuinely required.\`;

// The one place that decides whether a target is fair game, so the redirect,
// verb, and patch paths cannot drift apart. Returns the canonical path when the
// target is external and must be refused, and \`null\` when it is allowed.
const externalTarget = (resolved) => {
  const canonical = canonicalize(resolved);
  if (isInside(worktree, canonical)) return null;
  // Both spellings are checked: \`/dev/stdout\` canonicalizes to whatever the
  // hook's own descriptor points at, which is not a device path at all.
  if (isDiscardDevice(resolved) || isDiscardDevice(canonical)) return null;
  if (isExternalMaintenance(canonical)) return null;
  return canonical;
};

const inspectCommand = (input, startDir, depth) => {
  if (depth > 3) return null;
  // Each segment keeps the operator that ends it, because that operator decides
  // whether the segment's directory change survives into the next one.
  const segments = [{ words: [], separator: "" }];
  for (const item of tokenize(input)) {
    if (item.kind === OPERATOR) {
      segments[segments.length - 1].separator = item.value;
      segments.push({ words: [], separator: "" });
      continue;
    }
    segments[segments.length - 1].words.push(item.value);
  }

  let current = startDir;
  // Directories to restore: one entry per open subshell, one per \`pushd\`. Reading
  // a single running directory instead treated \`(cd /elsewhere && ls)\` as moving
  // the worker for good, so the next \`rm -rf dist\` looked like an external delete.
  const subshells = [];
  const pushed = [];
  for (const segment of segments) {
    const { words: segmentWords, separator } = segment;
    // A directory change inside a pipeline stage runs in that stage's own shell,
    // so it is gone by the time the next segment runs.
    const transient = separator === "|";

    // A lone \`>\` truncates its target before the command even runs, whatever the
    // command is. \`>>\` appends, which adds to a file instead of destroying it.
    for (let index = 0; index + 1 < segmentWords.length; index += 1) {
      if (segmentWords[index] !== ">") continue;
      const target = externalTarget(resolve(current, expandPath(segmentWords[index + 1])));
      if (target !== null) return describe(">", target);
    }

    const words = dropWrappers(segmentWords);
    const verb = words.length === 0 ? "" : basename(words[0]);
    const operands = words.slice(1);

    if (verb === "cd" || verb === "pushd") {
      const target = operands.find((word) => !word.startsWith("-"));
      if (target !== undefined && !transient) {
        if (verb === "pushd") pushed.push(current);
        current = resolve(current, expandPath(target));
      }
    } else if (verb === "popd") {
      const restored = pushed.pop();
      if (restored !== undefined && !transient) current = restored;
    } else if (NESTED_SHELLS.has(verb)) {
      const nested = nestedShellScript(operands);
      if (nested !== undefined) {
        const reason = inspectCommand(nested, current, depth + 1);
        if (reason !== null) return reason;
      }
    } else if (DESTRUCTIVE_VERBS.has(verb)) {
      for (const candidate of candidateTargets(operands)) {
        const target = externalTarget(resolve(current, expandPath(candidate)));
        if (target !== null) return describe(verb, target);
      }
    }

    // \`(\` opens a subshell after this segment; \`)\` closes the innermost one and
    // puts its caller's directory back.
    if (separator === "(") {
      subshells.push(current);
    } else if (separator === ")") {
      const restored = subshells.pop();
      if (restored !== undefined) current = restored;
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
    const target = externalTarget(resolve(worktree, expandPath(matched[1].trim())));
    if (target !== null) return describe("apply_patch", target);
  }
  return null;
};

const reason =
  payload?.tool_name === "apply_patch"
    ? inspectPatch(command)
    : inspectCommand(command, startDir, 0);
if (reason !== null) deny(reason);
allow();
`;
