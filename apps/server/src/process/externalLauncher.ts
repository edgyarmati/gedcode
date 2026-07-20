/**
 * ExternalLauncher - external application launch service interface.
 *
 * Owns process launch helpers for browser URLs and workspace paths
 * in configured editor integrations.
 *
 * @module ExternalLauncher
 */
import {
  EDITORS,
  ExternalLauncherError,
  type EditorId,
  type LaunchEditorInput,
} from "@t3tools/contracts";
import { isCommandAvailable, type CommandAvailabilityOptions } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

// ==============================
// Definitions
// ==============================

export { ExternalLauncherError };
export type { LaunchEditorInput };
export { isCommandAvailable } from "@t3tools/shared/shell";

interface EditorLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface ExternalProcessLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ChildProcess.CommandOptions;
}

export type ExternalLaunchOperation = "editor" | "file-manager" | "terminal";

interface TerminalLauncher {
  readonly command: string;
  readonly args: (cwd: string) => ReadonlyArray<string>;
}

/**
 * Launch capabilities that are meaningful on the server host. Callers can
 * use these to keep unavailable workspace actions out of their UI rather
 * than discovering the absence by attempting to spawn a process.
 */
export interface ExternalLauncherAvailability {
  readonly editors: ReadonlyArray<EditorId>;
  readonly fileManager: boolean;
  readonly terminal: boolean;
}

/** A requested workspace action has no compatible launcher on this host. */
export class ExternalLauncherUnsupportedError extends Data.TaggedError(
  "ExternalLauncherUnsupportedError",
)<{
  readonly operation: ExternalLaunchOperation;
  readonly message: string;
}> {}

/** A compatible launcher was resolved but its detached process could not start. */
export class ExternalProcessLaunchError extends Data.TaggedError("ExternalProcessLaunchError")<{
  readonly operation: ExternalLaunchOperation;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type ExternalWorkspaceLaunchError =
  | ExternalLauncherUnsupportedError
  | ExternalProcessLaunchError;

interface TargetPathAndPosition {
  readonly path: string;
  readonly line: string;
  readonly column: Option.Option<string>;
}

const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;
const POWERSHELL_ARGUMENTS_PREFIX = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
] as const;

const DETACHED_IGNORE_STDIO_OPTIONS = {
  detached: true,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
} as const satisfies ChildProcess.CommandOptions;

function parseTargetPathAndPosition(target: string): Option.Option<TargetPathAndPosition> {
  const match = TARGET_WITH_POSITION_PATTERN.exec(target);
  if (!match?.[1] || !match[2]) {
    return Option.none();
  }

  return Option.some({
    path: match[1],
    line: match[2],
    column: Option.fromUndefinedOr(match[3]),
  });
}

function resolveCommandEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const parsedTarget = parseTargetPathAndPosition(target);

  switch (editor.launchStyle) {
    case "direct-path":
      return [target];
    case "goto":
      return Option.isSome(parsedTarget) ? ["--goto", target] : [target];
    case "line-column":
      return Option.match(parsedTarget, {
        onNone: () => [target],
        onSome: ({ path, line, column }) => [
          "--line",
          line,
          ...Option.match(column, {
            onNone: () => [],
            onSome: (value) => ["--column", value],
          }),
          path,
        ],
      });
  }
}

function resolveEditorArgs(
  editor: (typeof EDITORS)[number],
  target: string,
): ReadonlyArray<string> {
  const baseArgs = "baseArgs" in editor ? editor.baseArgs : [];
  return [...baseArgs, ...resolveCommandEditorArgs(editor, target)];
}

function resolveAvailableCommand(
  commands: ReadonlyArray<string>,
  options: CommandAvailabilityOptions = {},
): Option.Option<string> {
  for (const command of commands) {
    if (isCommandAvailable(command, options)) {
      return Option.some(command);
    }
  }
  return Option.none();
}

function encodeUtf16LeBase64(input: string): string {
  const bytes = new Uint8Array(input.length * 2);
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  return Encoding.encodeBase64(bytes);
}

function escapePowerShellStringLiteral(input: string): string {
  return `'${input.replaceAll("'", "''")}'`;
}

function resolvePowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  return `${env.SYSTEMROOT || env.windir || String.raw`C:\Windows`}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function resolveWslPowerShellPath(): string {
  return "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
}

function shouldUseWindowsBrowserFromWsl(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    platform === "linux" &&
    (env.WSL_DISTRO_NAME !== undefined || env.WSL_INTEROP !== undefined) &&
    env.SSH_CONNECTION === undefined &&
    env.SSH_TTY === undefined &&
    env.container === undefined
  );
}

function resolveWindowsBrowserLaunch(target: string, command: string): ExternalProcessLaunch {
  const encodedCommand = encodeUtf16LeBase64(
    `$ProgressPreference = 'SilentlyContinue'; Start ${escapePowerShellStringLiteral(target)}`,
  );
  return {
    command,
    args: [...POWERSHELL_ARGUMENTS_PREFIX, encodedCommand],
    options: {
      detached: true,
      shell: false,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  };
}

function fileManagerCommandForPlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "open";
    case "win32":
      return "explorer";
    default:
      return "xdg-open";
  }
}

const LINUX_TERMINAL_LAUNCHERS: ReadonlyArray<TerminalLauncher> = [
  { command: "x-terminal-emulator", args: (cwd) => ["--working-directory", cwd] },
  { command: "gnome-terminal", args: (cwd) => ["--working-directory", cwd] },
  { command: "konsole", args: (cwd) => ["--workdir", cwd] },
  { command: "xfce4-terminal", args: (cwd) => ["--working-directory", cwd] },
  { command: "mate-terminal", args: (cwd) => ["--working-directory", cwd] },
  { command: "tilix", args: (cwd) => ["--working-directory", cwd] },
  { command: "kitty", args: (cwd) => ["--directory", cwd] },
  { command: "alacritty", args: (cwd) => ["--working-directory", cwd] },
  { command: "wezterm", args: (cwd) => ["start", "--cwd", cwd] },
  { command: "foot", args: (cwd) => ["--working-directory", cwd] },
];

function resolveAvailableTerminalLauncher(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Option.Option<TerminalLauncher> {
  const candidates: ReadonlyArray<TerminalLauncher> =
    platform === "darwin"
      ? [{ command: "open", args: (cwd) => ["-a", "Terminal", cwd] }]
      : platform === "win32"
        ? [{ command: "wt", args: (cwd) => ["-d", cwd] }]
        : LINUX_TERMINAL_LAUNCHERS;

  return Option.fromUndefinedOr(
    candidates.find((candidate) => isCommandAvailable(candidate.command, { platform, env })),
  );
}

export function resolveBrowserLaunch(
  target: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ExternalProcessLaunch {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [target],
      options: DETACHED_IGNORE_STDIO_OPTIONS,
    };
  }

  if (platform === "win32") {
    return resolveWindowsBrowserLaunch(target, resolvePowerShellPath(env));
  }

  if (shouldUseWindowsBrowserFromWsl(platform, env)) {
    return resolveWindowsBrowserLaunch(target, resolveWslPowerShellPath());
  }

  return {
    command: "xdg-open",
    args: [target],
    options: DETACHED_IGNORE_STDIO_OPTIONS,
  };
}

export function resolveAvailableEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<EditorId> {
  const available: EditorId[] = [];

  for (const editor of EDITORS) {
    if (editor.commands === null) {
      const command = fileManagerCommandForPlatform(platform);
      if (isCommandAvailable(command, { platform, env })) {
        available.push(editor.id);
      }
      continue;
    }

    const command = resolveAvailableCommand(editor.commands, { platform, env });
    if (Option.isSome(command)) {
      available.push(editor.id);
    }
  }

  return available;
}

/**
 * Resolves host-side availability for every workspace launch surface. Editor
 * commands and the file manager remain separate so callers can present them
 * as distinct actions.
 */
export function resolveExternalLauncherAvailability(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ExternalLauncherAvailability {
  const editors: EditorId[] = [];

  for (const editor of EDITORS) {
    if (
      editor.commands &&
      Option.isSome(resolveAvailableCommand(editor.commands, { platform, env }))
    ) {
      editors.push(editor.id);
    }
  }

  return {
    editors,
    fileManager: isCommandAvailable(fileManagerCommandForPlatform(platform), { platform, env }),
    terminal: Option.isSome(resolveAvailableTerminalLauncher(platform, env)),
  };
}

/**
 * ExternalLauncherShape - Service API for browser and editor launch actions.
 */
export interface ExternalLauncherShape {
  /**
   * Launch a URL target in the default browser.
   */
  readonly launchBrowser: (target: string) => Effect.Effect<void, ExternalLauncherError>;

  /**
   * Launch a workspace path in a selected editor integration.
   *
   * Launches the editor as a detached process so server startup is not blocked.
   */
  readonly launchEditor: (input: LaunchEditorInput) => Effect.Effect<void, ExternalLauncherError>;

  /** Reveal a workspace directory in the host file manager. */
  readonly launchFileManager: (cwd: string) => Effect.Effect<void, ExternalWorkspaceLaunchError>;

  /** Open a host terminal rooted at the workspace directory. */
  readonly launchTerminal: (cwd: string) => Effect.Effect<void, ExternalWorkspaceLaunchError>;
}

/**
 * ExternalLauncher - Service tag for browser/editor launch operations.
 */
export class ExternalLauncher extends Context.Service<ExternalLauncher, ExternalLauncherShape>()(
  "gedcode/process/externalLauncher",
) {}

// ==============================
// Implementations
// ==============================

export const resolveEditorLaunch = Effect.fn("resolveEditorLaunch")(function* (
  input: LaunchEditorInput,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<EditorLaunch, ExternalLauncherError> {
  yield* Effect.annotateCurrentSpan({
    "externalLauncher.editor": input.editor,
    "externalLauncher.cwd": input.cwd,
    "externalLauncher.platform": platform,
  });
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return yield* new ExternalLauncherError({ message: `Unknown editor: ${input.editor}` });
  }

  if (editorDef.commands) {
    const command = Option.getOrElse(
      resolveAvailableCommand(editorDef.commands, { platform, env }),
      () => editorDef.commands[0],
    );
    return {
      command,
      args: resolveEditorArgs(editorDef, input.cwd),
    };
  }

  if (editorDef.id !== "file-manager") {
    return yield* new ExternalLauncherError({ message: `Unsupported editor: ${input.editor}` });
  }

  return { command: fileManagerCommandForPlatform(platform), args: [input.cwd] };
});

/**
 * Resolves a file-manager launch only when the host has a compatible opener.
 * Unlike the legacy editor resolver, this is strict so workspace actions can
 * report a disabled capability before attempting a process launch.
 */
export const resolveFileManagerLaunch = Effect.fn("resolveFileManagerLaunch")(function* (
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ExternalProcessLaunch, ExternalLauncherUnsupportedError> {
  const command = fileManagerCommandForPlatform(platform);
  if (!isCommandAvailable(command, { platform, env })) {
    return yield* new ExternalLauncherUnsupportedError({
      operation: "file-manager",
      message: `File manager launcher is unavailable: ${command}`,
    });
  }

  return {
    command,
    args: [cwd],
    options: DETACHED_IGNORE_STDIO_OPTIONS,
  };
});

/** Resolves a compatible terminal emulator for the given workspace path. */
export const resolveTerminalLaunch = Effect.fn("resolveTerminalLaunch")(function* (
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ExternalProcessLaunch, ExternalLauncherUnsupportedError> {
  const terminal = resolveAvailableTerminalLauncher(platform, env);
  if (Option.isNone(terminal)) {
    return yield* new ExternalLauncherUnsupportedError({
      operation: "terminal",
      message: `No supported terminal launcher is available for ${platform}`,
    });
  }

  return {
    command: terminal.value.command,
    args: terminal.value.args(cwd),
    options: DETACHED_IGNORE_STDIO_OPTIONS,
  };
});

/**
 * Strict editor resolution for workspace actions. Existing editor launch
 * callers retain their historical preferred-command fallback through
 * `resolveEditorLaunch`.
 */
export const resolveAvailableEditorLaunch = Effect.fn("resolveAvailableEditorLaunch")(function* (
  input: LaunchEditorInput,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<EditorLaunch, ExternalLauncherUnsupportedError> {
  const editorDef = EDITORS.find((editor) => editor.id === input.editor);
  if (!editorDef) {
    return yield* new ExternalLauncherUnsupportedError({
      operation: "editor",
      message: `Unknown editor: ${input.editor}`,
    });
  }

  if (editorDef.id === "file-manager") {
    const fileManagerLaunch = yield* resolveFileManagerLaunch(input.cwd, platform, env);
    return { command: fileManagerLaunch.command, args: fileManagerLaunch.args };
  }

  const command = resolveAvailableCommand(editorDef.commands ?? [], { platform, env });
  if (Option.isNone(command)) {
    return yield* new ExternalLauncherUnsupportedError({
      operation: "editor",
      message: `Editor launcher is unavailable: ${input.editor}`,
    });
  }

  return { command: command.value, args: resolveEditorArgs(editorDef, input.cwd) };
});

const spawnAndUnref = Effect.fn("externalLauncher.spawnAndUnref")(function* (
  launch: ExternalProcessLaunch,
): Effect.fn.Return<void, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(launch.command, launch.args, launch.options);

  yield* spawner.spawn(command).pipe(
    Effect.flatMap((handle) => handle.unref),
    Effect.asVoid,
    Effect.scoped,
  );
});

const launchAndUnref = (launch: ExternalProcessLaunch, errorMessage: string) =>
  spawnAndUnref(launch).pipe(
    Effect.mapError((cause) => new ExternalLauncherError({ message: errorMessage, cause })),
  );

export const launchExternalProcess = (
  launch: ExternalProcessLaunch,
  operation: ExternalLaunchOperation,
): Effect.Effect<void, ExternalProcessLaunchError, ChildProcessSpawner.ChildProcessSpawner> =>
  spawnAndUnref(launch).pipe(
    Effect.mapError(
      (cause) =>
        new ExternalProcessLaunchError({
          operation,
          command: launch.command,
          args: launch.args,
          message: `Failed to launch ${operation}`,
          cause,
        }),
    ),
  );

export const launchBrowser = Effect.fn("externalLauncher.launchBrowser")(function* (
  target: string,
): Effect.fn.Return<void, ExternalLauncherError, ChildProcessSpawner.ChildProcessSpawner> {
  return yield* launchAndUnref(resolveBrowserLaunch(target), "Browser auto-open failed");
});

export const launchEditorProcess = Effect.fn("externalLauncher.launchEditorProcess")(function* (
  launch: EditorLaunch,
): Effect.fn.Return<void, ExternalLauncherError, ChildProcessSpawner.ChildProcessSpawner> {
  if (!isCommandAvailable(launch.command)) {
    return yield* new ExternalLauncherError({
      message: `Editor command not found: ${launch.command}`,
    });
  }

  const isWin32 = process.platform === "win32";
  yield* launchAndUnref(
    {
      command: launch.command,
      args: isWin32 ? launch.args.map((arg) => `"${arg}"`) : [...launch.args],
      options: {
        detached: true,
        shell: isWin32,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    },
    "failed to spawn detached process",
  );
});

export const launchFileManager = Effect.fn("externalLauncher.launchFileManager")(function* (
  cwd: string,
): Effect.fn.Return<void, ExternalWorkspaceLaunchError, ChildProcessSpawner.ChildProcessSpawner> {
  const launch = yield* resolveFileManagerLaunch(cwd);
  return yield* launchExternalProcess(launch, "file-manager");
});

export const launchTerminal = Effect.fn("externalLauncher.launchTerminal")(function* (
  cwd: string,
): Effect.fn.Return<void, ExternalWorkspaceLaunchError, ChildProcessSpawner.ChildProcessSpawner> {
  const launch = yield* resolveTerminalLaunch(cwd);
  return yield* launchExternalProcess(launch, "terminal");
});

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return {
    launchBrowser: (target) =>
      launchBrowser(target).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    launchEditor: (input) =>
      Effect.flatMap(resolveEditorLaunch(input), (launch) =>
        launchEditorProcess(launch).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      ),
    launchFileManager: (cwd) =>
      launchFileManager(cwd).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    launchTerminal: (cwd) =>
      launchTerminal(cwd).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
  } satisfies ExternalLauncherShape;
});

export const layer = Layer.effect(ExternalLauncher, make);
