import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  GedRoleInvocationService,
  type GedRoleInvocationInput,
} from "../Services/GedRoleInvocationService.ts";
import { GedRoleInvocationServiceLive } from "./GedRoleInvocationServiceLive.ts";

const projectId = ProjectId.make("project-1");
const parentThreadId = ThreadId.make("thread-parent");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex_default"),
  model: "gpt-5-codex",
  options: [{ id: "reasoning", value: "high" }],
};

const globalRoleModelSelection = {
  instanceId: ProviderInstanceId.make("claude_global"),
  model: "claude-global",
};
const projectRoleModelSelection = {
  instanceId: ProviderInstanceId.make("codex_project"),
  model: "codex-project",
};

const project = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
  defaultModelSelection: modelSelection,
  roleModelSelections: {},
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies OrchestrationProjectShell;

const parentThread = {
  id: parentThreadId,
  projectId,
  title: "Parent",
  modelSelection,
  gedWorkflowEnabled: true,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: "/repo-worktree",
  latestTurn: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
} satisfies OrchestrationThread;

const makeProjection = (
  overrides: Partial<ProjectionSnapshotQueryShape> = {},
): ProjectionSnapshotQueryShape => ({
  getCommandReadModel: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getProjectShellById: () => Effect.succeed(Option.some(project)),
  getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
  getThreadCheckpointContext: () => Effect.die("unused"),
  getFullThreadDiffContext: () => Effect.die("unused"),
  getThreadShellById: () => Effect.die("unused"),
  getThreadDetailById: () => Effect.succeed(Option.some(parentThread)),
  ...overrides,
});

const runWith = async (
  commands: OrchestrationCommand[],
  projection: ProjectionSnapshotQueryShape = makeProjection(),
  settingsOverrides: Parameters<typeof ServerSettingsService.layerTest>[0] = {},
  inputOverrides: Partial<GedRoleInvocationInput> = {},
) => {
  const engine: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        return { sequence: commands.length };
      }),
  };

  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* GedRoleInvocationService;
      return yield* service.invoke({
        role: "ged-explorer",
        invocationId: "inv-1",
        parentThreadId,
        request: "Inspect orchestration seams",
        ...inputOverrides,
      });
    }).pipe(
      Effect.provide(
        Layer.provide(
          GedRoleInvocationServiceLive,
          Layer.mergeAll(
            Layer.succeed(OrchestrationEngineService, engine),
            Layer.succeed(ProjectionSnapshotQuery, projection),
            ServerSettingsService.layerTest(settingsOverrides),
          ),
        ),
      ),
    ),
  );
};

