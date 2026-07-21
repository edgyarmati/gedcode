import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { prepareTaskRepository, isGitHubRemoteUrl } from "./taskRepositoryPreparation.ts";

const output = (stdout = "", exitCode = 0) => ({
  stdout,
  stderr: "",
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdoutTruncated: false,
  stderrTruncated: false,
});

describe("isGitHubRemoteUrl", () => {
  it.each([
    "https://github.com/acme/project.git",
    "git@github.com:acme/project.git",
    "ssh://git@github.com/acme/project.git",
  ])("accepts %s", (url) => expect(isGitHubRemoteUrl(url)).toBe(true));

  it.each(["/tmp/project.git", "https://gitlab.com/acme/project.git", "not-a-url"])(
    "rejects %s",
    (url) => expect(isGitHubRemoteUrl(url)).toBe(false),
  );
});

it("fetches and fast-forwards a clean behind checkout before returning its HEAD", async () => {
  const responses = [
    output(""),
    output("main\n"),
    output("origin/main\n"),
    output("https://github.com/acme/project.git\n"),
    output(),
    output("0\t2\n"),
    output(),
    output(`${"a".repeat(40)}\n`),
  ];
  const run = vi.fn<VcsProcessShape["run"]>(() => Effect.succeed(responses.shift()!));

  const result = await Effect.runPromise(prepareTaskRepository({ cwd: "/repo", process: { run } }));

  expect(result).toEqual({
    branch: "main",
    upstream: "origin/main",
    head: "a".repeat(40),
  });
  expect(run.mock.calls.map(([input]) => input.args)).toEqual([
    ["status", "--porcelain=v1", "--untracked-files=all"],
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    ["remote", "get-url", "origin"],
    ["fetch", "--prune", "origin"],
    ["rev-list", "--left-right", "--count", "HEAD...origin/main"],
    ["merge", "--ff-only", "origin/main"],
    ["rev-parse", "--verify", "HEAD"],
  ]);
});

it("rejects dirty and diverged checkouts without mutating them", async () => {
  const dirtyRun = vi.fn<VcsProcessShape["run"]>(() => Effect.succeed(output(" M src/app.ts\n")));
  const dirty = await Effect.runPromise(
    Effect.flip(prepareTaskRepository({ cwd: "/repo", process: { run: dirtyRun } })),
  );
  expect(dirty.detail).toContain("uncommitted changes");
  expect(dirtyRun).toHaveBeenCalledTimes(1);

  const responses = [
    output(),
    output("main\n"),
    output("origin/main\n"),
    output("git@github.com:acme/project.git\n"),
    output(),
    output("1\t2\n"),
  ];
  const divergedRun = vi.fn<VcsProcessShape["run"]>(() => Effect.succeed(responses.shift()!));
  const diverged = await Effect.runPromise(
    Effect.flip(prepareTaskRepository({ cwd: "/repo", process: { run: divergedRun } })),
  );
  expect(diverged.detail).toContain("diverged");
  expect(divergedRun.mock.calls.some(([input]) => input.args[0] === "merge")).toBe(false);
});
