// Server-owned Codex `PreToolUse` tripwire for orchestrator workers.
//
// Workers run with full access (see `workerSafety.ts`), so this is not a
// security boundary and never pretends to be one: it is best-effort accident
// prevention that rejects clearly destructive operations whose explicit target
// resolves outside the worker's task worktree, plus any of them aimed at the
// host's signed-in credentials and CLI state wherever they run.
//
// What it does not see — deliberately, and worth knowing before trusting it:
//
//   - Targets the command does not spell out: `xargs rm` reading paths from
//     stdin, `apply_patch < patch`, a path assembled by command substitution or
//     an unset variable.
//   - Anything inside a script, an interpreter, a Makefile, or any other opaque
//     subprocess, and any tool that opts out of hooks.
//   - Destructive git operations that rewrite a checkout without naming a path
//     (`git reset --hard`, `git checkout -- .`) — they are ordinary worker work
//     in the worktree and are not distinguished elsewhere.
//   - Writes under the allowlisted maintenance locations (temporary dirs, the
//     usual package/tool caches, `node_modules`), which are treated as
//     disposable so ordinary builds and installs are not refused.
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

// Credentials and signed-in tool state. Workers inherit the host environment, and
// the maintenance allowlist opens \`~/.config\` and \`~/.local\` wide, so losing an
// SSH key or a logged-in CLI would otherwise read as ordinary cache pruning.
const PROTECTED_ROOTS = [
  ".ssh",
  ".aws",
  ".azure",
  ".netrc",
  ".gitconfig",
  ".git-credentials",
  ".config/gh",
  ".config/git",
  ".config/gcloud",
  ".config/op",
  ".local/share/keyrings",
  ".codex",
  ".claude",
  ".kube",
  ".docker",
  ".gnupg",
  ".password-store",
].map((entry) => canonicalize(join(home, ...entry.split("/"))));

// A parent counts too: \`rm -rf ~/.config\` takes every signed-in CLI with it.
const isProtected = (target) =>
  PROTECTED_ROOTS.some((root) => isInside(root, target) || isInside(target, root));

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

const VARIABLE_REFERENCE = /\\$(?:\\{([A-Za-z_][A-Za-z0-9_]*)\\}|([A-Za-z_][A-Za-z0-9_]*))/g;

// Workers inherit the host environment, so a variable in a path is as explicit as
// the literal it stands for. \`HOME\` and \`TMPDIR\` fall back to the process values
// because the shell would resolve them even when they are absent from the
// environment we were handed.
const variableValue = (name) => {
  if (name === "HOME") return home;
  if (name === "TMPDIR") return tmpdir();
  return process.env[name];
};

