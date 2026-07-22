import {
  CommandId,
  EventId,
  HelperRunId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationHelperRun,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ProjectionHelperRunRepository } from "../../persistence/Services/ProjectionHelperRuns.ts";
import { ProviderQuotaStatusRepository } from "../../persistence/Services/ProviderQuotaStatus.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { createEmptyReadModel } from "../projector.ts";
import { HelperRunReactor, type HelperRunReactorShape } from "../Services/HelperRunReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { helperRunThreadId, makeHelperRunReactor } from "./HelperRunReactor.ts";

const now = "2026-07-18T03:00:00.000Z";
const projectId = ProjectId.make("project-helper-runtime");
const taskId = TaskId.make("task-helper-runtime");
const instanceId = ProviderInstanceId.make("codex-helper");

const makeRun = (
  id: string,
  attachment: OrchestrationHelperRun["attachment"],
): OrchestrationHelperRun => ({
  id: HelperRunId.make(id),
  projectId,
  attachment,
  accessMode: "read-only",
  tier: "cheap",
  providerInstanceId: instanceId,
  model: "gpt-helper",
  modelOptions: [{ id: "effort", value: "low" }],
  prompt: `Inspect for ${id}`,
  status: "pending",
  transientRetryCount: 0,
  providerThreadId: null,
  result: null,
  failureMessage: null,
  createdAt: now,
  startedAt: null,
  completedAt: null,
  updatedAt: now,
});

const readModel = {
  ...createEmptyReadModel(now),
  projects: [
    {
      id: projectId,
      workspaceRoot: "/private/tmp",
    } as OrchestrationReadModel["projects"][number],
  ],
  tasks: [
    {
      id: taskId,
      projectId,
      worktreePath: "/tmp",
    } as OrchestrationReadModel["tasks"][number],
  ],
} satisfies OrchestrationReadModel;