describe("GedRoleInvocationServiceLive", () => {
  it("dispatches child thread, linkage activities, and child turn with safe settings", async () => {
    const commands: OrchestrationCommand[] = [];
    const result = await runWith(commands);

    expect(result.childThreadId).toBe(ThreadId.make("ged-role-inv-1"));
    expect(commands.map((command) => command.type)).toEqual([
      "thread.create",
      "thread.activity.append",
      "thread.activity.append",
      "thread.turn.start",
    ]);

    const create = commands[0]!;
    expect(create).toMatchObject({
      type: "thread.create",
      threadId: result.childThreadId,
      projectId,
      modelSelection,
      gedWorkflowEnabled: false,
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: "main",
      worktreePath: "/repo-worktree",
    });

    const parentActivity = commands[1]!;
    expect(parentActivity).toMatchObject({
      type: "thread.activity.append",
      threadId: parentThreadId,
      activity: {
        kind: "ged.role-invocation.started",
        payload: { invocationId: "inv-1", parentThreadId, childThreadId: result.childThreadId },
      },
    });

    const childActivity = commands[2]!;
    expect(childActivity).toMatchObject({
      type: "thread.activity.append",
      threadId: result.childThreadId,
      activity: {
        kind: "ged.role-invocation.child",
        payload: { invocationId: "inv-1", parentThreadId, childThreadId: result.childThreadId },
      },
    });

    const turn = commands[3]!;
    expect(turn).toMatchObject({
      type: "thread.turn.start",
      threadId: result.childThreadId,
      modelSelection,
      gedWorkflowEnabled: false,
      runtimeMode: "approval-required",
      interactionMode: "default",
    });
    if (turn.type !== "thread.turn.start") throw new Error("expected turn start");
    expect(turn.message.attachments).toEqual([]);
    expect(turn.message.text).toContain("You are ged-explorer");
    expect(turn.message.text).toContain("Do not write source files");
  });

  it("fails before dispatch when parent context is missing", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(
      runWith(
        commands,
        makeProjection({ getThreadDetailById: () => Effect.succeed(Option.none()) }),
      ),
    ).rejects.toMatchObject({ _tag: "GedRoleInvocationContextError" });
    expect(commands).toEqual([]);
  });

  it("uses global role model override for child thread and turn", async () => {
    const commands: OrchestrationCommand[] = [];
    await runWith(commands, makeProjection(), {
      gedModelSelections: {
        mainThread: null,
        roles: { "ged-explorer": globalRoleModelSelection },
      },
    });

    expect(commands[0]).toMatchObject({
      type: "thread.create",
      modelSelection: globalRoleModelSelection,
    });
    expect(commands[3]).toMatchObject({
      type: "thread.turn.start",
      modelSelection: globalRoleModelSelection,
    });
  });

  it("uses project role model override before global role override", async () => {
    const commands: OrchestrationCommand[] = [];
    await runWith(
      commands,
      makeProjection({
        getProjectShellById: () =>
          Effect.succeed(
            Option.some({
              ...project,
              roleModelSelections: { "ged-explorer": projectRoleModelSelection },
            }),
          ),
      }),
      {
        gedModelSelections: {
          mainThread: null,
          roles: { "ged-explorer": globalRoleModelSelection },
        },
      },
    );

    expect(commands[0]).toMatchObject({
      type: "thread.create",
      modelSelection: projectRoleModelSelection,
    });
    expect(commands[3]).toMatchObject({
      type: "thread.turn.start",
      modelSelection: projectRoleModelSelection,
    });
  });

  it("fails before dispatch for invalid invocation ids", async () => {
    const commands: OrchestrationCommand[] = [];
    const engine: OrchestrationEngineShape = {
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      dispatch: (command) => Effect.sync(() => ({ sequence: commands.push(command) })),
    };

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* GedRoleInvocationService;
          return yield* service.invoke({
            role: "ged-explorer",
            invocationId: " inv-1",
            parentThreadId,
            request: "Inspect",
          });
        }).pipe(
          Effect.provide(
            Layer.provide(
              GedRoleInvocationServiceLive,
              Layer.mergeAll(
                Layer.succeed(OrchestrationEngineService, engine),
                Layer.succeed(ProjectionSnapshotQuery, makeProjection()),
                ServerSettingsService.layerTest(),
              ),
            ),
          ),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "GedRoleInvocationInputError" });
    expect(commands).toEqual([]);
  });

  it("fails before dispatch for unsupported configured roles", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(
      runWith(commands, makeProjection(), {}, { role: "ged-planner" }),
    ).rejects.toMatchObject({ _tag: "GedRoleInvocationInputError" });
    expect(commands).toEqual([]);
  });

  it("does not dispatch explorer when global subagents are disabled", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(
      runWith(commands, makeProjection(), { gedSubagentsEnabled: false }),
    ).rejects.toMatchObject({ _tag: "GedRoleInvocationInputError" });
    expect(commands).toEqual([]);
  });

  it("does not dispatch explorer when the explorer role is disabled", async () => {
    const commands: OrchestrationCommand[] = [];
    await expect(
      runWith(commands, makeProjection(), {
        gedRoleSettings: { "ged-explorer": { enabled: false } },
      }),
    ).rejects.toMatchObject({ _tag: "GedRoleInvocationInputError" });
    expect(commands).toEqual([]);
  });
});
