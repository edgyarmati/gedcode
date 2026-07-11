import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  GedRoleModelSelections,
  GedRolePromptPrefixes,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationGateResolutionOrigin,
  OrchestratorPlaybookFrontmatter,
  OrchestrationStageHistory,
  OrchestrationStageRole,
  OrchestrationTaskStatus,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationTask,
  ProjectCreateCommand,
  ThreadMetaUpdatedPayload,
  OrchestratorClearPmChatInput,
  OrchestratorSetTaskRoleSelectionsInput,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ThreadId } from "./baseSchemas.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFullThreadDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFullThreadDiffInput);
const decodeThreadTurnDiff = Schema.decodeUnknownEffect(ThreadTurnDiff);
const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const encodeThreadCreatedPayload = Schema.encodeEffect(ThreadCreatedPayload);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const encodeOrchestrationCommand = Schema.encodeEffect(OrchestrationCommand);
const encodeOrchestrationEvent = Schema.encodeEffect(OrchestrationEvent);
const decodeOrchestrationTask = Schema.decodeUnknownEffect(OrchestrationTask);
const encodeOrchestrationTask = Schema.encodeEffect(OrchestrationTask);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeRoleModelSelections = Schema.decodeUnknownEffect(GedRoleModelSelections);
const decodeRolePromptPrefixes = Schema.decodeUnknownEffect(GedRolePromptPrefixes);
const decodeStageHistory = Schema.decodeUnknownEffect(OrchestrationStageHistory);
const decodeStageRole = Schema.decodeUnknownEffect(OrchestrationStageRole);
const decodeTaskStatus = Schema.decodeUnknownEffect(OrchestrationTaskStatus);
const decodeGateResolutionOrigin = Schema.decodeUnknownEffect(OrchestrationGateResolutionOrigin);
const decodePlaybookFrontmatter = Schema.decodeUnknownEffect(OrchestratorPlaybookFrontmatter);
const decodeOrchestratorSetTaskRoleSelectionsInput = Schema.decodeUnknownEffect(
  OrchestratorSetTaskRoleSelectionsInput,
);
const decodeOrchestratorClearPmChatInput = Schema.decodeUnknownEffect(OrchestratorClearPmChatInput);

it.effect("parses turn diff input when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
    });
    assert.strictEqual(parsed.fromTurnCount, 1);
    assert.strictEqual(parsed.toTurnCount, 2);
  }),
);

it.effect("parses turn diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeTurnDiffInput({
      threadId: "thread-1",
      fromTurnCount: 1,
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("parses full thread diff input with whitespace ignoring enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeFullThreadDiffInput({
      threadId: "thread-1",
      toTurnCount: 2,
      ignoreWhitespace: true,
    });
    assert.strictEqual(parsed.ignoreWhitespace, true);
  }),
);

it.effect("rejects turn diff input when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeTurnDiffInput({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("rejects thread turn diff when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeThreadTurnDiff({
        threadId: "thread-1",
        fromTurnCount: 3,
        toTurnCount: 2,
        diff: "patch",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "codex");
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes playbook frontmatter and trims string fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decodePlaybookFrontmatter({
      name: " feature-orchestration ",
      description: " Feature orchestration playbook. ",
    });
    assert.strictEqual(parsed.name, "feature-orchestration");
    assert.strictEqual(parsed.description, "Feature orchestration playbook.");
  }),
);

it.effect("rejects playbook frontmatter fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodePlaybookFrontmatter({
        name: "feature-orchestration",
        description: "  ",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.instanceId, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    if (archived.type !== "thread.archived") {
      assert.fail(`Expected thread.archived event, received ${archived.type}.`);
    }
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "reasoningEffort"), "high");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "fastMode"), true);
  }),
);

it.effect("normalizes legacy object-shaped modelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Legacy options thread",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,
          // Falsy/garbage entries are dropped, matching migration 026.
          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      },
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.modelSelection.instanceId, ProviderInstanceId.make("claudeAgent"));
    assert.deepStrictEqual(parsed.modelSelection.options, [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ]);
  }),
);

it.effect("normalizes legacy object-shaped defaultModelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Legacy default project",
      workspaceRoot: "/tmp/legacy",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
        options: { reasoningEffort: "low" },
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(parsed.defaultModelSelection?.options, [
      { id: "reasoningEffort", value: "low" },
    ]);
  }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeThreadCreatedPayload({
        threadId: "thread-1",
        projectId: "project-1",
        title: "Round trip thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: true },
        },
        branch: null,
        worktreePath: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const encoded = yield* encodeThreadCreatedPayload(decoded);
      assert.deepStrictEqual(encoded.modelSelection.options, [{ id: "fastMode", value: true }]);
    }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("decodes task.stage.block commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "task.stage.block",
      commandId: "cmd-stage-block",
      taskId: "task-1",
      stageThreadId: "thread-stage-1",
      role: "work",
      reason: "quota",
      providerInstanceId: "codex",
      resetAt: "2026-01-01T00:10:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.type, "task.stage.block");
    if (parsed.type === "task.stage.block") {
      assert.strictEqual(parsed.providerInstanceId, "codex");
      assert.strictEqual(parsed.reason, "quota");
      assert.strictEqual(parsed.resetAt, "2026-01-01T00:10:00.000Z");
    }
  }),
);