const makeHarnessWith = (input?: {
  readonly existingThreads?: ReadonlyArray<OrchestrationReadModel["threads"][number]>;
}) =>
  Effect.gen(function* () {
    const providerEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const domainEvents = yield* PubSub.unbounded<never>();
    const runs = new Map<string, OrchestrationHelperRun>();
    const sessionStarts: Array<ProviderSessionStartInput> = [];
    const turnInputs: string[] = [];
    const stopped: ThreadId[] = [];
    const commands: OrchestrationCommand[] = [];
    const completed = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const sessionStarted = yield* Deferred.make<void>();
    let quotaBlocked = false;

    const repositoryLayer = Layer.succeed(ProjectionHelperRunRepository, {
      upsert: (run) => Effect.sync(() => void runs.set(String(run.id), run)),
      getById: ({ helperRunId }) =>
        Effect.succeed(Option.fromNullishOr(runs.get(String(helperRunId)))),
      listByProjectId: ({ projectId: requested }) =>
        Effect.succeed([...runs.values()].filter((run) => run.projectId === requested)),
      listByTaskId: ({ taskId: requested }) =>
        Effect.succeed(
          [...runs.values()].filter(
            (run) => run.attachment.kind === "task" && run.attachment.taskId === requested,
          ),
        ),
      listByThreadId: ({ threadId }) =>
        Effect.succeed(
          [...runs.values()].filter(
            (run) => run.attachment.kind === "pm" && run.attachment.threadId === threadId,
          ),
        ),
      listAll: () => Effect.succeed([...runs.values()]),
    });

    const dispatch: OrchestrationEngineShape["dispatch"] = (command: OrchestrationCommand) =>
      Effect.gen(function* () {
        commands.push(command);
        if (command.type === "helper.run.start") {
          const current = runs.get(String(command.helperRunId));
          if (current) {
            runs.set(String(command.helperRunId), {
              ...current,
              status: "running",
              transientRetryCount:
                command.transportRetry === true
                  ? current.transientRetryCount + 1
                  : current.transientRetryCount,
              providerThreadId: command.providerThreadId,
              startedAt: command.createdAt,
              updatedAt: command.createdAt,
            });
          }
        } else if (command.type === "helper.run.complete") {
          const current = runs.get(String(command.helperRunId));
          if (current) {
            runs.set(String(command.helperRunId), {
              ...current,
              status: "completed",
              result: command.result,
              completedAt: command.createdAt,
              updatedAt: command.createdAt,
            });
            yield* Deferred.succeed(completed, undefined);
          }
        } else if (command.type === "helper.run.fail") {
          const current = runs.get(String(command.helperRunId));
          if (current) {
            runs.set(String(command.helperRunId), {
              ...current,
              status: "failed",
              failureMessage: command.message,
              completedAt: command.createdAt,
              updatedAt: command.createdAt,
            });
          }
        } else if (command.type === "helper.run.interrupt") {
          const current = runs.get(String(command.helperRunId));
          if (current) {
            runs.set(String(command.helperRunId), {
              ...current,
              status: "interrupted",
              completedAt: command.createdAt,
              updatedAt: command.createdAt,
            });
            yield* Deferred.succeed(interrupted, undefined);
          }
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
          yield* Deferred.succeed(sessionStarted, undefined);
          return {
            provider: ProviderDriverKind.make("codex"),
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
          return {
            threadId: input.threadId,
            turnId: TurnId.make(`turn:${input.threadId}`),
          };
        }),
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      stopSession: ({ threadId }) => Effect.sync(() => void stopped.push(threadId)),
      listSessions: () => Effect.succeed([]),
      getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
      getInstanceInfo: (requested) =>
        Effect.succeed({
          instanceId: requested,
          driverKind: ProviderDriverKind.make("codex"),
          displayName: undefined,
          enabled: true,
          continuationIdentity: {
            driverKind: ProviderDriverKind.make("codex"),
            continuationKey: `codex:${requested}`,
          },
        }),
      rollbackConversation: () => Effect.void,
      forkConversation: () => Effect.die("not used"),
      streamEvents: Stream.fromPubSub(providerEvents),
    };

    const snapshotReadModel: OrchestrationReadModel = {
      ...readModel,
      threads: [...(input?.existingThreads ?? readModel.threads)],
    };

    const layer = Layer.effect(HelperRunReactor, makeHelperRunReactor).pipe(
      Layer.provideMerge(repositoryLayer),
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
      Layer.provideMerge(Layer.succeed(ProviderService, provider)),
      Layer.provideMerge(
        Layer.mock(ProjectionSnapshotQuery)({
          getCommandReadModel: () => Effect.succeed(snapshotReadModel),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(ProviderQuotaStatusRepository)({
          isInstanceQuotaBlocked: ({ providerInstanceId }) =>
            Effect.succeed({
              providerInstanceId,
              status: quotaBlocked ? "blocked-unknown" : "ok",
              blocked: quotaBlocked,
              resetAt: null,
            }),
          observeRuntimeStatus: ({ providerInstanceId, runtimeStatus }) =>
            Effect.sync(() => {
              const previousStatus = quotaBlocked ? ("blocked-unknown" as const) : ("ok" as const);
              quotaBlocked = runtimeStatus === "exhausted";
              return Option.some({
                providerInstanceId,
                previousStatus,
                nextStatus: quotaBlocked ? ("blocked-unknown" as const) : ("ok" as const),
                resetAt: null,
              });
            }),
          markBlocked: ({ providerInstanceId }) =>
            Effect.sync(() => {
              const previousStatus = quotaBlocked ? ("blocked-unknown" as const) : ("ok" as const);
              quotaBlocked = true;
              return {
                providerInstanceId,
                previousStatus,
                nextStatus: "blocked-unknown" as const,
                resetAt: null,
              };
            }),
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    return {
      layer,
      runs,
      sessionStarts,
      turnInputs,
      stopped,
      commands,
      providerEvents,
      completed,
      interrupted,
      sessionStarted,
      setQuotaBlocked: (blocked: boolean) => {
        quotaBlocked = blocked;
      },
    };
  });

const makeHarness = makeHarnessWith();

it.effect("creates a persistently owned helper thread before launching its provider session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const run = makeRun("helper-owned-thread", { kind: "task", taskId });
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();

        const created = harness.commands.find((command) => command.type === "thread.create");
        assert.ok(created !== undefined && created.type === "thread.create");
        assert.deepStrictEqual(
          { ...created, createdAt: "created-now" },
          {
            type: "thread.create",
            commandId: CommandId.make("server:helper-thread-create:helper-owned-thread:runtime"),
            threadId: helperRunThreadId(run.id),
            projectId,
            orchestrationOwnership: { kind: "helper", helperRunId: run.id },
            title: "Read-only exploration helper",
            modelSelection: {
              instanceId,
              model: "gpt-helper",
              options: [{ id: "effort", value: "low" }],
            },
            gedWorkflowEnabled: false,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: "/tmp",
            createdAt: "created-now",
          },
        );
        assert.strictEqual(harness.sessionStarts.length, 1);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("does not retrofit ownership onto an existing helper-id thread", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const run = makeRun("helper-legacy-thread", { kind: "task", taskId });
      const harness = yield* makeHarnessWith({
        existingThreads: [
          {
            id: helperRunThreadId(run.id),
          } as OrchestrationReadModel["threads"][number],
        ],
      });
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        assert.ok(!harness.commands.some((command) => command.type === "thread.create"));
        assert.strictEqual(harness.sessionStarts.length, 1);
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("uses project and task roots, enforces read-only, and retains bounded output", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const pmRun = makeRun("helper-pm", {
        kind: "pm",
        threadId: ThreadId.make("pm:project-helper-runtime"),
      });
      const taskRun = makeRun("helper-task", { kind: "task", taskId });
      harness.runs.set(String(pmRun.id), pmRun);
      harness.runs.set(String(taskRun.id), taskRun);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        assert.deepStrictEqual(
          harness.sessionStarts.map((input) => input.cwd),
          ["/private/tmp", "/tmp"],
        );
        assert.ok(harness.sessionStarts.every((input) => input.readOnly === true));
        assert.ok(harness.sessionStarts.every((input) => input.enableOrchestrationTools === false));
        assert.deepStrictEqual(harness.turnInputs, [
          "Inspect for helper-pm",
          "Inspect for helper-task",
        ]);

        const threadId = helperRunThreadId(taskRun.id);
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-task-delta"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-task"),
          createdAt: now,
          type: "content.delta",
          payload: {
            streamKind: "assistant_text",
            delta: `Authorization: Bearer ${"x".repeat(40)}\nFound task context.`,
          },
        });
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-task-complete"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-task"),
          createdAt: now,
          type: "turn.completed",
          payload: { state: "completed" },
        });
        yield* Deferred.await(harness.completed).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;

        const completed = harness.runs.get(String(taskRun.id));
        assert.strictEqual(completed?.status, "completed");
        assert.ok(completed?.result?.includes("Found task context."));
        assert.ok(!completed?.result?.includes("x".repeat(40)));
        assert.ok(harness.stopped.includes(threadId));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("holds pending helpers on quota and starts them on provider recovery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const run = makeRun("helper-quota", { kind: "task", taskId });
      harness.runs.set(String(run.id), run);
      harness.setQuotaBlocked(true);

      yield* Effect.gen(function* () {
        const reactor: HelperRunReactorShape = yield* HelperRunReactor;
        yield* reactor.start();
        assert.strictEqual(harness.sessionStarts.length, 0);
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "pending");

        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-quota-recovered"),
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

it.effect("restarts a running helper with the same identity without another lifecycle start", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const id = HelperRunId.make("helper-restart");
      const run: OrchestrationHelperRun = {
        ...makeRun(String(id), { kind: "task", taskId }),
        status: "running",
        providerThreadId: helperRunThreadId(id),
        startedAt: now,
      };
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        assert.strictEqual(harness.sessionStarts.length, 1);
        assert.strictEqual(harness.sessionStarts[0]?.threadId, helperRunThreadId(id));
        assert.deepStrictEqual(harness.turnInputs, ["Inspect for helper-restart"]);
        assert.ok(!harness.commands.some((command) => command.type === "helper.run.start"));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("settles and stops a helper when its provider turn is aborted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const run = makeRun("helper-interrupt", { kind: "task", taskId });
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        const threadId = helperRunThreadId(run.id);
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-aborted"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-aborted"),
          createdAt: now,
          type: "turn.aborted",
          payload: { reason: "operator" },
        });
        yield* Deferred.await(harness.interrupted).pipe(Effect.timeout("2 seconds"));
        yield* reactor.drain;
        assert.strictEqual(harness.runs.get(String(run.id))?.status, "interrupted");
        assert.ok(harness.stopped.includes(threadId));
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("retries one clearly transient helper transport failure with the same run identity", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const run = makeRun("helper-transient-retry", { kind: "task", taskId });
      harness.runs.set(String(run.id), run);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        const threadId = helperRunThreadId(run.id);

        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-transport-failure"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-transient-retry"),
          createdAt: now,
          type: "runtime.error",
          payload: {
            class: "transport_error",
            message: "connection reset by peer",
          },
        });
        for (let index = 0; index < 20 && harness.sessionStarts.length < 2; index += 1) {
          yield* Effect.yieldNow;
        }
        yield* reactor.drain;

        assert.strictEqual(harness.runs.get(String(run.id))?.status, "running");
        assert.deepStrictEqual(
          harness.sessionStarts.map((input) => input.threadId),
          [threadId, threadId],
        );
        assert.deepStrictEqual(harness.turnInputs, [run.prompt, run.prompt]);
        assert.ok(!harness.commands.some((command) => command.type === "helper.run.fail"));

        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-transport-failure-final"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-transient-retry-final"),
          createdAt: now,
          type: "runtime.error",
          payload: {
            class: "transport_error",
            message: "connection reset by peer",
          },
        });
        for (
          let index = 0;
          index < 20 && !harness.commands.some((command) => command.type === "helper.run.fail");
          index += 1
        ) {
          yield* Effect.yieldNow;
        }
        yield* reactor.drain;

        assert.strictEqual(harness.runs.get(String(run.id))?.status, "failed");
        assert.strictEqual(harness.sessionStarts.length, 2);
        assert.strictEqual(
          harness.commands.filter((command) => command.type === "helper.run.fail").length,
          1,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
  ),
);

