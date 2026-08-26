import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { VcsProcessOutput, VcsProcessShape } from "../vcs/VcsProcess.ts";
import {
  continueTaskRebaseInWorktree,
  isDocumentationRebasePath,
  rebaseTaskBranchOntoPrimary,
} from "./taskRebase.ts";

const verifiedHead = "a".repeat(40);
const baseHead = "b".repeat(40);
const rebasedHead = "c".repeat(40);

const output = (stdout = "", exitCode = 0, stderr = ""): VcsProcessOutput => ({
  stdout,
  stderr,
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdoutTruncated: false,
  stderrTruncated: false,
});

type OperationResponses = Record<string, ReadonlyArray<VcsProcessOutput>>;

function makeRun(overrides: OperationResponses = {}) {
  const responses = new Map<string, Array<VcsProcessOutput>>(
    Object.entries({
      "TaskRepositoryPreparation.status": [output()],
      "TaskRepositoryPreparation.branch": [output("main\n")],
      "TaskRepositoryPreparation.upstream": [output("origin/main\n")],
      "TaskRepositoryPreparation.remote": [output("https://github.com/acme/project.git\n")],
      "TaskRepositoryPreparation.fetch": [output()],
      "TaskRepositoryPreparation.aheadBehind": [output("0\t1\n")],
      "TaskRepositoryPreparation.fastForward": [output()],
      "TaskRepositoryPreparation.head": [output(`${baseHead}\n`)],
      "TaskRebase.status": [output()],
      "TaskRebase.head": [output(`${verifiedHead}\n`), output(`${rebasedHead}\n`)],
      "TaskRebase.currentBase": [output("", 1)],
      "TaskRebase.probe": [output(`${"3".repeat(40)}\0`)],
      "TaskRebase.probeProof": [output()],
      "TaskRebase.rebase": [output()],
      "TaskRebase.completedStatus": [output()],
      "TaskRebase.fromTree": [output(`${"1".repeat(40)}\n`)],
      "TaskRebase.toTree": [output(`${"1".repeat(40)}\n`)],
      ...overrides,
    }).map(([operation, values]) => [operation, [...values]]),
  );
  const run = vi.fn<VcsProcessShape["run"]>((input) => {
    const result = responses.get(input.operation)?.shift();
    return result === undefined
      ? Effect.die(`Unexpected git operation ${input.operation}`)
      : Effect.succeed(result);
  });
  return run;
}

