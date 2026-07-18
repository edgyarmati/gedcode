import {
  CommandId,
  EventId,
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionHelperRunRepository } from "../../persistence/Services/ProjectionHelperRuns.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";

const layer = OrchestrationProjectionPipelineLive.pipe(
  Layer.provideMerge(OrchestrationEventStoreLive),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "helper-projection-test-" })),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(layer)("helper run projection replay", (it) => {
  it.effect("retains terminal results and restart identity after replay", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore;
      const pipeline = yield* OrchestrationProjectionPipeline;
      const repository = yield* ProjectionHelperRunRepository;
      const projectId = ProjectId.make("project-helper-replay");
      const helperRunId = HelperRunId.make("helper-replay");
      const now = "2026-07-18T01:00:00.000Z";

      yield* store.append({
        eventId: EventId.make("event-helper-project"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("command-helper-project"),
        causationEventId: null,
        correlationId: CommandId.make("command-helper-project"),
        metadata: {},
        payload: {
          projectId,
          title: "Helper replay project",
          workspaceRoot: "/tmp/helper-replay-project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* store.append({
        eventId: EventId.make("event-helper-request"),
        aggregateKind: "helper-run",
        aggregateId: helperRunId,
        type: "helper.run-requested",
        occurredAt: now,
        commandId: CommandId.make("command-helper-request"),
        causationEventId: null,
        correlationId: CommandId.make("command-helper-request"),
        metadata: {},
        payload: {
          helperRunId,
          projectId,
          attachment: { kind: "pm", threadId: ThreadId.make("pm:project-helper-replay") },
          accessMode: "read-only",
          tier: "cheap",
          providerInstanceId: ProviderInstanceId.make("codex-cheap"),
          model: "gpt-cheap",
          modelOptions: null,
          prompt: "Find the projection boundary.",
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* store.append({
        eventId: EventId.make("event-helper-start"),
        aggregateKind: "helper-run",
        aggregateId: helperRunId,
        type: "helper.run-started",
        occurredAt: now,
        commandId: CommandId.make("command-helper-start"),
        causationEventId: null,
        correlationId: CommandId.make("command-helper-start"),
        metadata: {},
        payload: {
          helperRunId,
          providerThreadId: ThreadId.make("provider-helper-replay"),
          startedAt: now,
          updatedAt: now,
        },
      });
      yield* store.append({
        eventId: EventId.make("event-helper-complete"),
        aggregateKind: "helper-run",
        aggregateId: helperRunId,
        type: "helper.run-completed",
        occurredAt: now,
        commandId: CommandId.make("command-helper-complete"),
        causationEventId: null,
        correlationId: CommandId.make("command-helper-complete"),
        metadata: {},
        payload: {
          helperRunId,
          result: "Projection results are retained independently from tasks.",
          completedAt: now,
          updatedAt: now,
        },
      });

      yield* pipeline.bootstrap;
      const first = yield* repository.getById({ helperRunId });
      assert.strictEqual(first._tag, "Some");
      if (first._tag !== "Some") return;
      assert.strictEqual(first.value.status, "completed");
      assert.strictEqual(first.value.providerThreadId, "provider-helper-replay");
      assert.strictEqual(
        first.value.result,
        "Projection results are retained independently from tasks.",
      );

      yield* pipeline.bootstrap;
      const retained = yield* repository.listByProjectId({ projectId });
      assert.strictEqual(retained.length, 1);
      assert.strictEqual(retained[0]?.id, helperRunId);

      const attached = yield* repository.listByThreadId({
        threadId: ThreadId.make("pm:project-helper-replay"),
      });
      assert.strictEqual(attached.length, 1);
      assert.strictEqual(attached[0]?.id, helperRunId);
      assert.strictEqual(attached[0]?.providerThreadId, "provider-helper-replay");
    }),
  );
});
