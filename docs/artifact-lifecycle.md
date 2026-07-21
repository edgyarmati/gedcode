# GedCode Artifact Lifecycle

GedCode uses three similarly named locations for different purposes. The short version is:

| Location                | Owner                             | Purpose                                                                                                 | Put in Git?                                               |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `<workspace>/.ged/`     | The coding agent and project team | Human-readable GED workflow memory and plans                                                            | Usually the durable files; follow the repository's policy |
| `<workspace>/.gedcode/` | The Orchestrator runtime          | Task worktrees, safety hooks, and worktree leases                                                       | No                                                        |
| `~/.gedcode/`           | The GedCode application           | User settings, conversation/task state, logs, attachments, caches, secrets, and ordinary chat worktrees | No                                                        |

`<workspace>` means the root directory of the project being worked on. The user-data root defaults to
`~/.gedcode`; `T3CODE_HOME` or `--base-dir` can move it elsewhere.

## Workspace `.ged/`: GED Workflow Memory

Enabling GED mode changes the instructions sent to the selected chat model. It does not create files by
itself. For non-trivial work, the instructed agent uses the installed GED skills to create or refresh:

```text
.ged/
└── work/root/
    ├── SPEC.md    # agreed scope, decisions, and acceptance criteria
    ├── TASKS.md   # ordered, bounded implementation slices and their status
    ├── TESTS.md   # verification plan and recorded evidence
    └── STATE.md   # current phase, active slice, and resume checkpoint
```

Repositories that use the current project-context workflow may also contain `.ged/PROJECT.md`,
`.ged/ARCHITECTURE.md`, root `CONTEXT.md`, sparse `docs/adr/*.md`, or named directories below
`.ged/work/`. Older repositories can still contain legacy files such as `.ged/DECISIONS.md`; new
workflow runs do not create that file. These are project documents, not application state.
`.ged/runtime/` is intended for ephemeral session checkpoints and should normally be ignored.

Current repositories also commit `.ged/MANIFEST.json`. Its `schemaVersion` is the single
machine-readable version for GED context, planning, ownership, and lifecycle conventions;
`updatedAt`, `lastReviewedAt`, and `generatedBy` provide audit context. Legacy `.ged/VERSION` is read
only for one-time migration and is removed after successful adoption. GedCode never downgrades a
manifest written by a newer schema.

- **Created when:** an agent follows GED planning/execution guidance for a non-trivial task. A normal
  chat or merely switching the selector to GED does not eagerly create it.
- **Lifetime and cleanup:** project-owned. Keep active documents while they help a future turn resume;
  archive or delete obsolete named work directories during normal repository maintenance.
- **Commit guidance:** commit durable context, decisions, specs, task status, and verification evidence
  when the team wants them shared. Ignore runtime/session scratch files. The repository's own policy
  takes precedence.
- **Privacy:** the selected model can read these files. Do not put API keys, credentials, private
  transcripts, or secrets in `.ged/`.

## Workspace `.gedcode/`: Orchestrator Runtime

The Orchestrator creates isolated Git worktrees inside the project instead of letting worker stages edit
the primary checkout directly:

```text
.gedcode/
└── orchestrator/
    ├── tasks/<task-id>/                 # linked Git worktree for one task
    │   └── .gedcode-hooks/pre-push      # blocks direct pushes to protected branches
    └── task-worktree-leases/<task-id>.json
```

- **Created when:** a task needs its worktree. The safety hook is installed when a worker provider is
  started; the runtime renews the matching lease while the task owns the worktree.
- **Lifetime and cleanup:** GedCode removes the worktree and lease after a task is abandoned, or after
  landing has successfully produced its pull request. Startup reconciliation also cleans terminal
  worktrees. An orphan reaper uses leases plus a grace period (30 minutes by default) so another live
  runtime is not mistaken for abandoned work.
- **Commit guidance:** always ignore the entire workspace `.gedcode/` directory. It contains linked
  worktree administration and duplicated checkout files, not source artifacts.
- **Operator guidance:** do not rename, move, or delete a live task worktree manually. Stop GedCode and
  settle/cancel the task first. Manual deletion can leave Git worktree metadata behind.
- **Privacy:** task worktrees contain a full checkout and any uncommitted worker changes. They inherit
  the sensitivity of the repository.

## User `~/.gedcode/`: Application State

Fresh production installs use `~/.gedcode/userdata/`. Development builds use `~/.gedcode/dev/` so they
do not overwrite production state. The important entries are:

| Path                                                                                                    | Created/updated when                                     | Contents and cleanup owner                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `userdata/state.sqlite`                                                                                 | The server starts and domain events are recorded         | Conversation, project, task, orchestration, and projection state. GedCode owns schema migration and record lifecycle.                    |
| `userdata/settings.json`                                                                                | Server settings change                                   | Server/provider/orchestrator configuration. GedCode updates it; back it up before manual edits.                                          |
| `userdata/client-settings.json`, `desktop-settings.json`, `saved-environments.json`, `keybindings.json` | The corresponding desktop/web setting changes            | User preferences and saved environment endpoints. GedCode owns them.                                                                     |
| `userdata/attachments/`                                                                                 | A persisted message contains an image/file attachment    | Attachment payloads referenced by stored messages. Thread deletion can remove unreferenced files; do not prune while the app is running. |
| `userdata/logs/`                                                                                        | Server, provider, terminal, or tracing output is emitted | Operational logs and traces. Rotation is app-managed where configured; old logs may be deleted while GedCode is stopped.                 |
| `userdata/secrets/`                                                                                     | A local bootstrap/session secret is needed               | Binary authentication material. The server creates this directory with owner-only permissions where supported. Never commit or share it. |
| `userdata/environment-id`, `server-runtime.json`                                                        | The environment/server is initialized or starts          | Stable environment identity and current runtime discovery information. Deleting them changes reconnection behavior.                      |
| `caches/`                                                                                               | Provider availability/version checks run                 | Rebuildable provider status data. Safe to remove while GedCode is stopped.                                                               |
| `worktrees/`                                                                                            | A normal chat creates an optional branch worktree        | User chat worktrees, separate from Orchestrator task worktrees. Remove them through GedCode/Git when possible.                           |
| `ssh-launch/`                                                                                           | An SSH environment is launched                           | Per-remote launch state used to find and manage the remote server. Remove only after stopping the corresponding remote process.          |

The development equivalents live below `~/.gedcode/dev/` rather than `userdata/`.

### Backup, Reset, and Privacy

- Quit GedCode and stop any headless/remote server before copying, restoring, or deleting application
  state. SQLite and live worktrees are not safe to reset underneath a running process.
- Back up `state.sqlite` together with its SQLite sidecar files, settings, secrets, and attachments if a
  complete restore is required.
- Logs, traces, provider event logs, terminal logs, attachments, and the database can contain prompts,
  source snippets, file paths, command output, remote addresses, and model metadata. Treat the whole
  directory as private application data.
- To perform a full local reset, move the user-data root aside while GedCode is stopped, then start the
  app and verify the fresh state before deleting the backup. Moving it aside is safer than immediately
  deleting it.

## Similar Names, Different Cleanup Rules

Do not use one cleanup rule for all three locations. `.ged/` is inspectable project documentation;
workspace `.gedcode/` is short-lived Orchestrator infrastructure; user `~/.gedcode/` is the durable
application database and configuration root.