it.effect("decodes task.stage-blocked events through the orchestration event union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-stage-blocked",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.stage-blocked",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-stage-block",
      causationEventId: null,
      correlationId: "cmd-stage-block",
      metadata: {},
      payload: {
        taskId: "task-1",
        role: "work",
        stageThreadId: "thread-stage-1",
        reason: "quota",
        providerInstanceId: "codex",
        resetAt: "2026-01-01T00:10:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    assert.strictEqual(parsed.type, "task.stage-blocked");
    if (parsed.type === "task.stage-blocked") {
      assert.strictEqual(parsed.payload.providerInstanceId, "codex");
      assert.strictEqual(parsed.payload.reason, "quota");
    }
  }),
);

it.effect("round-trips task.pr.opened commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "task.pr.opened",
      commandId: "cmd-pr-opened",
      taskId: "task-1",
      prUrl: " https://github.com/acme/repo/pull/42 ",
      prNumber: 42,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const reDecoded = yield* decodeOrchestrationCommand(yield* encodeOrchestrationCommand(parsed));

    assert.strictEqual(reDecoded.type, "task.pr.opened");
    if (reDecoded.type === "task.pr.opened") {
      assert.strictEqual(reDecoded.prUrl, "https://github.com/acme/repo/pull/42");
      assert.strictEqual(reDecoded.prNumber, 42);
    }
  }),
);

it.effect("round-trips thread.clear commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.clear",
      commandId: "cmd-thread-clear",
      threadId: "pm:project-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const reDecoded = yield* decodeOrchestrationCommand(yield* encodeOrchestrationCommand(parsed));

    assert.strictEqual(reDecoded.type, "thread.clear");
    if (reDecoded.type === "thread.clear") {
      assert.strictEqual(reDecoded.threadId, "pm:project-1");
    }
  }),
);

it.effect("round-trips PM handoff commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const request = yield* decodeOrchestrationCommand({
      type: "thread.pm-handoff.request",
      commandId: "cmd-pm-handoff-request",
      threadId: "pm:project-1",
      mode: "summary",
      brief: "Brief",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const complete = yield* decodeOrchestrationCommand({
      type: "thread.pm-handoff.complete",
      commandId: "cmd-pm-handoff-complete",
      threadId: "pm:project-1",
      mode: "summary",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const reDecodedRequest = yield* decodeOrchestrationCommand(
      yield* encodeOrchestrationCommand(request),
    );
    const reDecodedComplete = yield* decodeOrchestrationCommand(
      yield* encodeOrchestrationCommand(complete),
    );

    assert.strictEqual(reDecodedRequest.type, "thread.pm-handoff.request");
    if (reDecodedRequest.type === "thread.pm-handoff.request") {
      assert.strictEqual(reDecodedRequest.mode, "summary");
      assert.strictEqual(reDecodedRequest.brief, "Brief");
    }
    assert.strictEqual(reDecodedComplete.type, "thread.pm-handoff.complete");
    if (reDecodedComplete.type === "thread.pm-handoff.complete") {
      assert.strictEqual(reDecodedComplete.mode, "summary");
    }
  }),
);

it.effect("round-trips thread.cleared events through the orchestration event union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-thread-cleared",
      aggregateKind: "thread",
      aggregateId: "pm:project-1",
      type: "thread.cleared",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-thread-clear",
      causationEventId: null,
      correlationId: "cmd-thread-clear",
      metadata: {},
      payload: {
        threadId: "pm:project-1",
        clearedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const reDecoded = yield* decodeOrchestrationEvent(yield* encodeOrchestrationEvent(parsed));

    assert.strictEqual(reDecoded.type, "thread.cleared");
    if (reDecoded.type === "thread.cleared") {
      assert.strictEqual(reDecoded.payload.threadId, "pm:project-1");
    }
  }),
);

