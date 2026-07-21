import {
  CommandId,
  EventId,
  ProjectContextFingerprint,
  ProjectContextRunContentDigest,
  ProjectContextRunId,
  ProjectContextRunGitObjectId,
  ProjectContextSchemaVersion,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProject,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const fingerprint = ProjectContextFingerprint.make(`sha256:${"a".repeat(64)}`);
const baselineManifest = [{ path: "AGENTS.md" as const, rawContent: null }];
const workspaceStatusManifest = [
  {
    relativePath: "README.md",
    porcelainStatus: " M",
    contentDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
  },
];
const gitState = {
  head: null,
  headIdentity: { kind: "branch" as const, ref: "refs/heads/main" },
  stagedIndexDigest: ProjectContextRunContentDigest.make(`sha256:${"c".repeat(64)}`),
  refsDigest: ProjectContextRunContentDigest.make(`sha256:${"d".repeat(64)}`),
  configDigest: ProjectContextRunContentDigest.make(`sha256:${"e".repeat(64)}`),
  hooksDigest: ProjectContextRunContentDigest.make(`sha256:${"f".repeat(64)}`),
  infoExcludeDigest: ProjectContextRunContentDigest.make(`sha256:${"0".repeat(64)}`),
  infoAttributesDigest: ProjectContextRunContentDigest.make(`sha256:${"1".repeat(64)}`),
  infoGraftsDigest: ProjectContextRunContentDigest.make(`sha256:${"2".repeat(64)}`),
};

const selection = (instanceId: string, model: string) => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

const defaults = {
  capabilityPresets: {
    cheap: selection("global-cheap", "cheap-model"),
    smart: selection("global-smart", "smart-model"),
    genius: selection("global-genius", "genius-model"),
  },
};

function readModel(projectOverrides: OrchestrationProject["orchestratorConfig"] = {}) {
  return {
    ...createEmptyReadModel(now),
    projects: [
      {
        id: ProjectId.make("project-context-run"),
        title: "Project context run",
        workspaceRoot: "/repo/project-context-run",
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        orchestratorConfig: projectOverrides,
        projectContextResolution: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
  } satisfies OrchestrationReadModel;
}

const request = (overrides: Record<string, unknown> = {}) => ({
  type: "project.context.run.request" as const,
  commandId: CommandId.make("cmd-context-run-request"),
  projectContextRunId: ProjectContextRunId.make("context-run-1"),
  projectId: ProjectId.make("project-context-run"),
  expectedPrimaryCheckoutPath: "/repo/project-context-run",
  mode: "populate" as const,
  schemaVersion: ProjectContextSchemaVersion.make(1),
  fingerprint,
  baselineManifest,
  workspaceStatusManifest,
  gitState,
  createdAt: now,
  ...overrides,
});

it.layer(NodeServices.layer)("project-context run decider", (it) => {
  it.effect("defaults to Smart and stamps the resolved backend and primary checkout", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: request(),
        orchestratorDefaults: defaults,
        readModel: readModel(),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("project.context-run-requested");
      expect(event.aggregateKind).toBe("project-context-run");
      if (event.type === "project.context-run-requested") {
        expect(event.payload.tier).toBe("smart");
        expect(event.payload.providerInstanceId).toBe(ProviderInstanceId.make("global-smart"));
        expect(event.payload.model).toBe("smart-model");
        expect(event.payload.primaryCheckoutPath).toBe("/repo/project-context-run");
        expect(event.payload.pmStartState).toBe("ready");
        expect(event.payload.workspaceStatusManifest).toEqual(workspaceStatusManifest);
        expect(event.payload.prompt).toContain("Populate missing or stub project guidance");
        expect(event.payload).not.toHaveProperty("taskId");
        expect(event.payload).not.toHaveProperty("stageThreadId");
        expect(event.payload).not.toHaveProperty("gateId");
        expect(event.payload).not.toHaveProperty("worktreePath");
        expect(event.payload).not.toHaveProperty("prUrl");
      }
    }),
  );

  it.effect("requires explicit arbitration when the PM turn is active", () =>
    Effect.gen(function* () {
      const initial = readModel();
      const result = yield* decideOrchestrationCommand({
        command: request(),
        orchestratorDefaults: defaults,
        readModel: {
          ...initial,
          threads: [
            {
              id: ThreadId.make("pm:project-context-run"),
              projectId: ProjectId.make("project-context-run"),
              title: "PM",
              modelSelection: selection("global-smart", "smart-model"),
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              latestTurn: {
                turnId: TurnId.make("pm-turn"),
                state: "running",
                requestedAt: now,
                startedAt: now,
                completedAt: null,
                assistantMessageId: null,
              },
              createdAt: now,
              updatedAt: now,
              archivedAt: null,
              deletedAt: null,
              pendingPmHandoff: null,
              messages: [],
              proposedPlans: [],
              activities: [],
              checkpoints: [],
              session: null,
            },
          ],
        },
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.context-run-requested");
      if (event.type === "project.context-run-requested") {
        expect(event.payload.pmStartState).toBe("awaiting-user");
      }
    }),
  );

  it.effect("honors an explicit tier and resolves a project preset override", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: request({ tier: "cheap" }),
        orchestratorDefaults: defaults,
        readModel: readModel({
          capabilityPresets: {
            cheap: selection("project-cheap", "project-cheap-model"),
          },
        }),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("project.context-run-requested");
      if (event.type === "project.context-run-requested") {
        expect(event.payload.tier).toBe("cheap");
        expect(event.payload.providerInstanceId).toBe(ProviderInstanceId.make("project-cheap"));
        expect(event.payload.model).toBe("project-cheap-model");
      }
    }),
  );

  it.effect(
    "rejects a captured baseline after its project is deleted or primary checkout relocates",
    () =>
      Effect.gen(function* () {
        const captured = request();
        const initial = readModel();
        const deleted: OrchestrationReadModel = {
          ...initial,
          projects: initial.projects.map((project) =>
            Object.assign({}, project, { deletedAt: now }),
          ),
        };
        const deletedResult = yield* Effect.flip(
          decideOrchestrationCommand({
            command: captured,
            orchestratorDefaults: defaults,
            readModel: deleted,
          }),
        );
        expect(deletedResult.message).toContain("was deleted");

        const relocated: OrchestrationReadModel = {
          ...initial,
          projects: initial.projects.map((project) =>
            Object.assign({}, project, {
              workspaceRoot: "/repo/project-context-run-relocated",
            }),
          ),
        };
        const relocatedResult = yield* Effect.flip(
          decideOrchestrationCommand({
            command: captured,
            orchestratorDefaults: defaults,
            readModel: relocated,
          }),
        );
        expect(relocatedResult.message).toContain("primary checkout changed");
      }),
  );

  it.effect("rejects a second active run for the project", () =>
    Effect.gen(function* () {
      const initial = readModel();
      const planned = yield* decideOrchestrationCommand({
        command: request(),
        orchestratorDefaults: defaults,
        readModel: initial,
      });
      const requested = Array.isArray(planned) ? planned[0] : planned;
      const withActiveRun = yield* projectEvent(initial, {
        ...requested,
        sequence: 1,
        eventId: EventId.make("evt-context-run-requested"),
      });

      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: request({
            commandId: CommandId.make("cmd-context-run-request-2"),
            projectContextRunId: ProjectContextRunId.make("context-run-2"),
          }),
          orchestratorDefaults: defaults,
          readModel: withActiveRun,
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect(
    "blocks workspace-root relocation and deletion until active context runs are resolved",
    () =>
      Effect.gen(function* () {
        const initial = readModel();
        const planned = yield* decideOrchestrationCommand({
          command: request(),
          orchestratorDefaults: defaults,
          readModel: initial,
        });
        const requested = Array.isArray(planned) ? planned[0] : planned;
        const withRun = yield* projectEvent(initial, {
          ...requested,
          sequence: 1,
          eventId: EventId.make("evt-context-run-project-mutation"),
        });

        for (const status of ["pending", "running", "pending-review"] as const) {
          const readModelWithActiveRun: OrchestrationReadModel = {
            ...withRun,
            projectContextRuns: withRun.projectContextRuns.map((run) =>
              Object.assign({}, run, { status }),
            ),
          };
          const relocation = yield* Effect.flip(
            decideOrchestrationCommand({
              command: {
                type: "project.meta.update",
                commandId: CommandId.make(`cmd-context-relocate-${status}`),
                projectId: ProjectId.make("project-context-run"),
                workspaceRoot: "/repo/project-context-run-relocated",
              },
              readModel: readModelWithActiveRun,
            }),
          );
          expect(relocation.message).toContain(
            "Interrupt the run or resolve its pending review first",
          );

          const deletion = yield* Effect.flip(
            decideOrchestrationCommand({
              command: {
                type: "project.delete",
                commandId: CommandId.make(`cmd-context-delete-${status}`),
                projectId: ProjectId.make("project-context-run"),
              },
              readModel: readModelWithActiveRun,
            }),
          );
          expect(deletion.message).toContain(
            "Interrupt the run or resolve its pending review first",
          );

          const forcedDeletion = yield* Effect.flip(
            decideOrchestrationCommand({
              command: {
                type: "project.delete",
                commandId: CommandId.make(`cmd-context-force-delete-${status}`),
                projectId: ProjectId.make("project-context-run"),
                force: true,
              },
              readModel: readModelWithActiveRun,
            }),
          );
          expect(forcedDeletion.message).toContain(
            "Interrupt the run or resolve its pending review first",
          );
        }
      }),
  );

  it.effect("enforces start and pending-review transitions with immutable changes", () =>
    Effect.gen(function* () {
      const initial = readModel();
      const requestedPlan = yield* decideOrchestrationCommand({
        command: request(),
        orchestratorDefaults: defaults,
        readModel: initial,
      });
      const requested = Array.isArray(requestedPlan) ? requestedPlan[0] : requestedPlan;
      const pending = yield* projectEvent(initial, {
        ...requested,
        sequence: 1,
        eventId: EventId.make("evt-context-run-requested-transition"),
      });

      const prematureReview = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "project.context.run.pending-review",
            commandId: CommandId.make("cmd-context-run-premature-review"),
            projectContextRunId: ProjectContextRunId.make("context-run-1"),
            result: "Done",
            changes: [],
            scopeViolationPaths: [],
            createdAt: now,
          },
          readModel: pending,
        }),
      );
      expect(prematureReview._tag).toBe("Failure");

      const startedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.start",
          commandId: CommandId.make("cmd-context-run-start"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          providerThreadId: ThreadId.make("project-context:context-run-1"),
          createdAt: "2026-01-01T00:01:00.000Z",
        },
        readModel: pending,
      });
      const started = Array.isArray(startedPlan) ? startedPlan[0] : startedPlan;
      const running = yield* projectEvent(pending, {
        ...started,
        sequence: 2,
        eventId: EventId.make("evt-context-run-started"),
      });
      expect(running.projectContextRuns[0]?.status).toBe("running");

      const reviewPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.pending-review",
          commandId: CommandId.make("cmd-context-run-review"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          result: "Updated shared guidance.",
          changes: [
            {
              path: "AGENTS.md",
              beforeRawContent: null,
              afterRawContent: "# Project instructions\n",
            },
          ],
          scopeViolationPaths: ["src/unexpected.ts"],
          createdAt: "2026-01-01T00:02:00.000Z",
        },
        readModel: running,
      });
      const review = Array.isArray(reviewPlan) ? reviewPlan[0] : reviewPlan;
      expect(review.type).toBe("project.context-run-pending-review");
      if (review.type === "project.context-run-pending-review") {
        expect(review.payload.changes).toEqual([
          {
            path: "AGENTS.md",
            beforeRawContent: null,
            afterRawContent: "# Project instructions\n",
          },
        ]);
        expect(review.payload.scopeViolationPaths).toEqual(["src/unexpected.ts"]);
      }

      const pendingReview = yield* projectEvent(running, {
        ...review,
        sequence: 3,
        eventId: EventId.make("evt-context-run-review"),
      });
      expect(pendingReview.projectContextRuns[0]).toMatchObject({
        status: "pending-review",
        result: "Updated shared guidance.",
        scopeViolationPaths: ["src/unexpected.ts"],
      });
      const invalidInterrupt = yield* Effect.exit(
        decideOrchestrationCommand({
          command: {
            type: "project.context.run.interrupt",
            commandId: CommandId.make("cmd-context-run-interrupt-review"),
            projectContextRunId: ProjectContextRunId.make("context-run-1"),
            createdAt: "2026-01-01T00:03:00.000Z",
          },
          readModel: pendingReview,
        }),
      );
      expect(invalidInterrupt._tag).toBe("Failure");

      const discardPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.discard",
          commandId: CommandId.make("cmd-context-run-discard"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          resultSchemaVersion: ProjectContextSchemaVersion.make(1),
          resultFingerprint: ProjectContextFingerprint.make(`sha256:${"e".repeat(64)}`),
          createdAt: "2026-01-01T00:03:00.000Z",
        },
        readModel: pendingReview,
      });
      expect(Array.isArray(discardPlan)).toBe(true);
      if (Array.isArray(discardPlan)) {
        expect(discardPlan.map((event) => event.type)).toEqual([
          "project.context-run-discarded",
          "project.context-dismissed",
        ]);
        expect(discardPlan[1]?.causationEventId).toBe(discardPlan[0]?.eventId);
      }

      const revisedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.revise",
          commandId: CommandId.make("cmd-context-run-revise"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          prompt: "Revise AGENTS.md to explain the primary verification command.",
          createdAt: "2026-01-01T00:03:00.000Z",
        },
        readModel: pendingReview,
      });
      const revisedEvent = Array.isArray(revisedPlan) ? revisedPlan[0] : revisedPlan;
      expect(revisedEvent.type).toBe("project.context-run-revised");
      const revised = yield* projectEvent(pendingReview, {
        ...revisedEvent,
        sequence: 4,
        eventId: EventId.make("evt-context-run-revised"),
      });
      expect(revised.projectContextRuns[0]).toMatchObject({
        status: "pending",
        result: null,
        changes: [],
        scopeViolationPaths: [],
        prompt: "Revise AGENTS.md to explain the primary verification command.",
      });

      const revisionStartedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.start",
          commandId: CommandId.make("cmd-context-run-revision-start"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          providerThreadId: ThreadId.make("project-context:context-run-1"),
          createdAt: "2026-01-01T00:04:00.000Z",
        },
        readModel: revised,
      });
      const revisionStarted = Array.isArray(revisionStartedPlan)
        ? revisionStartedPlan[0]
        : revisionStartedPlan;
      const revisionRunning = yield* projectEvent(revised, {
        ...revisionStarted,
        sequence: 5,
        eventId: EventId.make("evt-context-run-revision-started"),
      });
      const revisionReviewPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.pending-review",
          commandId: CommandId.make("cmd-context-run-revision-review"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          result: "Revised project guidance.",
          changes: [
            {
              path: "AGENTS.md",
              beforeRawContent: null,
              afterRawContent: "# Project instructions\n\nRun bun typecheck.\n",
            },
          ],
          scopeViolationPaths: [],
          createdAt: "2026-01-01T00:05:00.000Z",
        },
        readModel: revisionRunning,
      });
      const revisionReview = Array.isArray(revisionReviewPlan)
        ? revisionReviewPlan[0]
        : revisionReviewPlan;
      const revisionPendingReview = yield* projectEvent(revisionRunning, {
        ...revisionReview,
        sequence: 6,
        eventId: EventId.make("evt-context-run-revision-review"),
      });

      const commitPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.commit",
          commandId: CommandId.make("cmd-context-run-commit"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          commitHash: ProjectContextRunGitObjectId.make("f".repeat(40)),
          resultSchemaVersion: ProjectContextSchemaVersion.make(1),
          resultFingerprint: ProjectContextFingerprint.make(`sha256:${"f".repeat(64)}`),
          createdAt: "2026-01-01T00:06:00.000Z",
        },
        readModel: revisionPendingReview,
      });
      expect(Array.isArray(commitPlan)).toBe(true);
      if (Array.isArray(commitPlan)) {
        expect(commitPlan.map((event) => event.type)).toEqual([
          "project.context-run-committed",
          "project.context-completed",
        ]);
        const committed = yield* projectEvent(revisionPendingReview, {
          ...commitPlan[0],
          sequence: 7,
          eventId: EventId.make("evt-context-run-committed"),
        });
        const completed = yield* projectEvent(committed, {
          ...commitPlan[1],
          sequence: 8,
          eventId: EventId.make("evt-project-context-completed"),
        });
        expect(completed.projectContextRuns[0]).toMatchObject({
          status: "completed",
          resolution: "committed",
          resultFingerprint: ProjectContextFingerprint.make(`sha256:${"f".repeat(64)}`),
        });
        expect(completed.projects[0]?.projectContextResolution).toMatchObject({
          outcome: "completed",
          fingerprint: ProjectContextFingerprint.make(`sha256:${"f".repeat(64)}`),
        });
      }
    }),
  );

  it.effect("allows pending failure and running interruption as terminal transitions", () =>
    Effect.gen(function* () {
      const initial = readModel();
      const requestedPlan = yield* decideOrchestrationCommand({
        command: request(),
        orchestratorDefaults: defaults,
        readModel: initial,
      });
      const requested = Array.isArray(requestedPlan) ? requestedPlan[0] : requestedPlan;
      const pending = yield* projectEvent(initial, {
        ...requested,
        sequence: 1,
        eventId: EventId.make("evt-context-run-terminal-requested"),
      });

      const failedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.fail",
          commandId: CommandId.make("cmd-context-run-fail"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          message: "Provider failed.",
          createdAt: "2026-01-01T00:01:00.000Z",
        },
        readModel: pending,
      });
      const failedEvent = Array.isArray(failedPlan) ? failedPlan[0] : failedPlan;
      expect(failedEvent.type).toBe("project.context-run-failed");
      const failed = yield* projectEvent(pending, {
        ...failedEvent,
        sequence: 2,
        eventId: EventId.make("evt-context-run-failed"),
      });
      expect(failed.projectContextRuns[0]).toMatchObject({
        status: "failed",
        failureMessage: "Provider failed.",
        failedAt: "2026-01-01T00:01:00.000Z",
      });

      const startedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.start",
          commandId: CommandId.make("cmd-context-run-terminal-start"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          providerThreadId: ThreadId.make("project-context:context-run-1"),
          createdAt: "2026-01-01T00:01:00.000Z",
        },
        readModel: pending,
      });
      const startedEvent = Array.isArray(startedPlan) ? startedPlan[0] : startedPlan;
      const running = yield* projectEvent(pending, {
        ...startedEvent,
        sequence: 2,
        eventId: EventId.make("evt-context-run-terminal-started"),
      });
      const interruptedPlan = yield* decideOrchestrationCommand({
        command: {
          type: "project.context.run.interrupt",
          commandId: CommandId.make("cmd-context-run-interrupt"),
          projectContextRunId: ProjectContextRunId.make("context-run-1"),
          createdAt: "2026-01-01T00:02:00.000Z",
        },
        readModel: running,
      });
      const interruptedEvent = Array.isArray(interruptedPlan)
        ? interruptedPlan[0]
        : interruptedPlan;
      expect(interruptedEvent.type).toBe("project.context-run-interrupted");
      const interrupted = yield* projectEvent(running, {
        ...interruptedEvent,
        sequence: 3,
        eventId: EventId.make("evt-context-run-interrupted"),
      });
      expect(interrupted.projectContextRuns[0]).toMatchObject({
        status: "interrupted",
        interruptedAt: "2026-01-01T00:02:00.000Z",
      });
    }),
  );

  it.effect("rejects workspace audit manifests that are not uniquely code-unit sorted", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decideOrchestrationCommand({
          command: request({
            workspaceStatusManifest: [
              {
                relativePath: "z.ts",
                porcelainStatus: " M",
                contentDigest: null,
              },
              {
                relativePath: "a.ts",
                porcelainStatus: "??",
                contentDigest: ProjectContextRunContentDigest.make(`sha256:${"c".repeat(64)}`),
              },
            ],
          }),
          orchestratorDefaults: defaults,
          readModel: readModel(),
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );
});