describe("task rebase", () => {
  it("refreshes primary and records identical-tree proof for a clean rebase", async () => {
    const run = makeRun();

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result).toEqual({
      status: "rebased",
      baseHead,
      fromHead: verifiedHead,
      toHead: rebasedHead,
      proofKind: "identical",
      paths: [],
    });
    expect(
      run.mock.calls.findIndex(([input]) => input.operation === "TaskRepositoryPreparation.fetch"),
    ).toBeLessThan(run.mock.calls.findIndex(([input]) => input.operation === "TaskRebase.status"));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TaskRepositoryPreparation.fastForward",
        args: ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "origin/main"],
      }),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TaskRebase.rebase",
        args: expect.arrayContaining([
          "core.hooksPath=/dev/null",
          "--merge",
          "--no-autostash",
          "--no-verify",
          baseHead,
        ]),
        allowNonZeroExit: true,
      }),
    );
  });

  it("classifies changed tree paths using the documentation allowlist", async () => {
    const run = makeRun({
      "TaskRebase.toTree": [output(`${"2".repeat(40)}\n`)],
      "TaskRebase.proof": [output(".ged/work/STATE.md\0README.md\0")],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result).toMatchObject({
      status: "rebased",
      proofKind: "docs-only",
      paths: [".ged/work/STATE.md", "README.md"],
    });
  });

  it("aborts mixed or code conflicts and proves the verified branch was restored", async () => {
    const run = makeRun({
      "TaskRebase.status": [output(), output()],
      "TaskRebase.head": [output(`${verifiedHead}\n`), output(`${verifiedHead}\n`)],
      "TaskRebase.rebase": [output("", 1, "conflict")],
      "TaskRebase.conflicts": [output("README.md\0src/app.ts\0")],
      "TaskRebase.abort": [output()],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result).toEqual({
      status: "code-conflicts",
      baseHead,
      fromHead: verifiedHead,
      paths: ["README.md", "src/app.ts"],
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "TaskRebase.abort", args: ["rebase", "--abort"] }),
    );
  });

  it("rejects substantive probe conflicts without mutating the task branch", async () => {
    const run = makeRun({
      "TaskRebase.probe": [output(`${"3".repeat(40)}\0README.md\0src/app.ts\0`, 1)],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result).toMatchObject({
      status: "code-conflicts",
      paths: ["README.md", "src/app.ts"],
    });
    expect(run.mock.calls.some(([input]) => input.operation === "TaskRebase.rebase")).toBe(false);
  });

  it("rejects proof evidence beyond the event bound before mutating the task branch", async () => {
    const paths = Array.from({ length: 257 }, (_, index) => `docs/${index}.md`);
    const run = makeRun({
      "TaskRebase.probeProof": [output(`${paths.join("\0")}\0`)],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result).toEqual({
      status: "proof-limit",
      baseHead,
      fromHead: verifiedHead,
      pathCount: 257,
    });
    expect(run.mock.calls.some(([input]) => input.operation === "TaskRebase.rebase")).toBe(false);
  });

  it("restores verified HEAD if final proof unexpectedly exceeds the event bound", async () => {
    const paths = Array.from({ length: 257 }, (_, index) => `docs/${index}.md`);
    const run = makeRun({
      "TaskRebase.status": [output(), output()],
      "TaskRebase.head": [
        output(`${verifiedHead}\n`),
        output(`${rebasedHead}\n`),
        output(`${verifiedHead}\n`),
      ],
      "TaskRebase.toTree": [output(`${"2".repeat(40)}\n`)],
      "TaskRebase.proof": [output(`${paths.join("\0")}\0`)],
      "TaskRebase.restore": [output()],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result.status).toBe("proof-limit");
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TaskRebase.restore",
        args: ["-c", "core.hooksPath=/dev/null", "reset", "--hard", verifiedHead],
      }),
    );
  });

  it("leaves documentation-only conflicts in progress", async () => {
    const run = makeRun({
      "TaskRebase.rebase": [output("", 1, "conflict")],
      "TaskRebase.conflicts": [output(".ged/work/STATE.md\0README.md\0")],
    });

    const result = await Effect.runPromise(
      rebaseTaskBranchOntoPrimary({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
      }),
    );

    expect(result.status).toBe("doc-conflicts");
    expect(run.mock.calls.some(([input]) => input.operation === "TaskRebase.abort")).toBe(false);
  });

  it("does not misclassify an operational rebase failure as a conflict", async () => {
    const run = makeRun({
      "TaskRebase.status": [output(), output()],
      "TaskRebase.head": [output(`${verifiedHead}\n`), output(`${verifiedHead}\n`)],
      "TaskRebase.rebase": [output("", 2, "hook failed")],
      "TaskRebase.conflicts": [output()],
      "TaskRebase.abort": [output()],
    });

    await expect(
      Effect.runPromise(
        rebaseTaskBranchOntoPrimary({
          primaryCheckoutPath: "/repo",
          worktreePath: "/task",
          verifiedHead,
          process: { run },
        }),
      ),
    ).rejects.toThrow("stopped without file conflicts");
  });

  it("continues only the rebase that started at the verified head and preserves its base", async () => {
    const run = makeRun({
      "TaskRebase.orig-headPath": [output("/task/.git/rebase-merge/orig-head\n")],
      "TaskRebase.ontoPath": [output("/task/.git/rebase-merge/onto\n")],
      "TaskRebase.conflicts": [output("README.md\0")],
      "TaskRebase.unstaged": [output("README.md\0")],
      "TaskRebase.untracked": [output()],
      "TaskRebase.resolutionCheck": [output()],
      "TaskRebase.stageResolutions": [output()],
      "TaskRebase.continue": [output()],
      "TaskRebase.head": [output(`${rebasedHead}\n`)],
      "TaskRebase.completedStatus": [output()],
      "TaskRebase.fromTree": [output(`${"1".repeat(40)}\n`)],
      "TaskRebase.toTree": [output(`${"1".repeat(40)}\n`)],
    });
    const readFileString = vi.fn((path: string) =>
      Effect.succeed(path.endsWith("orig-head") ? `${verifiedHead}\n` : `${baseHead}\n`),
    );

    const result = await Effect.runPromise(
      continueTaskRebaseInWorktree({
        primaryCheckoutPath: "/repo",
        worktreePath: "/task",
        verifiedHead,
        process: { run },
        fileSystem: { readFileString },
      }),
    );

    expect(result).toMatchObject({
      status: "rebased",
      baseHead,
      fromHead: verifiedHead,
      toHead: rebasedHead,
      proofKind: "identical",
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TaskRebase.stageResolutions",
        args: ["add", "--", "README.md"],
      }),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "TaskRebase.continue",
        args: expect.arrayContaining(["core.hooksPath=/dev/null", "rebase", "--continue"]),
      }),
    );
  });

  it("rejects continuation when the paused rebase no longer targets refreshed primary", async () => {
    const run = makeRun({
      "TaskRebase.orig-headPath": [output("/task/.git/rebase-merge/orig-head\n")],
      "TaskRebase.ontoPath": [output("/task/.git/rebase-merge/onto\n")],
      "TaskRebase.abort": [output()],
      "TaskRebase.status": [output()],
      "TaskRebase.head": [output(`${verifiedHead}\n`)],
    });
    const staleBaseHead = "d".repeat(40);
    const readFileString = vi.fn((path: string) =>
      Effect.succeed(path.endsWith("orig-head") ? `${verifiedHead}\n` : `${staleBaseHead}\n`),
    );

    await expect(
      Effect.runPromise(
        continueTaskRebaseInWorktree({
          primaryCheckoutPath: "/repo",
          worktreePath: "/task",
          verifiedHead,
          process: { run },
          fileSystem: { readFileString },
        }),
      ),
    ).rejects.toThrow(`not refreshed primary HEAD '${baseHead}', so it was aborted`);
    expect(run.mock.calls.some(([input]) => input.operation === "TaskRebase.abort")).toBe(true);
    expect(run.mock.calls.some(([input]) => input.operation === "TaskRebase.continue")).toBe(false);
  });
});

describe("isDocumentationRebasePath", () => {
  it.each([".ged/STATE.md", ".ged/nested/file.json", "README.md", "docs/guide.md"])(
    "allows %s",
    (path) => expect(isDocumentationRebasePath(path)).toBe(true),
  );

  it.each(["src/.ged/file", "README.MD", "README.md ", "src/app.ts"])("rejects %s", (path) =>
    expect(isDocumentationRebasePath(path)).toBe(false),
  );
});
