# Keybindings

GedCode reads user keybindings from:

- `~/.gedcode/userdata/keybindings.json`

The file must be a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

See the full schema in [`packages/contracts/src/keybindings.ts`](packages/contracts/src/keybindings.ts).

## Defaults

```json
[
  { "key": "mod+j", "command": "terminal.toggle" },
  { "key": "mod+d", "command": "terminal.split", "when": "terminalFocus" },
  { "key": "mod+n", "command": "terminal.new", "when": "terminalFocus" },
  { "key": "mod+w", "command": "terminal.close", "when": "terminalFocus" },
  { "key": "mod+d", "command": "diff.toggle", "when": "!terminalFocus" },
  { "key": "mod+k", "command": "commandPalette.toggle", "when": "!terminalFocus" },
  { "key": "mod+n", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+o", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+n", "command": "chat.newLocal", "when": "!terminalFocus" },
  { "key": "mod+shift+m", "command": "modelPicker.toggle", "when": "!terminalFocus" },
  { "key": "mod+o", "command": "editor.openFavorite" },
  { "key": "mod+shift+[", "command": "thread.previous" },
  { "key": "mod+shift+]", "command": "thread.next" },
  { "key": "mod+1", "command": "thread.jump.1" },
  { "key": "mod+2", "command": "thread.jump.2" },
  { "key": "mod+3", "command": "thread.jump.3" },
  { "key": "mod+4", "command": "thread.jump.4" },
  { "key": "mod+5", "command": "thread.jump.5" },
  { "key": "mod+6", "command": "thread.jump.6" },
  { "key": "mod+7", "command": "thread.jump.7" },
  { "key": "mod+8", "command": "thread.jump.8" },
  { "key": "mod+9", "command": "thread.jump.9" },
  { "key": "mod+1", "command": "modelPicker.jump.1", "when": "modelPickerOpen" },
  { "key": "mod+2", "command": "modelPicker.jump.2", "when": "modelPickerOpen" },
  { "key": "mod+3", "command": "modelPicker.jump.3", "when": "modelPickerOpen" },
  { "key": "mod+4", "command": "modelPicker.jump.4", "when": "modelPickerOpen" },
  { "key": "mod+5", "command": "modelPicker.jump.5", "when": "modelPickerOpen" },
  { "key": "mod+6", "command": "modelPicker.jump.6", "when": "modelPickerOpen" },
  { "key": "mod+7", "command": "modelPicker.jump.7", "when": "modelPickerOpen" },
  { "key": "mod+8", "command": "modelPicker.jump.8", "when": "modelPickerOpen" },
  { "key": "mod+9", "command": "modelPicker.jump.9", "when": "modelPickerOpen" }
]
```

For the most up to date defaults, see
[`DEFAULT_KEYBINDINGS` in `packages/shared/src/keybindings.ts`](packages/shared/src/keybindings.ts).

## Configuration

### Rule Shape

Each entry supports:

- `key` (required): shortcut string, like `mod+j`, `ctrl+k`, or `cmd+shift+d`
- `command` (required): action ID
- `when` (optional): boolean expression controlling when the shortcut is active

Invalid rules are ignored. Invalid config files are ignored. Warnings are logged by the server.

### Available Commands

- `terminal.toggle`: open or close the terminal drawer
- `terminal.split`: split the focused terminal
- `terminal.new`: create a new terminal in the focused terminal context
- `terminal.close`: close the focused terminal
- `diff.toggle`: open or close the changed-files diff view
- `commandPalette.toggle`: open or close the global command palette
- `chat.new`: create a new chat thread preserving the active thread's branch/worktree state
- `chat.newLocal`: create a new chat thread for the active project in a new environment
- `editor.openFavorite`: open the current project/worktree in the last-used editor
- `thread.previous`: move to the previous thread
- `thread.next`: move to the next thread
- `thread.jump.1` through `thread.jump.9`: jump to a numbered thread slot
- `modelPicker.toggle`: open or close the model picker
- `modelPicker.jump.1` through `modelPicker.jump.9`: jump to a numbered model/provider slot while the model picker is open
- `script.{id}.run`: run a project script by id, for example `script.test.run`

### Key Syntax

Supported modifiers:

- `mod` (`cmd` on macOS, `ctrl` on non-macOS)
- `cmd` / `meta`
- `ctrl` / `control`
- `shift`
- `alt` / `option`

Examples:

- `mod+j`
- `mod+shift+d`
- `ctrl+l`
- `cmd+k`

### `when` Conditions

Available context keys:

- `terminalFocus`
- `terminalOpen`
- `modelPickerOpen`
- `true`
- `false`

Supported operators:

- `!` (not)
- `&&` (and)
- `||` (or)
- parentheses: `(` `)`

Examples:

- `"when": "terminalFocus"`
- `"when": "terminalOpen && !terminalFocus"`
- `"when": "terminalFocus || modelPickerOpen"`
- `"when": "true"`

Unknown condition keys evaluate to `false`.

### Precedence

- Rules are evaluated in array order.
- For a key event, the last rule where both `key` matches and `when` evaluates to `true` wins.
- Precedence is across commands, not only within the same command.

The default `mod+1` through `mod+9` bindings intentionally use this precedence. Thread jump
bindings handle those keys normally, while model-picker jump bindings take over when
`modelPickerOpen` is true.