it.effect("round-trips PM handoff events through the orchestration event union", () =>
  Effect.gen(function* () {
    const requested = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-pm-handoff-requested",
      aggregateKind: "thread",
      aggregateId: "pm:project-1",
      type: "thread.pm-handoff-requested",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-pm-handoff-request",
      causationEventId: null,
      correlationId: "cmd-pm-handoff-request",
      metadata: {},
      payload: {
        threadId: "pm:project-1",
        mode: "summary",
        brief: "Brief",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const completed = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "evt-pm-handoff-completed",
      aggregateKind: "thread",
      aggregateId: "pm:project-1",
      type: "thread.pm-handoff-completed",
      occurredAt: "2026-01-01T00:00:01.000Z",
      commandId: "cmd-pm-handoff-complete",
      causationEventId: null,
      correlationId: "cmd-pm-handoff-complete",
      metadata: {},
      payload: {
        threadId: "pm:project-1",
        mode: "summary",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    });

    const reDecodedRequested = yield* decodeOrchestrationEvent(
      yield* encodeOrchestrationEvent(requested),
    );
    const reDecodedCompleted = yield* decodeOrchestrationEvent(
      yield* encodeOrchestrationEvent(completed),
    );

    assert.strictEqual(reDecodedRequested.type, "thread.pm-handoff-requested");
    if (reDecodedRequested.type === "thread.pm-handoff-requested") {
      assert.strictEqual(reDecodedRequested.payload.brief, "Brief");
    }
    assert.strictEqual(reDecodedCompleted.type, "thread.pm-handoff-completed");
    if (reDecodedCompleted.type === "thread.pm-handoff-completed") {
      assert.strictEqual(reDecodedCompleted.payload.mode, "summary");
    }
  }),
);

it.effect("round-trips task.pr-opened events through the orchestration event union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-pr-opened",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.pr-opened",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-pr-opened",
      causationEventId: null,
      correlationId: "cmd-pr-opened",
      metadata: {},
      payload: {
        taskId: "task-1",
        prUrl: " https://github.com/acme/repo/pull/42 ",
        prNumber: 42,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const reDecoded = yield* decodeOrchestrationEvent(yield* encodeOrchestrationEvent(parsed));

    assert.strictEqual(reDecoded.type, "task.pr-opened");
    if (reDecoded.type === "task.pr-opened") {
      assert.strictEqual(reDecoded.payload.prUrl, "https://github.com/acme/repo/pull/42");
      assert.strictEqual(reDecoded.payload.prNumber, 42);
    }
  }),
);

