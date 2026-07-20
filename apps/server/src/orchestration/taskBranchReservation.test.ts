// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach } from "vitest";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import { releaseTaskBranchReservation, reserveTaskBranch } from "./taskBranchReservation.ts";

const liveVcsProcess = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const repositories: string[] = [];

function makeRepository(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "gedcode-task-branch-"));
  repositories.push(cwd);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "GedCode Test"], { cwd });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "initial"], { cwd });
  return cwd;
}

afterEach(() => {
  for (const cwd of repositories.splice(0)) {
    rmSync(cwd, { recursive: true, force: true });
  }
});

describe("task branch reservation", () => {
  it.effect("uses -2 and -3 for existing refs", () =>
    Effect.gen(function* () {
      const cwd = makeRepository();
      execFileSync("git", ["branch", "ged/feature/fix-pm"], { cwd });
      const vcsProcess = yield* VcsProcess.VcsProcess;

      const second = yield* reserveTaskBranch({
        vcsProcess,
        cwd,
        taskType: "feature",
        title: "Fix PM",
      });
      const third = yield* reserveTaskBranch({
        vcsProcess,
        cwd,
        taskType: "feature",
        title: "Fix PM",
      });

      expect(second.branch).toBe("ged/feature/fix-pm-2");
      expect(third.branch).toBe("ged/feature/fix-pm-3");
    }).pipe(Effect.provide(liveVcsProcess)),
  );

  it.effect("reserves concurrent requests without reusing a ref", () =>
    Effect.gen(function* () {
      const cwd = makeRepository();
      const vcsProcess = yield* VcsProcess.VcsProcess;
      const reservations = yield* Effect.all(
        Array.from({ length: 4 }, () =>
          reserveTaskBranch({ vcsProcess, cwd, taskType: "feature", title: "Concurrent task" }),
        ),
        { concurrency: "unbounded" },
      );

      expect(reservations.map(({ branch }) => branch).toSorted()).toEqual([
        "ged/feature/concurrent-task",
        "ged/feature/concurrent-task-2",
        "ged/feature/concurrent-task-3",
        "ged/feature/concurrent-task-4",
      ]);
    }).pipe(Effect.provide(liveVcsProcess)),
  );

  it.effect("releases only an unchanged reservation", () =>
    Effect.gen(function* () {
      const cwd = makeRepository();
      const vcsProcess = yield* VcsProcess.VcsProcess;
      const reservation = yield* reserveTaskBranch({
        vcsProcess,
        cwd,
        taskType: "feature",
        title: "Compensate me",
      });

      yield* releaseTaskBranchReservation({ vcsProcess, cwd, reservation });
      expect(() =>
        execFileSync("git", ["show-ref", "--verify", `refs/heads/${reservation.branch}`], {
          cwd,
          stdio: "ignore",
        }),
      ).toThrow();
    }).pipe(Effect.provide(liveVcsProcess)),
  );
});