// The shell expands home and variable references before the command runs, so the
// tripwire has to expand them too or it would read \`~/Documents\` as a
// worktree-relative path and wave it through. A variable this process cannot
// resolve is left as written: it names no path the tripwire can judge, and
// rewriting it would invent one.
const expandPath = (token) => {
  const expanded = token.replace(VARIABLE_REFERENCE, (whole, braced, bare) => {
    const value = variableValue(braced ?? bare);
    return value === undefined || value.length === 0 ? whole : value;
  });
  if (expanded === "~") return home;
  if (expanded.startsWith("~/")) return join(home, expanded.slice(2));
  return expanded;
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

// Verbs that write every path they are handed, without deleting anything first.
const OVERWRITE_VERBS = new Set(["tee"]);

// Copies, links, and syncs overwrite only their destination. Their other operands
// are read, and judging those would refuse ordinary vendoring out of the host.
const DESTINATION_VERBS = new Set(["cp", "install", "ln", "rsync", "scp"]);

const TARGET_DIRECTORY_FLAG = /^(?:-t|--target-directory)(?:=(.*))?$/;

// \`sed\` rewrites its operands only in place; \`-i\` clusters with other short flags
// and carries an optional backup suffix (\`-i.bak\`, \`-Ei\`).
const IN_PLACE_FLAG = /^(?:--in-place(?:=.*)?|-[A-Za-z]*i.*)$/;

// With an explicit script flag every operand is a file; without one the first
// operand is the script itself.
const SED_SCRIPT_FLAG = /^(?:-[A-Za-z]*[ef]|--expression|--file)(?:=.*)?$/;

// \`find\` actions that destroy what they match.
const FIND_ACTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

// Git subcommands that discard files in the working tree they run against.
const GIT_DESTRUCTIVE_SUBCOMMANDS = new Set(["clean", "rm"]);

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

// The words a destructive verb acts on. Flags carry options rather than targets —
// reading \`--reference=/etc/passwd\` as one invented a path the command only reads.
// \`dd\`-style \`key=value\` operands are not flags and do name targets, except \`if=\`,
// which names the source a command reads.
const candidateTargets = (words) => {
  const candidates = [];
  for (const word of words) {
    if (word.startsWith("-")) continue;
    const separator = word.indexOf("=");
    if (separator > 0) {
      if (word.slice(0, separator) !== "if") candidates.push(word.slice(separator + 1));
      continue;
    }
    candidates.push(word);
  }
  return candidates;
};

// Operands that are not flags. A flag's separately passed value (\`-m 644\`) looks
// like a positional here; it resolves inside the worktree and costs nothing.
const positionalOperands = (operands) => {
  const positionals = [];
  let terminated = false;
  for (const word of operands) {
    if (!terminated && word === "--") {
      terminated = true;
      continue;
    }
    if (!terminated && word.length > 1 && word.startsWith("-")) continue;
    if (word.length > 0) positionals.push(word);
  }
  return positionals;
};

// The one operand a copy or sync writes: an explicit target directory if given,
// otherwise the last one. A lone operand is a source whose destination is the
// current directory, so it destroys nothing outside the worktree.
const destinationTargets = (operands) => {
  for (let index = 0; index < operands.length; index += 1) {
    const matched = TARGET_DIRECTORY_FLAG.exec(operands[index]);
    if (matched === null) continue;
    const value = matched[1] ?? operands[index + 1];
    return value === undefined ? [] : [value];
  }
  const positionals = positionalOperands(operands);
  return positionals.length < 2 ? [] : [positionals[positionals.length - 1]];
};

const sedTargets = (operands) => {
  if (!operands.some((word) => IN_PLACE_FLAG.test(word))) return [];
  const positionals = positionalOperands(operands);
  return operands.some((word) => SED_SCRIPT_FLAG.test(word)) ? positionals : positionals.slice(1);
};

const findTargets = (operands) => {
  const destroys = operands.some((word, index) => {
    if (word === "-delete") return true;
    if (!FIND_ACTIONS.has(word)) return false;
    const invoked = operands[index + 1];
    return invoked !== undefined && DESTRUCTIVE_VERBS.has(basename(invoked));
  });
  if (!destroys) return [];
  // \`find\`'s expression begins at its first operator, so the paths it walks are
  // the operands before that.
  const paths = [];
  for (const word of operands) {
    if (word.startsWith("-")) break;
    paths.push(word);
  }
  return paths;
};

// Only the tree git runs against is judged. Pathspecs are repo-relative and git
// refuses ones outside the repo, so the working tree's location answers it.
const gitTargets = (operands) => {
  let index = 0;
  let directory;
  while (index < operands.length) {
    const word = operands[index];
    if (word === "-C") {
      directory = operands[index + 1];
      index += 2;
      continue;
    }
    if (word.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  const subcommand = operands[index];
  if (subcommand === undefined || !GIT_DESTRUCTIVE_SUBCOMMANDS.has(subcommand)) return [];
  return [directory ?? "."];
};

// The operands a verb can destroy, or nothing when the verb is not one the
// tripwire judges.
const destructiveTargets = (verb, operands) => {
  if (DESTRUCTIVE_VERBS.has(verb) || OVERWRITE_VERBS.has(verb)) return candidateTargets(operands);
  if (DESTINATION_VERBS.has(verb)) return destinationTargets(operands);
  if (verb === "sed") return sedTargets(operands);
  if (verb === "find") return findTargets(operands);
  if (verb === "git") return gitTargets(operands);
  return [];
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
  isProtected(target)
    ? \`GedCode worker tripwire: refusing "\${verb}" on \${target}, which holds host credentials or signed-in tool state. Nothing in the task requires destroying it; ask the PM if you believe otherwise.\`
    : \`GedCode worker tripwire: refusing "\${verb}" on \${target}, which is outside this task worktree (\${worktree}). Keep destructive changes inside the worktree, and ask the PM if an external change is genuinely required.\`;

// The one place that decides whether a target is fair game, so the redirect,
// verb, and patch paths cannot drift apart. Returns the canonical path when the
// target is external and must be refused, and \`null\` when it is allowed.
const externalTarget = (resolved) => {
  const canonical = canonicalize(resolved);
  if (isInside(worktree, canonical)) return null;
  // Both spellings are checked: \`/dev/stdout\` canonicalizes to whatever the
  // hook's own descriptor points at, which is not a device path at all.
  if (isDiscardDevice(resolved) || isDiscardDevice(canonical)) return null;
  // Checked before the allowlist, which would otherwise wave through everything
  // under \`~/.config\` and \`~/.local\`.
  if (isProtected(canonical)) return canonical;
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
    } else if (verb === "apply_patch") {
      // Codex also drives \`apply_patch\` through the shell, usually with the patch
      // inline in a heredoc. The body is scanned as a patch, not as shell words.
      const reason = inspectPatch(input, current);
      if (reason !== null) return reason;
    } else if (NESTED_SHELLS.has(verb)) {
      const nested = nestedShellScript(operands);
      if (nested !== undefined) {
        const reason = inspectCommand(nested, current, depth + 1);
        if (reason !== null) return reason;
      }
    } else {
      for (const candidate of destructiveTargets(verb, operands)) {
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

const inspectPatch = (patch, base) => {
  for (const line of patch.split(/\\r?\\n/)) {
    const matched = PATCH_TARGET.exec(line.trim());
    if (matched === null) continue;
    const target = externalTarget(resolve(base, expandPath(matched[1].trim())));
    if (target !== null) return describe("apply_patch", target);
  }
  return null;
};

const reason =
  payload?.tool_name === "apply_patch"
    ? inspectPatch(command, worktree)
    : inspectCommand(command, startDir, 0);
if (reason !== null) deny(reason);
allow();
`;
