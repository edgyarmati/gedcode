import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { HelperRunId, ProjectId, ThreadId } from "./baseSchemas.ts";
import {
  HELPER_RUN_RESULT_MAX_CHARS,
  OrchestrationCommand,
  OrchestrationHelperRun,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeRun = Schema.decodeUnknownEffect(OrchestrationHelperRun);
const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand);

const run = {
  id: HelperRunId.make("helper-contract"),
  projectId: ProjectId.make("project-contract"),
  attachment: { kind: "pm" as const, threadId: ThreadId.make("pm:project-contract") },
  accessMode: "read-only" as const,
  tier: "smart" as const,
  providerInstanceId: ProviderInstanceId.make("codex-smart"),
  model: "gpt-smart",
  modelOptions: null,
  prompt: "Inspect the codebase.",
  status: "completed" as const,
  transientRetryCount: 0,
  providerThreadId: ThreadId.make("provider-contract"),
  result: "Bounded result",
  failureMessage: null,
  createdAt: "2026-07-18T00:00:00.000Z",
  startedAt: "2026-07-18T00:00:01.000Z",
  completedAt: "2026-07-18T00:00:02.000Z",
  updatedAt: "2026-07-18T00:00:02.000Z",
};

it.effect("decodes a helper run without task lifecycle fields", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeRun(run);
    assert.strictEqual(decoded.attachment.kind, "pm");
    assert.strictEqual(decoded.status, "completed");
    assert.strictEqual(decoded.transientRetryCount, 0);
    assert.ok(!Object.hasOwn(decoded, "stageThreadIds"));
    assert.ok(!Object.hasOwn(decoded, "pendingGates"));
    assert.ok(!Object.hasOwn(decoded, "worktreePath"));
  }),
);

it.effect("rejects oversized persisted helper results", () =>
  Effect.gen(function* () {
    const decoded = yield* Effect.exit(
      decodeRun({ ...run, result: "x".repeat(HELPER_RUN_RESULT_MAX_CHARS + 1) }),
    );
    assert.strictEqual(decoded._tag, "Failure");
  }),
);

it.effect("requires a task or PM attachment on helper requests", () =>
  Effect.gen(function* () {
    const decoded = yield* Effect.exit(
      decodeCommand({
        type: "helper.run.request",
        commandId: "command-helper-contract",
        helperRunId: "helper-contract",
        projectId: "project-contract",
        attachment: { kind: "project" },
        tier: "cheap",
        prompt: "Inspect",
        createdAt: "2026-07-18T00:00:00.000Z",
      }),
    );
    assert.strictEqual(decoded._tag, "Failure");
  }),
);
