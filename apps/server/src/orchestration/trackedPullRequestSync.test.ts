import {
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  type ChangeRequest,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  listTrackedPullRequests,
  synchronizeTrackedPullRequests,
} from "./trackedPullRequestSync.ts";

const projectId = ProjectId.make("project-pr-sync");
const trackedTaskId = TaskId.make("task-pr-tracked");
const now = "2026-07-22T00:00:00.000Z";

const changeRequest = (state: ChangeRequest["state"]): ChangeRequest => ({
  provider: "github",
  number: 42,
  title: "Track this PR",
  url: "https://github.com/acme/repo/pull/42",
  baseRefName: "main",
  headRefName: "ged/feature/track",
  state,
  updatedAt: Option.none(),
});

const readModel = (): OrchestrationReadModel => ({
  snapshotSequence: 1,
  projects: [
    {
      id: projectId,
      title: "PR sync project",
      workspaceRoot: "/repo",
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      roleModelSelections: {},
      orchestratorConfig: { enabled: true },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [],
  tasks: [
    {
      id: trackedTaskId,
      projectId,
      type: TaskTypeId.make("feature"),
      title: "Tracked PR",
      status: "pr-open",
      branch: "ged/feature/track",
      worktreePath: null,
      prUrl: "https://github.com/acme/repo/pull/42",
      pmMessageId: null,
      stageThreadIds: [],
      currentStageThreadId: null,
      cancellation: null,
      changeReview: null,
      verification: null,
      noChangesNeeded: null,
      landing: { status: "completed", failureMessage: null, branchPushed: true, updatedAt: now },
      roleCapabilityTiers: {},
      playbookVersion: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    },
    {
      id: TaskId.make("task-no-pr"),
      projectId,
      type: TaskTypeId.make("feature"),
      title: "No PR",
      status: "review",
      branch: null,
      worktreePath: null,
      prUrl: null,
      pmMessageId: null,
      stageThreadIds: [],
      currentStageThreadId: null,
      cancellation: null,
      changeReview: null,
      verification: null,
      noChangesNeeded: null,
      landing: null,
      roleCapabilityTiers: {},
      playbookVersion: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
    },
  ],
  pendingGates: [],
  projectContextRuns: [],
  quotaBlockedStages: [],
  stageHistory: {},
  updatedAt: now,
});

it.effect("tracks only durable opened PRs from the primary checkout", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(listTrackedPullRequests(readModel()), [
      {
        taskId: trackedTaskId,
        projectId,
        cwd: "/repo",
        reference: "https://github.com/acme/repo/pull/42",
      },
    ]);
  }),
);

it.effect("reports a remote merge exactly once to the reactor boundary", () =>
  Effect.gen(function* () {
    const tracked = listTrackedPullRequests(readModel());
    const results = yield* synchronizeTrackedPullRequests({
      tracked,
      getChangeRequest: () => Effect.succeed(changeRequest("merged")),
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]?.state, "merged");
    assert.strictEqual(results[0]?.tracked.taskId, trackedTaskId);
  }),
);

it.effect("retains provider failures for the scheduler to retry without a model call", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      synchronizeTrackedPullRequests({
        tracked: listTrackedPullRequests(readModel()),
        getChangeRequest: () => Effect.fail("github unavailable"),
      }),
    );
    assert.strictEqual(error, "github unavailable");
  }),
);
