# Tasks

## ged-thread-workflow-toggle

1. [x] Add a per-thread `gedWorkflowEnabled` contract/projection field with historical defaults.
2. [x] Add composer draft storage/actions for a workflow override and new-draft inheritance.
3. [x] Wire ChatView to derive/toggle per-chat workflow state and send it through thread creation/meta/turn commands.
4. [x] Make Ged enforcement consult the projected thread workflow setting for each send.
5. [x] Add focused contract/store/server tests.
6. [x] Run `bun fmt`, `bun lint`, `bun typecheck`, and targeted `bun run test` suites.
7. [x] Commit with a conventional commit after verification.
