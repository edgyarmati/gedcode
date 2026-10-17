# Permission modes

Permission modes control when an agent needs your approval to act. Choose a mode in the message
composer; it applies to that thread.

Set the default for new threads in **Settings → General → New threads → Permissions**. Projects can
override the environment default. The initial default is **Full access**; existing threads keep their
permissions.

| Mode                  | Behavior                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Supervised**        | Requests approval for commands and file changes.                                      |
| **Auto-accept edits** | Approves file edits automatically; other actions can still require approval.          |
| **Auto**              | Uses the provider's automatic review to approve routine actions and ask about others. |
| **Full access**       | Allows commands and edits without approval prompts.                                   |

Approve or reject requests in the conversation to let the agent continue. Permission modes do not
prevent the agent from asking questions about the task.

## Provider differences

Providers enforce permissions differently. Some read-only actions can proceed in **Supervised**.

- **Auto** uses automatic review on Codex, Claude, Cursor and Grok. Providers without an equivalent,
  including OpenCode and Antigravity, fall back to asking.
- Muse Code offers only **Supervised** and **Full access**.
- Grok offers no **Auto-accept edits**; such a thread runs in **Supervised**. Its file-change approvals
  offer **Allow all edits this session**.
- ACP agents run their own tools in their own mode; GedCode answers their approval requests according
  to the permission mode.
- Antigravity can still send native approval requests in **Full access**.
- OpenCode's **Allow for workspace** covers matching requests in other OpenCode sessions in the same
  workspace. Use **Allow once** for a single request.

See [Providers](./providers.md) for setup.
