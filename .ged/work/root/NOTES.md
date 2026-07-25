# Notes

> Handoff notes for cross-session context.

## WORKER-TRIPWIRE-01 — narrow Codex hook trust proof (2026-07-25)

Outcome: **narrow trust is provable**, so `WORKER-TRIPWIRE-02` is unblocked. Verified against
`codex-cli 0.145.0` on macOS with runtime fixtures (temporary `CODEX_HOME`, temporary git project,
server-owned hook script outside the project).

### What Codex exposes

`hooks/list` over `codex app-server` reports every discovered hook with `source`, `sourcePath`, `key`,
`currentHash`, `enabled`, `isManaged`, and `trustStatus`. Trust is keyed to the hook's sha256 hash and
read from config key `hooks.state."<hook key>"` (`trusted_hash`, `enabled`). There is no `hooks/trust`
request; the app-server surface is read-only for trust. Managed hooks come only from enterprise policy
(`/etc/codex/requirements.toml`), which is host-wide and therefore rejected here.

### Proven mechanism

The hook is delivered entirely through per-invocation config overrides, so nothing is written into the
task worktree and nothing is persisted to the user's Codex home:

```
codex -c 'hooks.PreToolUse=[{ matcher = "*", hooks = [{ type = "command", command = "<server-owned script>" }] }]' \
      -c 'hooks.state={ "/<session-flags>/config.toml:pre_tool_use:0:0" = { trusted_hash = "sha256:…", enabled = true } }' \
      …
```

- Session-flag hooks report `source: "sessionFlags"` and the stable key
  `/<session-flags>/config.toml:pre_tool_use:0:0` — independent of the project path.
- `currentHash` was identical across repeated runs, but it covers the hook definition (including the
  absolute script path), so it must be discovered per script/path via one short-lived `hooks/list`
  probe rather than hardcoded.
- Only `hooks.PreToolUse` is accepted for this shape. `hooks.pre_tool_use` and `hooks.hooks.PreToolUse`
  silently discover no hook.
- A dotted-path override (`-c hooks.state."<key>".trusted_hash=…`) does not work; the whole
  `hooks.state` table must be supplied as one inline TOML value.

### Isolation and blast radius

With the override above applied while an unrelated **user-scope** `PostToolUse` hook also existed:

```
HOOK {"source":"user","event":"postToolUse","trustStatus":"untrusted","isManaged":false}
HOOK {"source":"sessionFlags","event":"preToolUse","trustStatus":"trusted","isManaged":false}
```

- Exactly the server-owned hook became `trusted`; the unrelated hook kept its normal `untrusted` state.
- The fixture `CODEX_HOME/config.toml` was unchanged afterwards — `-c` persists nothing.
- The fixture project's worktree stayed clean (`git status --porcelain` empty).
- No `--dangerously-bypass-hook-trust`, `--dangerously-bypass-approvals-and-sandbox`, or managed-hook
  policy was used at any point.

### End-to-end A/B on a real turn

Same prompt (`/bin/echo gedcode-tripwire-probe`) under `-s danger-full-access`, hook script exiting 2
with a reason on stderr:

- **Control** (hook present, no trust override): command ran normally, hook never executed, no review
  prompt — an untrusted hook is silently skipped.
- **Test** (narrow hash trust added): `hook: PreToolUse` →
  `error=Command blocked by PreToolUse hook: GedCode tripwire: denied for the proof run.` →
  `hook: PreToolUse Blocked`, and the agent reported the block. One denial, no approval loop, no
  permission request re-entering the PM.

### Implications for WORKER-TRIPWIRE-02

- The hook script and its definition both live outside the task worktree, so the guardrail cannot
  pollute a task diff or the verification land gate (unlike `.gedcode-hooks/`, which needs an
  info/exclude entry).
- Worker sessions are spawned in `apps/server/src/provider/Layers/CodexSessionRuntime.ts` with
  `["app-server"]`; global `-c` flags must precede the subcommand.
- The per-script `hooks/list` hash probe is the only added startup cost and can be cached for the
  server process lifetime.
- Scripts, opaque subprocesses, and tools that opt out of `PreToolUse` remain outside the guardrail;
  it stays best-effort accident prevention, never filesystem isolation.
