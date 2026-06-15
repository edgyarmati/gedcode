import {
  err,
  ExecutionError,
  FileError,
  ok,
  type ExecutionEnv,
  type ExecutionEnvExecOptions,
  type FileInfo,
  type Result,
} from "@earendil-works/pi-agent-core";

const deniedFile = (operation: string, path?: string): FileError =>
  new FileError("permission_denied", `PM execution environment does not allow ${operation}.`, path);

const unsupportedFile = (operation: string, path?: string): FileError =>
  new FileError("not_supported", `PM execution environment does not support ${operation}.`, path);

const deniedExec = (): ExecutionError =>
  new ExecutionError("shell_unavailable", "PM execution environment does not allow shell access.");

const normalizePath = (input: string): string => {
  const absoluteInput = input.startsWith("/");
  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = `${absoluteInput ? "/" : ""}${segments.join("/")}`;
  return normalized === "" ? (absoluteInput ? "/" : ".") : normalized;
};

const joinPath = (parts: ReadonlyArray<string>): string => normalizePath(parts.join("/"));

const absolute = (cwd: string, input: string): string =>
  normalizePath(input.startsWith("/") ? input : joinPath([cwd, input]));

/**
 * Locked-down pi `ExecutionEnv` for the PM brain.
 *
 * The orchestrator PM must route all repo changes through gedcode commands and
 * the decider. This env therefore exposes only inert path helpers; filesystem
 * reads/writes, temp files, directory creation/removal, and shell execution are
 * denied at the capability boundary.
 */
export class DenyingExecutionEnv implements ExecutionEnv {
  readonly cwd: string;

  constructor(cwd = "/") {
    this.cwd = absolute("/", cwd);
  }

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    return ok(absolute(this.cwd, path));
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return ok(absolute(this.cwd, joinPath(parts)));
  }

  async readTextFile(path: string): Promise<Result<string, FileError>> {
    return err(deniedFile("readTextFile", path));
  }

  async readTextLines(
    path: string,
    _options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    return err(deniedFile("readTextLines", path));
  }

  async readBinaryFile(path: string): Promise<Result<Uint8Array, FileError>> {
    return err(deniedFile("readBinaryFile", path));
  }

  async writeFile(path: string, _content: string | Uint8Array): Promise<Result<void, FileError>> {
    return err(deniedFile("writeFile", path));
  }

  async appendFile(path: string, _content: string | Uint8Array): Promise<Result<void, FileError>> {
    return err(deniedFile("appendFile", path));
  }

  async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    return err(deniedFile("fileInfo", path));
  }

  async listDir(path: string): Promise<Result<FileInfo[], FileError>> {
    return err(deniedFile("listDir", path));
  }

  async canonicalPath(path: string): Promise<Result<string, FileError>> {
    return err(unsupportedFile("canonicalPath", path));
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    return err(deniedFile("exists", path));
  }

  async createDir(
    path: string,
    _options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    return err(deniedFile("createDir", path));
  }

  async remove(
    path: string,
    _options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    return err(deniedFile("remove", path));
  }

  async createTempDir(prefix?: string): Promise<Result<string, FileError>> {
    return err(deniedFile("createTempDir", prefix));
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    return err(deniedFile("createTempFile", options?.prefix));
  }

  async exec(
    _command: string,
    _options?: ExecutionEnvExecOptions,
  ): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    return err(deniedExec());
  }

  async cleanup(): Promise<void> {}
}

export const makeDenyingExecutionEnv = (cwd?: string): DenyingExecutionEnv =>
  new DenyingExecutionEnv(cwd);
