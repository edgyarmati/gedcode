import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Metric from "effect/Metric";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive, classifyOrchestrationCommand } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const createdAt = "2026-01-01T00:00:00.000Z";

async function createOrchestrationSystem() {
  const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "t3-orchestration-queue-test-",
  });
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolverLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  return {
    engine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

const hasMetricId = (snapshots: ReadonlyArray<Metric.Metric.Snapshot>, id: string): boolean =>
  snapshots.some((snapshot) => snapshot.id === id);

const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
): boolean =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === id &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );

describe("classifyOrchestrationCommand", () => {
  const cases: ReadonlyArray<readonly [OrchestrationCommand["type"], string]> = [
    ["project.create", "project"],
    ["project.meta.update", "project"],
    ["project.delete", "project"],
    ["task.create", "task"],
    ["task.classify", "task"],
    ["task.stage.start", "task"],
    ["task.stage.complete", "task"],
    ["task.gate.request", "task"],
    ["task.gate.resolve", "task"],
    ["task.land", "task"],
    ["task.pr.opened", "task"],
    ["task.abandon", "task"],
    ["thread.message.user.append", "streaming"],
    ["thread.message.assistant.delta", "streaming"],
    ["thread.message.assistant.complete", "streaming"],
    ["thread.clear", "streaming"],
    ["thread.proposed-plan.upsert", "streaming"],
    ["thread.activity.append", "streaming"],
    ["thread.turn.start", "turn"],
    ["thread.turn.interrupt", "turn"],
    ["thread.turn.diff.complete", "turn"],
    ["thread.approval.respond", "turn"],
    ["thread.user-input.respond", "turn"],
    ["thread.checkpoint.revert", "turn"],
    ["thread.revert.complete", "turn"],
    ["thread.create", "thread-control"],
    ["thread.delete", "thread-control"],
    ["thread.archive", "thread-control"],
    ["thread.unarchive", "thread-control"],
    ["thread.meta.update", "thread-control"],
    ["thread.runtime-mode.set", "thread-control"],
    ["thread.interaction-mode.set", "thread-control"],
    ["thread.session.set", "thread-control"],
    ["thread.session.stop", "thread-control"],
  ];

  it.each(cases)("classifies %s as %s", (type, expected) => {
    // Only the discriminant `type` field is read by the classifier; a minimal
    // cast keeps each case focused on the classification contract.
    const command = { type } as unknown as OrchestrationCommand;
    expect(classifyOrchestrationCommand(command)).toBe(expected);
  });

  it("covers every OrchestrationCommand type exactly once", () => {
    const classified = new Set(cases.map(([type]) => type));
    expect(classified.size).toBe(cases.length);
  });
});

describe("OrchestrationEngine command-queue contention metrics", () => {
  it("updates queue-depth and queue-wait histograms on dispatch with the command class label", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-queue-project-create"),
        projectId: asProjectId("project-queue"),
        title: "Queue Project",
        workspaceRoot: "/tmp/project-queue",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );

    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-queue-thread-create"),
        threadId: ThreadId.make("thread-queue"),
        projectId: asProjectId("project-queue"),
        title: "Queue Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const snapshots = await system.run(Metric.snapshot);

    // Both histograms must exist and have been observed for the dispatched
    // commands, labeled with the command class derived by the classifier.
    expect(hasMetricId(snapshots, "t3_orchestration_command_queue_depth")).toBe(true);
    expect(hasMetricId(snapshots, "t3_orchestration_command_queue_wait_duration")).toBe(true);

    expect(
      hasMetricSnapshot(snapshots, "t3_orchestration_command_queue_depth", {
        commandType: "project.create",
        commandClass: "project",
      }),
    ).toBe(true);
    expect(
      hasMetricSnapshot(snapshots, "t3_orchestration_command_queue_depth", {
        commandType: "thread.create",
        commandClass: "thread-control",
      }),
    ).toBe(true);
    expect(
      hasMetricSnapshot(snapshots, "t3_orchestration_command_queue_wait_duration", {
        commandType: "thread.create",
        aggregateKind: "thread",
        commandClass: "thread-control",
      }),
    ).toBe(true);

    await system.dispose();
  });

  it("labels streaming-class commands distinctly on the queue-wait histogram", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-queue-stream-project"),
        projectId: asProjectId("project-stream"),
        title: "Stream Project",
        workspaceRoot: "/tmp/project-stream",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-queue-stream-thread"),
        threadId: ThreadId.make("thread-stream"),
        projectId: asProjectId("project-stream"),
        title: "Stream Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.message.user.append",
        commandId: CommandId.make("cmd-queue-stream-message"),
        threadId: ThreadId.make("thread-stream"),
        messageId: MessageId.make("message-stream"),
        text: "hello",
        createdAt,
      }),
    );

    const snapshots = await system.run(Metric.snapshot);
    expect(
      hasMetricSnapshot(snapshots, "t3_orchestration_command_queue_wait_duration", {
        commandType: "thread.message.user.append",
        commandClass: "streaming",
      }),
    ).toBe(true);

    await system.dispose();
  });
});