it.effect("decodes OrchestrationTask.prUrl with a null default and round-trips opened URLs", () =>
  Effect.gen(function* () {
    const decodedDefault = yield* decodeOrchestrationTask({
      id: "task-1",
      projectId: "project-1",
      type: "feature",
      title: "Task",
      status: "draft",
      branch: "orchestrator/task-1",
      worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
      pmMessageId: "pm-message-1",
      stageThreadIds: [],
      currentStageThreadId: null,
      playbookVersion: "feature@v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(decodedDefault.prUrl, null);

    const decodedOpened = yield* decodeOrchestrationTask({
      ...decodedDefault,
      prUrl: " https://github.com/acme/repo/pull/42 ",
    });
    const reDecoded = yield* decodeOrchestrationTask(yield* encodeOrchestrationTask(decodedOpened));
    assert.strictEqual(reDecoded.prUrl, "https://github.com/acme/repo/pull/42");
  }),
);

it.effect("decodes legacy OrchestrationTask values without cancellation metadata", () =>
  Effect.gen(function* () {
    const legacyTask = {
      id: "task-legacy",
      projectId: "project-1",
      type: "feature",
      title: "Legacy task",
      status: "working",
      branch: "orchestrator/task-legacy",
      worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-legacy",
      pmMessageId: null,
      stageThreadIds: ["thread-work"],
      currentStageThreadId: "thread-work",
      playbookVersion: "feature@v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
    };

    const decoded = yield* decodeOrchestrationTask(legacyTask);
    const reDecoded = yield* decodeOrchestrationTask(yield* encodeOrchestrationTask(decoded));

    assert.strictEqual(decoded.cancellation, undefined);
    assert.strictEqual(reDecoded.cancellation, undefined);
    assert.strictEqual(reDecoded.currentStageThreadId, "thread-work");
  }),
);

it.effect("accepts review and verify stage roles plus reviewing task status", () =>
  Effect.gen(function* () {
    const review = yield* decodeStageRole("review");
    const verify = yield* decodeStageRole("verify");
    const reviewing = yield* decodeTaskStatus("reviewing");

    assert.strictEqual(review, "review");
    assert.strictEqual(verify, "verify");
    assert.strictEqual(reviewing, "reviewing");
  }),
);

it.effect("role model selections are keyed only by known stage roles", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeRoleModelSelections({
      review: {
        instanceId: "codex_review",
        model: "gpt-5.2",
      },
      verify: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
    });

    assert.strictEqual(parsed.review?.instanceId, ProviderInstanceId.make("codex_review"));
    assert.strictEqual(parsed.verify?.instanceId, ProviderInstanceId.make("claudeAgent"));

    const result = yield* Effect.exit(
      decodeRoleModelSelections({
        verfiy: {
          instanceId: "codex",
          model: "gpt-5.2",
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("role prompt prefixes are keyed only by known stage roles", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeRolePromptPrefixes({
      review: "Focus on plan defects.",
      verify: "Run targeted verification before reporting success.",
    });

    assert.strictEqual(parsed.review, "Focus on plan defects.");
    assert.strictEqual(parsed.verify, "Run targeted verification before reporting success.");

    const result = yield* Effect.exit(
      decodeRolePromptPrefixes({
        verfy: "typo",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes task role-selection commands and narrows persisted event origin", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "task.role-selections.set",
      commandId: "cmd-role-selections",
      taskId: "task-1",
      roleModelSelections: {
        review: {
          instanceId: "codex_review",
          model: "gpt-5.2",
        },
      },
      origin: "human",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "task.role-selections.set");

    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-role-selections",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.role-selections-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-role-selections",
      causationEventId: null,
      correlationId: "cmd-role-selections",
      metadata: {},
      payload: {
        taskId: "task-1",
        roleModelSelections: {
          review: {
            instanceId: "codex_review",
            model: "gpt-5.2",
          },
        },
        origin: "client",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "task.role-selections-updated");

    const pmEvent = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "evt-role-selections-pm",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.role-selections-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-role-selections",
      causationEventId: null,
      correlationId: "cmd-role-selections",
      metadata: {},
      payload: {
        taskId: "task-1",
        roleModelSelections: {},
        origin: "pm-runtime",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(pmEvent.type, "task.role-selections-updated");
  }),
);

it.effect("decodes system gate-resolution origin for internal engine decisions", () =>
  Effect.gen(function* () {
    const origin = yield* decodeGateResolutionOrigin("system");
    assert.strictEqual(origin, "system");
  }),
);

it.effect("decodes task role-selection websocket input with role-keyed selections", () =>
  Effect.gen(function* () {
    const input = yield* decodeOrchestratorSetTaskRoleSelectionsInput({
      taskId: "task-1",
      roleModelSelections: {
        work: {
          instanceId: "codex_task",
          model: "gpt-5.2",
        },
      },
    });
    assert.strictEqual(input.taskId, "task-1");
    assert.strictEqual(input.roleModelSelections.work?.instanceId, "codex_task");

    const result = yield* Effect.exit(
      decodeOrchestratorSetTaskRoleSelectionsInput({
        taskId: "task-1",
        roleModelSelections: {
          wrk: {
            instanceId: "codex_task",
            model: "gpt-5.2",
          },
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes clear PM chat websocket input", () =>
  Effect.gen(function* () {
    const input = yield* decodeOrchestratorClearPmChatInput({
      projectId: "project-1",
    });
    assert.strictEqual(input.projectId, "project-1");
  }),
);

it.effect("decodes stage history keyed by stage thread id", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeStageHistory({
      "thread-stage-1": {
        projectId: "project-1",
        taskId: "task-1",
        stageThreadId: "thread-stage-1",
        role: "verify",
        providerInstanceId: "codex_verify",
        model: "gpt-5.2",
        status: "blocked",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:10:00.000Z",
      },
    });

    const stage = parsed[ThreadId.make("thread-stage-1")];
    assert.strictEqual(stage?.role, "verify");
    assert.strictEqual(stage?.providerInstanceId, "codex_verify");
    assert.strictEqual(stage?.status, "blocked");
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

// ── ModelSelection: instance-keyed wire shape + legacy decoder ────────
//
// `ModelSelection` is routing-keyed on `instanceId` — never a driver kind.
// Persisted and in-flight payloads from pre-instance builds carry a
// `provider` field whose value was a driver kind; those payloads are migrated
// at the wire boundary by
// promoting `provider` to the default instance id for that driver
// (built-in drivers use the driver kind slug as their default instance id, so
// the migration is a 1:1 rename).
//
// These tests pin the rollback/fork tolerance invariant: legacy payloads
// decode cleanly for fork-provided drivers, and the decoded form uses
// `instanceId` uniformly regardless of origin.

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection accepts an explicit instanceId routing key", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect("ModelSelection encodes to the canonical instanceId wire form", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeModelSelection({
      provider: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
    const encoded = yield* encodeModelSelection(decoded);
    assert.deepStrictEqual(encoded, {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
  }),
);

it.effect("ModelSelection rejects malformed instance ids", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeModelSelection({
        instanceId: "1invalid", // must start with a letter
        model: "x",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
