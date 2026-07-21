import {
  EventId,
  ProjectContextFingerprint,
  ProjectContextRunId,
  ProjectContextSchemaVersion,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectContextRun,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { ProjectionProjectContextRunRepository } from "../../persistence/Services/ProjectionProjectContextRuns.ts";
import { ProviderQuotaStatusRepository } from "../../persistence/Services/ProviderQuotaStatus.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { makeProjectContextSnapshot } from "../../project/ProjectContext.ts";
import { ProjectContextScanner } from "../../project/Services/ProjectContextScanner.ts";
import { GedManifestError, GedManifestManager } from "../../project/Services/GedManifest.ts";
import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import type { VcsProcessOutput } from "../../vcs/VcsProcess.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { PmProjectRuntimeFactory } from "../Services/PmRuntime.ts";
import {
  ProjectContextRunReactor,
  type ProjectContextRunReactorShape,
} from "../Services/ProjectContextRunReactor.ts";
import {
  makeProjectContextRunReactor,
  projectContextRunThreadId,
} from "./ProjectContextRunReactor.ts";

const now = "2026-07-20T11:00:00.000Z";
const projectId = ProjectId.make("project-context-reactor");
const instanceId = ProviderInstanceId.make("context-smart-instance");
const primaryCheckoutPath = "/private/tmp";
const digest = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}` as const;

const initialSnapshot = makeProjectContextSnapshot({
  files: [
    { relativePath: "AGENTS.md", classification: "substantive", normalizedContent: "# Old" },
    { relativePath: "CONTEXT.md", classification: "missing", normalizedContent: "" },
  ],
  ownershipBaseline: {
    files: [
      {
        relativePath: "AGENTS.md",
        state: {
          presence: "present",
          digest: digest("# Old\n"),
          size: 6,
          content: "# Old\n",
        },
      },
      {
        relativePath: "CONTEXT.md",
        state: { presence: "absent", digest: null, size: 0, content: null },
      },
    ],
  },
});

const changedSnapshot = makeProjectContextSnapshot({
  files: [
    { relativePath: "AGENTS.md", classification: "substantive", normalizedContent: "# New" },
    {
      relativePath: "CONTEXT.md",
      classification: "substantive",
      normalizedContent: "# Context",
    },
  ],
  ownershipBaseline: {
    files: [
      {
        relativePath: "AGENTS.md",
        state: {
          presence: "present",
          digest: digest("# New\n"),
          size: 6,
          content: "# New\n",
        },
      },
      {
        relativePath: "CONTEXT.md",
        state: {
          presence: "present",
          digest: digest("# Context\n"),
          size: 10,
          content: "# Context\n",
        },
      },
    ],
  },
});

const makeRun = (id: string): OrchestrationProjectContextRun => ({
  id: ProjectContextRunId.make(id),
  projectId,
  mode: "populate",
  tier: "smart",
  providerInstanceId: instanceId,
  model: "resolved-smart-model",
  modelOptions: [{ id: "effort", value: "high" }],
  primaryCheckoutPath,
  schemaVersion: ProjectContextSchemaVersion.make(1),
  fingerprint: ProjectContextFingerprint.make(`sha256:${"a".repeat(64)}`),
  prompt: `Populate context for ${id}`,
  baselineManifest: [
    { path: "AGENTS.md", rawContent: "# Old\n" },
    { path: "CONTEXT.md", rawContent: null },
  ],
  workspaceStatusManifest: [],
  gitState: {
    head: "a".repeat(40),
    headIdentity: { kind: "branch", ref: "refs/heads/main" },
    stagedIndexDigest: digest(""),
    refsDigest: digest(""),
    configDigest: digest(""),
    hooksDigest: digest("absent"),
    infoExcludeDigest: digest("absent"),
    infoAttributesDigest: digest("absent"),
    infoGraftsDigest: digest("absent"),
  } as OrchestrationProjectContextRun["gitState"],
  status: "pending",
  pmStartState: "ready",
  providerThreadId: null,
  result: null,
  failureMessage: null,
  changes: [],
  scopeViolationPaths: [],
  resolution: null,
  commitHash: null,
  resultSchemaVersion: null,
  resultFingerprint: null,
  createdAt: now,
  startedAt: null,
  pendingReviewAt: null,
  failedAt: null,
  interruptedAt: null,
  resolvedAt: null,
  updatedAt: now,
});

const makeHarness = (driver = "codex") =>
  Effect.gen(function* () {
    const providerEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
    const runs = new Map<string, OrchestrationProjectContextRun>();
    const commands: OrchestrationCommand[] = [];
    const sessionStarts: ProviderSessionStartInput[] = [];
    const turnInputs: string[] = [];
    const stopped: ThreadId[] = [];
    const interruptedTurns: ThreadId[] = [];
    const sessionStarted = yield* Deferred.make<void>();
    const pendingReview = yield* Deferred.make<void>();
    const applied = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const failed = yield* Deferred.make<void>();
    const sessionStopped = yield* Deferred.make<void>();
    let pmWaits = 0;
    let pmInterrupted = false;
    const activeSessions: ProviderSession[] = [];
    let quotaStatus: "ok" | "blocked-until" | "blocked-unknown" = "ok";
    let quotaResetAt: string | null = null;
    let statusOutput = "";
    let manifestWritesEnabled = false;
    let stagedIndexOutput = "";
    let refsOutput = "";
    let configOutput = "";
    let snapshot = initialSnapshot;
    let startFailure: string | null = null;
    let scannerFailure: string | null = null;
    let projectState: "active" | "deleted" | "missing" = "active";

    const repositoryLayer = Layer.succeed(ProjectionProjectContextRunRepository, {
      upsert: (run) => Effect.sync(() => void runs.set(String(run.id), run)),
      getById: ({ projectContextRunId }) =>
        Effect.succeed(Option.fromNullishOr(runs.get(String(projectContextRunId)))),
      listByProjectId: ({ projectId: requested }) =>
        Effect.succeed([...runs.values()].filter((run) => run.projectId === requested)),
      listActiveByProjectId: ({ projectId: requested }) =>
        Effect.succeed(
          [...runs.values()].filter(
            (run) =>
              run.projectId === requested && (run.status === "pending" || run.status === "running"),
          ),
        ),
      listAll: () => Effect.succeed([...runs.values()]),
    });

    const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
      Effect.gen(function* () {
        commands.push(command);
        if (!("projectContextRunId" in command)) return { sequence: 1 };
        const current = runs.get(String(command.projectContextRunId));
        if (current === undefined) return { sequence: 1 };
        if (command.type === "project.context.run.start") {
          runs.set(String(current.id), {
            ...current,
            status: "running",
            providerThreadId: command.providerThreadId,
            startedAt: command.createdAt,
            updatedAt: command.createdAt,
          });
        } else if (command.type === "project.context.run.pending-review") {
          runs.set(String(current.id), {
            ...current,
            status: "pending-review",
            result: command.result,
            failureMessage: null,
            changes: command.changes,
            scopeViolationPaths: command.scopeViolationPaths,
            pendingReviewAt: command.createdAt,
            updatedAt: command.createdAt,
          });
          yield* Deferred.succeed(pendingReview, undefined);
        } else if (command.type === "project.context.run.apply") {
          runs.set(String(current.id), {
            ...current,
            status: "completed",
            result: command.result,
            changes: command.changes,
            scopeViolationPaths: [],
            resolution: "applied",
            resultSchemaVersion: command.resultSchemaVersion,
            resultFingerprint: command.resultFingerprint,
            resolvedAt: command.createdAt,
            updatedAt: command.createdAt,
          });
          yield* Deferred.succeed(applied, undefined);
        } else if (command.type === "project.context.run.refresh-baseline") {
          runs.set(String(current.id), {
            ...current,
            schemaVersion: command.schemaVersion,
            fingerprint: command.fingerprint,
            baselineManifest: command.baselineManifest,
            workspaceStatusManifest: command.workspaceStatusManifest,
            gitState: command.gitState,
            pmStartState: "ready",
            updatedAt: command.createdAt,
          });
        } else if (command.type === "project.context.run.fail") {
          runs.set(String(current.id), {
            ...current,
            status: "failed",
            failureMessage: command.message,
            failedAt: command.createdAt,
            updatedAt: command.createdAt,
          });
          yield* Deferred.succeed(failed, undefined);
        } else if (command.type === "project.context.run.interrupt") {
          runs.set(String(current.id), {
            ...current,
            status: "interrupted",
            interruptedAt: command.createdAt,
            updatedAt: command.createdAt,
          });
          yield* Deferred.succeed(interrupted, undefined);
        }
        return { sequence: 1 };
      });

    const engine: OrchestrationEngineShape = {
      dispatch,
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.fromPubSub(domainEvents),
      streamShellEvents: Stream.empty,
    };
    const provider: ProviderServiceShape = {
      startSession: (threadId, input) =>
        Effect.gen(function* () {
          sessionStarts.push(input);
          if (startFailure !== null) return yield* Effect.die(new Error(startFailure));
          yield* Deferred.succeed(sessionStarted, undefined);
          return {
            provider: ProviderDriverKind.make(driver),
            providerInstanceId: instanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            threadId,
            cwd: input.cwd,
            model: input.modelSelection?.model,
            createdAt: now,
            updatedAt: now,
          } as ProviderSession;
        }),
      sendTurn: (input) =>
        Effect.sync(() => {
          turnInputs.push(input.input ?? "");
          return { threadId: input.threadId, turnId: TurnId.make(`turn:${input.threadId}`) };
        }),
      interruptTurn: ({ threadId }) => Effect.sync(() => void interruptedTurns.push(threadId)),
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: ({ threadId }) =>
        Effect.gen(function* () {
          stopped.push(threadId);
          yield* Deferred.succeed(sessionStopped, undefined);
        }),
      listSessions: () => Effect.succeed(activeSessions),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      getInstanceInfo: (requested) =>
        Effect.succeed({
          instanceId: requested,
          driverKind: ProviderDriverKind.make(driver),
          displayName: undefined,
          enabled: true,
          continuationIdentity: {
            driverKind: ProviderDriverKind.make(driver),
            continuationKey: `${driver}:${requested}`,
          },
        }),
      rollbackConversation: () => Effect.void,
      forkConversation: () => Effect.die("not used"),
      streamEvents: Stream.fromPubSub(providerEvents),
    };

    const layer = Layer.effect(ProjectContextRunReactor, makeProjectContextRunReactor).pipe(
      Layer.provideMerge(repositoryLayer),
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
      Layer.provideMerge(Layer.succeed(ProviderService, provider)),
      Layer.provideMerge(
        Layer.mock(GedManifestManager)({
          inspect: () => Effect.die("not used"),
          adoptLegacy: () => Effect.die("not used"),
          writeCurrent: () =>
            manifestWritesEnabled
              ? Effect.succeed({
                  status: "current" as const,
                  sourceSchemaVersion: 3,
                  manifest: {
                    schemaVersion: 3,
                    updatedAt: now,
                    lastReviewedAt: now,
                    generatedBy: "gedcode@0.3.0",
                  },
                })
              : Effect.fail(
                  new GedManifestError({
                    workspaceRoot: primaryCheckoutPath,
                    operation: "writeCurrent",
                    detail: "test requires pending review",
                  }),
                ),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ServerEnvironment)({
          getEnvironmentId: Effect.die("not used"),
          getDescriptor: Effect.succeed({ serverVersion: "0.3.0" } as never),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ProjectionSnapshotQuery)({
          getCommandReadModel: () =>
            Effect.succeed({
              projects:
                projectState === "missing"
                  ? []
                  : [
                      {
                        id: projectId,
                        deletedAt: projectState === "deleted" ? now : null,
                      },
                    ],
            } as unknown as OrchestrationReadModel),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ProviderQuotaStatusRepository)({
          isInstanceQuotaBlocked: ({ providerInstanceId }) =>
            Effect.succeed({
              providerInstanceId,
              status: quotaStatus,
              blocked: quotaStatus !== "ok",
              resetAt: quotaResetAt,
            }),
          observeRuntimeStatus: ({ providerInstanceId, runtimeStatus }) =>
            Effect.sync(() => {
              const previousStatus = quotaStatus;
              quotaStatus = runtimeStatus === "exhausted" ? "blocked-unknown" : "ok";
              quotaResetAt = null;
              return Option.some({
                providerInstanceId,
                previousStatus,
                nextStatus: quotaStatus,
                resetAt: null,
              });
            }),
          markBlocked: ({ providerInstanceId }) =>
            Effect.sync(() => {
              const previousStatus = quotaStatus;
              quotaStatus = "blocked-unknown";
              quotaResetAt = null;
              return {
                providerInstanceId,
                previousStatus,
                nextStatus: quotaStatus,
                resetAt: null,
              };
            }),
          upsert: (row) =>
            Effect.sync(() => {
              const previousStatus = quotaStatus;
              quotaStatus = row.status;
              quotaResetAt = row.resetAt;
              return {
                providerInstanceId: row.providerInstanceId,
                previousStatus,
                nextStatus: row.status,
                resetAt: row.resetAt,
              };
            }),
          getByProviderInstanceId: () => Effect.succeed(Option.none()),
          listBlocked: () =>
            Effect.succeed(
              quotaStatus === "ok"
                ? []
                : [
                    {
                      providerInstanceId: instanceId,
                      status: quotaStatus,
                      resetAt: quotaResetAt,
                      updatedAt: now,
                    },
                  ],
            ),
        }),
      ),
      Layer.provideMerge(
        Layer.succeed(PmProjectRuntimeFactory, {
          getOrCreate: () => Effect.die("not used"),
          waitForIdle: () =>
            Effect.sync(() => {
              pmWaits += 1;
            }),
          interruptActive: () =>
            Effect.sync(() => {
              pmInterrupted = true;
            }),
          invalidateRuntime: () => Effect.void,
          clearSessionStorage: () => Effect.void,
          resetSessionBinding: () => Effect.void,
          createHandoffBrief: () => Effect.succeed(Option.none()),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ProjectContextScanner)({
          scan: () =>
            scannerFailure === null
              ? Effect.succeed(snapshot)
              : Effect.die(new Error(scannerFailure)),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(VcsProcess)({
          run: (input) => {
            const stdout =
              input.operation === "ProjectContextWorkspaceAudit.status"
                ? statusOutput
                : input.operation === "ProjectContextWorkspaceAudit.head"
                  ? `${"a".repeat(40)}\n`
                  : input.operation === "ProjectContextWorkspaceAudit.symbolicHead"
                    ? "refs/heads/main\n"
                    : input.operation === "ProjectContextWorkspaceAudit.stagedIndex"
                      ? stagedIndexOutput
                      : input.operation === "ProjectContextWorkspaceAudit.refs"
                        ? refsOutput
                        : input.operation === "ProjectContextWorkspaceAudit.config"
                          ? configOutput
                          : input.operation === "ProjectContextWorkspaceAudit.gitDir" ||
                              input.operation === "ProjectContextWorkspaceAudit.gitCommonDir"
                            ? `${primaryCheckoutPath}/.git\n`
                            : input.operation === "ProjectContextWorkspaceAudit.defaultHooksPath"
                              ? `${primaryCheckoutPath}/.git/hooks\n`
                              : input.operation ===
                                  "ProjectContextWorkspaceAudit.configuredHooksPath"
                                ? "hooks\n"
                                : "";
            return Effect.succeed({
              exitCode: 0,
              stdout,
              stderr: "",
              stdoutTruncated: false,
              stderrTruncated: false,
            } as VcsProcessOutput);
          },
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    return {
      layer,
      runs,
      commands,
      sessionStarts,
      turnInputs,
      stopped,
      interruptedTurns,
      providerEvents,
      sessionStarted,
      pendingReview,
      applied,
      interrupted,
      failed,
      sessionStopped,
      setQuotaBlocked: (blocked: boolean) => {
        quotaStatus = blocked ? "blocked-unknown" : "ok";
        quotaResetAt = null;
      },
      enableManifestWrites: () => {
        manifestWritesEnabled = true;
      },
      setQuotaBlockedUntil: (resetAt: string) => {
        quotaStatus = "blocked-until";
        quotaResetAt = resetAt;
      },
      setActiveSessions: (sessions: ReadonlyArray<ProviderSession>) => {
        activeSessions.splice(0, activeSessions.length, ...sessions);
      },
      setStatusOutput: (next: string) => {
        statusOutput = next;
      },
      setGitAuditOutput: (kind: "stagedIndex" | "refs" | "config", next: string) => {
        if (kind === "stagedIndex") stagedIndexOutput = next;
        else if (kind === "refs") refsOutput = next;
        else configOutput = next;
      },
      setSnapshot: (next: typeof initialSnapshot) => {
        snapshot = next;
      },
      setStartFailure: (message: string | null) => {
        startFailure = message;
      },
      setScannerFailure: (message: string | null) => {
        scannerFailure = message;
      },
      setProjectState: (next: "active" | "deleted" | "missing") => {
        projectState = next;
      },
      pmWaitCount: () => pmWaits,
      wasPmInterrupted: () => pmInterrupted,
    };
  });

const completedEvent = (threadId: ThreadId): ProviderRuntimeEvent => ({
  eventId: EventId.make(`event-completed:${threadId}`),
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId: instanceId,
  threadId,
  turnId: TurnId.make(`turn:${threadId}`),
  createdAt: now,
  type: "turn.completed",
  payload: { state: "completed" },
});

it.effect("holds a pending context run until PM settlement and refreshes its baseline", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const run = { ...makeRun("context-wait-pm"), pmStartState: "awaiting-user" as const };
        harness.runs.set(String(run.id), run);

        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.strictEqual(harness.sessionStarts.length, 0);

        harness.runs.set(String(run.id), { ...run, pmStartState: "waiting-for-idle" });
        yield* reactor.reconcile;
        assert.strictEqual(harness.pmWaitCount(), 1);
        assert.strictEqual(harness.sessionStarts.length, 0);

        yield* reactor.reconcile;
        yield* Deferred.await(harness.sessionStarted);
        assert.deepStrictEqual(
          harness.commands.map((command) => command.type),
          ["project.context.run.refresh-baseline", "project.context.run.start"],
        );
        assert.deepStrictEqual(harness.turnInputs, [run.prompt]);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("interrupts the PM before refreshing and starting when the user chooses interrupt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const run = { ...makeRun("context-interrupt-pm"), pmStartState: "interrupting" as const };
        harness.runs.set(String(run.id), run);

        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.isTrue(harness.wasPmInterrupted());
        assert.strictEqual(harness.sessionStarts.length, 0);

        yield* reactor.reconcile;
        yield* Deferred.await(harness.sessionStarted);
        assert.deepStrictEqual(harness.turnInputs, [run.prompt]);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect(
  "uses the stamped Smart backend in the primary checkout without orchestration tools",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const run = makeRun("context-smart");
        harness.runs.set(String(run.id), run);

        yield* Effect.gen(function* () {
          const reactor = yield* ProjectContextRunReactor;
          yield* reactor.start();

          assert.deepStrictEqual(harness.turnInputs, [run.prompt]);
          assert.strictEqual(harness.sessionStarts.length, 1);
          assert.deepStrictEqual(harness.sessionStarts[0]?.modelSelection, {
            instanceId,
            model: "resolved-smart-model",
            options: [{ id: "effort", value: "high" }],
          });
          assert.strictEqual(harness.sessionStarts[0]?.cwd, primaryCheckoutPath);
          assert.strictEqual(harness.sessionStarts[0]?.readOnly, false);
          assert.strictEqual(harness.sessionStarts[0]?.enableOrchestrationTools, false);
          assert.strictEqual(harness.sessionStarts[0]?.runtimeMode, "auto-accept-edits");
          assert.strictEqual(harness.sessionStarts[0]?.approvalReviewer, "auto-review");
          assert.strictEqual(
            harness.runs.get(String(run.id))?.providerThreadId,
            projectContextRunThreadId(run.id),
          );
          assert.ok(
            harness.commands.every((command) => command.type.startsWith("project.context.run.")),
          );
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
);

it.effect("retains full access for Claude and OpenCode context sessions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const driver of ["claude", "opencode"]) {
        const harness = yield* makeHarness(driver);
        const run = makeRun(`context-${driver}`);
        harness.runs.set(String(run.id), run);
        yield* Effect.gen(function* () {
          const reactor = yield* ProjectContextRunReactor;
          yield* reactor.start();
          assert.strictEqual(harness.sessionStarts[0]?.runtimeMode, "full-access");
          assert.strictEqual(harness.sessionStarts[0]?.approvalReviewer, undefined);
          assert.strictEqual(harness.sessionStarts[0]?.readOnly, false);
        }).pipe(Effect.provide(harness.layer));
      }
    }),
  ),
);

it.effect("audits raw canonical changes and outside-scope drift into pending review", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-audit");
      harness.runs.set(String(run.id), run);
      harness.setSnapshot(changedSnapshot);
      harness.setStatusOutput("?? src/unexpected.ts\0");
      harness.setGitAuditOutput("stagedIndex", "diff --git a/x b/x\n");

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        const threadId = projectContextRunThreadId(run.id);
        yield* PubSub.publish(harness.providerEvents, completedEvent(threadId));
        yield* Deferred.await(harness.pendingReview).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;

        const reviewed = harness.runs.get(String(run.id));
        assert.strictEqual(reviewed?.status, "pending-review");
        assert.deepStrictEqual(reviewed?.changes, [
          { path: "AGENTS.md", beforeRawContent: "# Old\n", afterRawContent: "# New\n" },
          { path: "CONTEXT.md", beforeRawContent: null, afterRawContent: "# Context\n" },
        ]);
        assert.deepStrictEqual(reviewed?.scopeViolationPaths, [".git/index", "src/unexpected.ts"]);
        assert.ok(harness.stopped.includes(threadId));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("applies clean context maintenance uncommitted after writing the manifest", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-auto-apply");
      harness.runs.set(String(run.id), run);
      harness.setSnapshot(changedSnapshot);
      harness.enableManifestWrites();

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        const threadId = projectContextRunThreadId(run.id);
        yield* PubSub.publish(harness.providerEvents, completedEvent(threadId));
        yield* Deferred.await(harness.applied).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;

        assert.deepInclude(harness.runs.get(String(run.id)), {
          status: "completed",
          resolution: "applied",
          commitHash: null,
        });
        assert.ok(harness.commands.some((command) => command.type === "project.context.run.apply"));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("restarts a pending run while preserving an active running session without replay", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const pending = makeRun("context-restart-pending");
      const runningThreadId = projectContextRunThreadId(
        ProjectContextRunId.make("context-restart-running"),
      );
      const running: OrchestrationProjectContextRun = {
        ...makeRun("context-restart-running"),
        status: "running",
        providerThreadId: runningThreadId,
        startedAt: now,
      };
      harness.runs.set(String(pending.id), pending);
      harness.runs.set(String(running.id), running);
      harness.setActiveSessions([
        {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: "auto-accept-edits",
          threadId: runningThreadId,
          cwd: primaryCheckoutPath,
          model: running.model,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.deepStrictEqual(
          harness.sessionStarts.map((input) => input.threadId),
          [projectContextRunThreadId(pending.id)],
        );
        assert.strictEqual(
          harness.commands.filter((command) => command.type === "project.context.run.start").length,
          1,
        );
        assert.deepStrictEqual(harness.turnInputs, [pending.prompt]);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("audits orphaned running changes into pending review instead of replaying its turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run: OrchestrationProjectContextRun = {
        ...makeRun("context-restart-orphaned-changes"),
        status: "running",
        providerThreadId: projectContextRunThreadId(
          ProjectContextRunId.make("context-restart-orphaned-changes"),
        ),
        startedAt: now,
      };
      harness.runs.set(String(run.id), run);
      harness.setSnapshot(changedSnapshot);

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        yield* Deferred.await(harness.pendingReview).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;

        assert.strictEqual(harness.runs.get(String(run.id))?.status, "pending-review");
        assert.deepStrictEqual(harness.sessionStarts, []);
        assert.deepStrictEqual(harness.turnInputs, []);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("interrupts an orphaned unchanged running run instead of replaying its turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run: OrchestrationProjectContextRun = {
        ...makeRun("context-restart-orphaned-empty"),
        status: "running",
        providerThreadId: projectContextRunThreadId(
          ProjectContextRunId.make("context-restart-orphaned-empty"),
        ),
        startedAt: now,
      };
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        yield* Deferred.await(harness.interrupted).pipe(Effect.timeout("2 seconds"));

        assert.strictEqual(harness.runs.get(String(run.id))?.status, "interrupted");
        assert.deepStrictEqual(harness.sessionStarts, []);
        assert.deepStrictEqual(harness.turnInputs, []);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("interrupts runs on restart when their project is deleted or missing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      for (const projectState of ["deleted", "missing"] as const) {
        const harness = yield* makeHarness();
        const pending = makeRun(`context-${projectState}-pending`);
        const runningThreadId = projectContextRunThreadId(
          ProjectContextRunId.make(`context-${projectState}-running`),
        );
        const running: OrchestrationProjectContextRun = {
          ...makeRun(`context-${projectState}-running`),
          status: "running",
          providerThreadId: runningThreadId,
          startedAt: now,
        };
        harness.runs.set(String(pending.id), pending);
        harness.runs.set(String(running.id), running);
        harness.setProjectState(projectState);

        yield* Effect.gen(function* () {
          const reactor = yield* ProjectContextRunReactor;
          yield* reactor.start();

          assert.strictEqual(harness.sessionStarts.length, 0);
          assert.deepStrictEqual(harness.turnInputs, []);
          assert.strictEqual(harness.runs.get(String(pending.id))?.status, "interrupted");
          assert.strictEqual(harness.runs.get(String(running.id))?.status, "interrupted");
          assert.deepStrictEqual(
            harness.commands.map((command) => command.type),
            ["project.context.run.interrupt", "project.context.run.interrupt"],
          );
          assert.ok(harness.stopped.includes(projectContextRunThreadId(pending.id)));
          assert.ok(harness.stopped.includes(runningThreadId));
        }).pipe(Effect.provide(harness.layer));
      }
    }),
  ),
);

it.effect("holds a pending run while quota-blocked and launches it after recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-quota");
      harness.runs.set(String(run.id), run);
      harness.setQuotaBlocked(true);

      yield* Effect.gen(function* () {
        const reactor: ProjectContextRunReactorShape = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.strictEqual(harness.sessionStarts.length, 0);
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-context-quota-recovered"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId: ThreadId.make("unrelated-provider-thread"),
          createdAt: now,
          type: "account.rate-limits.updated",
          payload: { status: "ok", windows: [] },
        });
        yield* Deferred.await(harness.sessionStarted).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;
        assert.strictEqual(harness.sessionStarts.length, 1);
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "running");
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("resumes a pending run after a known quota reset without provider telemetry", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-quota-reset-without-telemetry");
      harness.runs.set(String(run.id), run);
      harness.setQuotaBlockedUntil(
        DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, Duration.millis(30))),
      );

      yield* Effect.gen(function* () {
        const reactor: ProjectContextRunReactorShape = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.strictEqual(harness.sessionStarts.length, 0);
        yield* TestClock.adjust(Duration.millis(30));
        yield* Deferred.await(harness.sessionStarted).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;

        assert.strictEqual(harness.sessionStarts.length, 1);
        assert.deepStrictEqual(harness.turnInputs, [run.prompt]);
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "running");
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("fails a launch without creating task lifecycle commands", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const launchHarness = yield* makeHarness();
      const launchRun = makeRun("context-launch-failure");
      launchHarness.runs.set(String(launchRun.id), launchRun);
      launchHarness.setStartFailure("provider cannot start");
      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        assert.strictEqual(launchHarness.runs.get(String(launchRun.id))?.status, "failed");
      }).pipe(Effect.provide(launchHarness.layer));
      assert.ok(
        launchHarness.commands.every((command) => command.type.startsWith("project.context.run.")),
      );
    }),
  ),
);

it.effect("fails safely when its completed workspace audit cannot run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-audit-failure");
      harness.runs.set(String(run.id), run);
      harness.setScannerFailure("scanner unavailable");

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        yield* PubSub.publish(
          harness.providerEvents,
          completedEvent(projectContextRunThreadId(run.id)),
        );
        yield* Deferred.await(harness.failed).pipe(Effect.timeout("2 seconds"));
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "failed");
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("fails and stops a context run on a provider runtime error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-provider-failure");
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        const threadId = projectContextRunThreadId(run.id);
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-context-provider-error"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-context-provider-error"),
          createdAt: now,
          type: "runtime.error",
          payload: { class: "provider_error", message: "provider crashed" },
        });
        yield* Deferred.await(harness.failed).pipe(Effect.timeout("2 seconds"));
        yield* Deferred.await(harness.sessionStopped).pipe(Effect.timeout("2 seconds"));
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "failed");
        assert.ok(harness.stopped.includes(threadId));
        assert.ok(
          harness.commands.every((command) => command.type.startsWith("project.context.run.")),
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("settles a provider interruption and stops the stable context session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const run = makeRun("context-interrupted");
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* ProjectContextRunReactor;
        yield* reactor.start();
        const threadId = projectContextRunThreadId(run.id);
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-context-aborted"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-context-aborted"),
          createdAt: now,
          type: "turn.aborted",
          payload: { reason: "operator" },
        });
        yield* Deferred.await(harness.interrupted).pipe(Effect.timeout("2 seconds"));
        yield* Deferred.await(harness.sessionStopped).pipe(Effect.timeout("2 seconds"));
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "interrupted");
        assert.ok(harness.stopped.includes(threadId));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);