it.effect("does not grant a second transport retry after the helper reactor restarts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const run = makeRun("helper-transient-retry-restart", {
        kind: "task",
        taskId,
      });
      harness.runs.set(String(run.id), run);
      const threadId = helperRunThreadId(run.id);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-transport-before-restart"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-transport-before-restart"),
          createdAt: now,
          type: "runtime.error",
          payload: {
            class: "transport_error",
            message: "connection reset by peer",
          },
        });
        for (let index = 0; index < 20 && harness.sessionStarts.length < 2; index += 1) {
          yield* Effect.yieldNow;
        }
        yield* reactor.drain;
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      assert.strictEqual(harness.runs.get(String(run.id))?.transientRetryCount, 1);

      yield* Effect.gen(function* () {
        const reactor = yield* HelperRunReactor;
        yield* reactor.start();
        for (let index = 0; index < 20 && harness.sessionStarts.length < 3; index += 1) {
          yield* Effect.yieldNow;
        }
        yield* PubSub.publish(harness.providerEvents, {
          eventId: EventId.make("event-helper-transport-after-restart"),
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          threadId,
          turnId: TurnId.make("turn-helper-transport-after-restart"),
          createdAt: now,
          type: "runtime.error",
          payload: {
            class: "transport_error",
            message: "connection reset by peer",
          },
        });
        for (
          let index = 0;
          index < 20 && !harness.commands.some((command) => command.type === "helper.run.fail");
          index += 1
        ) {
          yield* Effect.yieldNow;
        }
        yield* reactor.drain;
      }).pipe(Effect.scoped, Effect.provide(harness.layer));

      assert.strictEqual(harness.sessionStarts.length, 3);
      assert.strictEqual(harness.runs.get(String(run.id))?.status, "failed");
      assert.strictEqual(
        harness.commands.filter((command) => command.type === "helper.run.start").length,
        2,
      );
    }),
  ),
);

it.effect(
  "does not retry quota, authentication, capability, or provider/model helper failures",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const cases = [
          {
            id: "helper-no-retry-quota",
            payload: {
              class: "rate_limit" as const,
              message: "quota exhausted",
            },
          },
          {
            id: "helper-no-retry-auth",
            payload: {
              class: "provider_error" as const,
              message: "authentication required",
            },
          },
          {
            id: "helper-no-retry-capability",
            payload: {
              class: "permission_error" as const,
              message: "permission denied",
            },
          },
          {
            id: "helper-no-retry-provider",
            payload: {
              class: "provider_error" as const,
              message: "model unavailable",
            },
          },
        ];
        const runs = cases.map((entry) => makeRun(entry.id, { kind: "task", taskId }));
        for (const run of runs) {
          harness.runs.set(String(run.id), run);
        }

        yield* Effect.gen(function* () {
          const reactor = yield* HelperRunReactor;
          yield* reactor.start();
          for (const [index, entry] of cases.entries()) {
            const run = runs[index]!;
            yield* PubSub.publish(harness.providerEvents, {
              eventId: EventId.make(`event-${entry.id}`),
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId: instanceId,
              threadId: helperRunThreadId(run.id),
              turnId: TurnId.make(`turn-${entry.id}`),
              createdAt: now,
              type: "runtime.error",
              payload: entry.payload,
            });
          }
          for (
            let index = 0;
            index < 20 &&
            harness.commands.filter((command) => command.type === "helper.run.fail").length < 4;
            index += 1
          ) {
            yield* Effect.yieldNow;
          }
          yield* reactor.drain;

          assert.strictEqual(harness.sessionStarts.length, cases.length);
          assert.ok(runs.every((run) => harness.runs.get(String(run.id))?.status === "failed"));
          assert.strictEqual(
            harness.commands.filter((command) => command.type === "helper.run.fail").length,
            cases.length,
          );
        }).pipe(Effect.provide(harness.layer));
      }),
    ),
);
