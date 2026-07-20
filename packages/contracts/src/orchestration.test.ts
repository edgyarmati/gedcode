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
  OrchestrationForkThreadInput,
  OrchestrationForkThreadResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationLatestTurn,
  OrchestrationGateResolutionOrigin,
  OrchestratorPlaybookFrontmatter,
  OrchestrationStageHistory,
  OrchestrationStageRole,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationTask,
  ProjectCreateCommand,
  ProjectContextRunContentDigest,
  PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS,
  PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS,
  PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS,
  ThreadMetaUpdatedPayload,
  OrchestratorClearPmChatInput,
  OrchestratorRpcSchemas,
  OrchestratorSetTaskCapabilityTiersInput,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnDiff,
  ThreadTurnStartRequestedPayload,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ProjectId, ThreadId } from "./baseSchemas.ts";

const decodeTurnDiffInput = Schema.decodeUnknownEffect(OrchestrationGetTurnDiffInput);
const decodeFullThreadDiffInput = Schema.decodeUnknownEffect(OrchestrationGetFullThreadDiffInput);
const decodeForkThreadInput = Schema.decodeUnknownEffect(OrchestrationForkThreadInput);
const decodeForkThreadResult = Schema.decodeUnknownEffect(OrchestrationForkThreadResult);
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
const decodeOrchestrationProject = Schema.decodeUnknownEffect(OrchestrationProject);
const decodeOrchestrationReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
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
const decodeGateResolutionOrigin = Schema.decodeUnknownEffect(OrchestrationGateResolutionOrigin);
const decodePlaybookFrontmatter = Schema.decodeUnknownEffect(OrchestratorPlaybookFrontmatter);
const decodeOrchestratorSetTaskCapabilityTiersInput = Schema.decodeUnknownEffect(
  OrchestratorSetTaskCapabilityTiersInput,
);
const decodeOrchestratorClearPmChatInput = Schema.decodeUnknownEffect(OrchestratorClearPmChatInput);
const decodeOrchestratorRequestProjectContextRunInput = Schema.decodeUnknownEffect(
  OrchestratorRpcSchemas.requestProjectContextRun.input,
);

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

it.effect(
  "defaults missing project-context resolution to null for legacy project projections",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeOrchestrationProject({
        id: "project-1",
        title: "Project Title",
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      });

      assert.strictEqual(parsed.projectContextResolution, null);
    }),
);

it.effect("decodes an internal project-context resolution command and its dismissal event", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "project.context.resolve",
      commandId: "cmd-context-dismiss",
      projectId: "project-1",
      schemaVersion: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
      outcome: "dismissed",
      resolvedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "project.context.resolve");

    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-context-dismiss",
      aggregateKind: "project",
      aggregateId: "project-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-context-dismiss",
      causationEventId: null,
      correlationId: "cmd-context-dismiss",
      metadata: {},
      type: "project.context-dismissed",
      payload: {
        projectId: "project-1",
        schemaVersion: 1,
        fingerprint: `sha256:${"a".repeat(64)}`,
        dismissedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "project.context-dismissed");
  }),
);

it.effect("exposes only project and optional tier for project-context run requests", () =>
  Effect.gen(function* () {
    const input = yield* decodeOrchestratorRequestProjectContextRunInput({
      projectId: "project-1",
      tier: "genius",
      baselineManifest: [{ path: "AGENTS.md", rawContent: "spoofed" }],
      commandId: "spoofed-command",
      expectedPrimaryCheckoutPath: "/spoofed-project-root",
    });

    assert.deepStrictEqual(input, { projectId: ProjectId.make("project-1"), tier: "genius" });
  }),
);

it.effect("requires project-context runs in orchestration read models", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeOrchestrationReadModel({
        snapshotSequence: 0,
        projects: [],
        threads: [],
        tasks: [],
        helperRuns: [],
        pendingGates: [],
        quotaBlockedStages: [],
        stageHistory: {},
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes a bounded project-context request without caller prompt or backend fields", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "project.context.run.request",
      commandId: "cmd-context-run",
      projectContextRunId: "context-run-1",
      projectId: "project-1",
      expectedPrimaryCheckoutPath: "/repo/project-1",
      mode: "populate",
      schemaVersion: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
      baselineManifest: [{ path: "AGENTS.md", rawContent: null }],
      workspaceStatusManifest: [
        {
          relativePath: "src/index.ts",
          porcelainStatus: " M",
          contentDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
        },
      ],
      gitState: {
        head: null,
        headIdentity: { kind: "branch", ref: "refs/heads/main" },
        stagedIndexDigest: ProjectContextRunContentDigest.make(`sha256:${"c".repeat(64)}`),
        refsDigest: ProjectContextRunContentDigest.make(`sha256:${"d".repeat(64)}`),
        configDigest: ProjectContextRunContentDigest.make(`sha256:${"e".repeat(64)}`),
        hooksDigest: ProjectContextRunContentDigest.make(`sha256:${"f".repeat(64)}`),
        infoExcludeDigest: ProjectContextRunContentDigest.make(`sha256:${"0".repeat(64)}`),
        infoAttributesDigest: ProjectContextRunContentDigest.make(`sha256:${"1".repeat(64)}`),
        infoGraftsDigest: ProjectContextRunContentDigest.make(`sha256:${"2".repeat(64)}`),
      },
      prompt: "caller prompt must be ignored",
      providerInstanceId: "caller-provider",
      model: "caller-model",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "project.context.run.request");
    if (command.type === "project.context.run.request") {
      assert.strictEqual(command.expectedPrimaryCheckoutPath, "/repo/project-1");
      assert.strictEqual("prompt" in command, false);
      assert.strictEqual("providerInstanceId" in command, false);
      assert.strictEqual("model" in command, false);
      assert.deepStrictEqual(command.workspaceStatusManifest, [
        {
          relativePath: "src/index.ts",
          porcelainStatus: " M",
          contentDigest: ProjectContextRunContentDigest.make(`sha256:${"b".repeat(64)}`),
        },
      ]);
    }
  }),
);

it.effect("enforces project-context path and prompt/result/failure bounds", () =>
  Effect.gen(function* () {
    const badPath = yield* Effect.exit(
      decodeOrchestrationCommand({
        type: "project.context.run.request",
        commandId: "cmd-context-run-bad-path",
        projectContextRunId: "context-run-bad-path",
        projectId: "project-1",
        mode: "review",
        schemaVersion: 1,
        fingerprint: `sha256:${"a".repeat(64)}`,
        baselineManifest: [{ path: "src/index.ts", rawContent: "source" }],
        workspaceStatusManifest: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(badPath._tag, "Failure");

    const longResult = yield* Effect.exit(
      decodeOrchestrationCommand({
        type: "project.context.run.pending-review",
        commandId: "cmd-context-run-result",
        projectContextRunId: "context-run-1",
        result: "r".repeat(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS + 1),
        changes: [],
        scopeViolationPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(longResult._tag, "Failure");

    const longFailure = yield* Effect.exit(
      decodeOrchestrationCommand({
        type: "project.context.run.fail",
        commandId: "cmd-context-run-failure",
        projectContextRunId: "context-run-1",
        message: "f".repeat(PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS + 1),
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(longFailure._tag, "Failure");

    const longPromptEvent = yield* Effect.exit(
      decodeOrchestrationEvent({
        sequence: 1,
        eventId: "event-context-run-requested",
        aggregateKind: "project-context-run",
        aggregateId: "context-run-1",
        occurredAt: "2026-01-01T00:00:00.000Z",
        commandId: "cmd-context-run",
        causationEventId: null,
        correlationId: "cmd-context-run",
        metadata: {},
        type: "project.context-run-requested",
        payload: {
          projectContextRunId: "context-run-1",
          projectId: "project-1",
          mode: "populate",
          tier: "smart",
          providerInstanceId: "codex",
          model: "gpt",
          modelOptions: null,
          primaryCheckoutPath: "/repo",
          schemaVersion: 1,
          fingerprint: `sha256:${"a".repeat(64)}`,
          prompt: "p".repeat(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS + 1),
          baselineManifest: [],
          workspaceStatusManifest: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    assert.strictEqual(longPromptEvent._tag, "Failure");
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
      gedWorkflowEnabled: true,
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.gedWorkflowEnabled, true);
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
          gedWorkflowEnabled: true,
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
    assert.strictEqual(parsed.bootstrap?.createThread?.gedWorkflowEnabled, true);
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

it.effect("round-trips task archive, restore, and delete commands and events", () =>
  Effect.gen(function* () {
    for (const type of ["task.archive", "task.restore", "task.delete"] as const) {
      const command = yield* decodeOrchestrationCommand({
        type,
        commandId: `cmd-${type}`,
        taskId: "task-1",
      });
      const reDecoded = yield* decodeOrchestrationCommand(
        yield* encodeOrchestrationCommand(command),
      );
      assert.strictEqual(reDecoded.type, type);
    }

    const eventInputs = [
      {
        type: "task.archived" as const,
        payload: {
          taskId: "task-1",
          archivedAt: "2026-01-01T00:01:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      },
      {
        type: "task.restored" as const,
        payload: {
          taskId: "task-1",
          task: {
            id: "task-1",
            projectId: "project-1",
            type: "feature",
            title: "Restored task",
            status: "abandoned",
            branch: null,
            worktreePath: null,
            pmMessageId: null,
            stageThreadIds: [],
            currentStageThreadId: null,
            playbookVersion: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:02:00.000Z",
            archivedAt: null,
            deletedAt: null,
          },
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      },
      {
        type: "task.deleted" as const,
        payload: {
          taskId: "task-1",
          deletedAt: "2026-01-01T00:03:00.000Z",
          updatedAt: "2026-01-01T00:03:00.000Z",
        },
      },
    ];
    for (const [index, input] of eventInputs.entries()) {
      const event = yield* decodeOrchestrationEvent({
        sequence: index + 1,
        eventId: `event-retention-${index}`,
        aggregateKind: "task",
        aggregateId: "task-1",
        type: input.type,
        occurredAt: input.payload.updatedAt,
        commandId: `cmd-retention-${index}`,
        causationEventId: null,
        correlationId: `cmd-retention-${index}`,
        metadata: {},
        payload: input.payload,
      });
      const reDecoded = yield* decodeOrchestrationEvent(yield* encodeOrchestrationEvent(event));
      assert.strictEqual(reDecoded.type, input.type);
    }
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

it.effect("round-trips task.pr.open.failed commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "task.pr.open.failed",
      commandId: "cmd-pr-open-failed",
      taskId: "task-1",
      message: " provider unavailable ",
      branchPushed: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const reDecoded = yield* decodeOrchestrationCommand(yield* encodeOrchestrationCommand(parsed));

    assert.strictEqual(reDecoded.type, "task.pr.open.failed");
    if (reDecoded.type === "task.pr.open.failed") {
      assert.strictEqual(reDecoded.message, "provider unavailable");
      assert.strictEqual(reDecoded.branchPushed, true);
    }
  }),
);

it.effect("round-trips task.landing.retry commands through the orchestration command union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "task.landing.retry",
      commandId: "cmd-landing-retry",
      taskId: "task-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const reDecoded = yield* decodeOrchestrationCommand(yield* encodeOrchestrationCommand(parsed));

    assert.strictEqual(reDecoded.type, "task.landing.retry");
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

it.effect("round-trips task.pr-open-failed events through the orchestration event union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-pr-open-failed",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.pr-open-failed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-pr-open-failed",
      causationEventId: null,
      correlationId: "cmd-pr-open-failed",
      metadata: {},
      payload: {
        taskId: "task-1",
        message: "provider unavailable",
        branchPushed: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const reDecoded = yield* decodeOrchestrationEvent(yield* encodeOrchestrationEvent(parsed));

    assert.strictEqual(reDecoded.type, "task.pr-open-failed");
    if (reDecoded.type === "task.pr-open-failed") {
      assert.strictEqual(reDecoded.payload.message, "provider unavailable");
      assert.strictEqual(reDecoded.payload.branchPushed, false);
    }
  }),
);

it.effect("round-trips task.landing-retry-requested events through the event union", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-landing-retry",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.landing-retry-requested",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-landing-retry",
      causationEventId: null,
      correlationId: "cmd-landing-retry",
      metadata: {},
      payload: {
        taskId: "task-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const reDecoded = yield* decodeOrchestrationEvent(yield* encodeOrchestrationEvent(parsed));

    assert.strictEqual(reDecoded.type, "task.landing-retry-requested");
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
    assert.strictEqual(decodedDefault.landing, null);
    assert.strictEqual(decodedDefault.archivedAt, null);
    assert.strictEqual(decodedDefault.deletedAt, null);

    const decodedOpened = yield* decodeOrchestrationTask({
      ...decodedDefault,
      prUrl: " https://github.com/acme/repo/pull/42 ",
    });
    const reDecoded = yield* decodeOrchestrationTask(yield* encodeOrchestrationTask(decodedOpened));
    assert.strictEqual(reDecoded.prUrl, "https://github.com/acme/repo/pull/42");

    const decodedFailed = yield* decodeOrchestrationTask({
      ...decodedDefault,
      status: "landed",
      landing: {
        status: "failed",
        failureMessage: "provider unavailable",
        branchPushed: false,
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    });
    const reDecodedFailed = yield* decodeOrchestrationTask(
      yield* encodeOrchestrationTask(decodedFailed),
    );
    assert.strictEqual(reDecodedFailed.landing?.status, "failed");
    assert.strictEqual(reDecodedFailed.landing?.failureMessage, "provider unavailable");
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

it.effect("accepts retained plan/work/verify stage roles and rejects removed roles", () =>
  Effect.gen(function* () {
    const plan = yield* decodeStageRole("plan");
    const work = yield* decodeStageRole("work");
    const verify = yield* decodeStageRole("verify");
    const removed = yield* Effect.exit(decodeStageRole("review"));

    assert.strictEqual(plan, "plan");
    assert.strictEqual(work, "work");
    assert.strictEqual(verify, "verify");
    assert.strictEqual(removed._tag, "Failure");
  }),
);

it.effect("role model selections are keyed only by known stage roles", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeRoleModelSelections({
      plan: {
        instanceId: "codex_plan",
        model: "gpt-5.2",
      },
      verify: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
    });

    assert.strictEqual(parsed.plan?.instanceId, ProviderInstanceId.make("codex_plan"));
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
      plan: "Focus on plan defects.",
      verify: "Run targeted verification before reporting success.",
    });

    assert.strictEqual(parsed.plan, "Focus on plan defects.");
    assert.strictEqual(parsed.verify, "Run targeted verification before reporting success.");

    const result = yield* Effect.exit(
      decodeRolePromptPrefixes({
        verfy: "typo",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes task capability-tier commands and narrows persisted event origin", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "task.capability-tiers.set",
      commandId: "cmd-role-selections",
      taskId: "task-1",
      roleCapabilityTiers: { verify: "smart" },
      origin: "human",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "task.capability-tiers.set");

    const event = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-role-selections",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.capability-tiers-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-role-selections",
      causationEventId: null,
      correlationId: "cmd-role-selections",
      metadata: {},
      payload: {
        taskId: "task-1",
        roleCapabilityTiers: { verify: "smart" },
        origin: "client",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(event.type, "task.capability-tiers-updated");

    const pmEvent = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "evt-role-selections-pm",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.capability-tiers-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-role-selections",
      causationEventId: null,
      correlationId: "cmd-role-selections",
      metadata: {},
      payload: {
        taskId: "task-1",
        roleCapabilityTiers: {},
        origin: "pm-runtime",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.strictEqual(pmEvent.type, "task.capability-tiers-updated");
  }),
);

it.effect("drops retired role keys only while decoding historical events", () =>
  Effect.gen(function* () {
    const projectEvent = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "evt-project-legacy-roles",
      aggregateKind: "project",
      aggregateId: "project-1",
      type: "project.meta-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-project-legacy-roles",
      causationEventId: null,
      correlationId: "cmd-project-legacy-roles",
      metadata: {},
      payload: {
        projectId: "project-1",
        roleModelSelections: {
          classify: { instanceId: "codex", model: "gpt-old" },
          work: { instanceId: "codex", model: "gpt-work" },
          review: { instanceId: "claudeAgent", model: "claude-old" },
        },
        rolePromptPrefixes: {
          classify: "Classify",
          verify: "Verify",
          review: "Review",
        },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    if (projectEvent.type !== "project.meta-updated") {
      return assert.fail("expected project.meta-updated");
    }
    assert.deepStrictEqual(Object.keys(projectEvent.payload.roleModelSelections ?? {}), ["work"]);
    assert.strictEqual(projectEvent.payload.roleModelSelections?.work?.instanceId, "codex");
    assert.strictEqual(projectEvent.payload.roleModelSelections?.work?.model, "gpt-work");
    assert.deepStrictEqual(projectEvent.payload.rolePromptPrefixes, { verify: "Verify" });

    const taskEvent = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "evt-task-capability-tiers",
      aggregateKind: "task",
      aggregateId: "task-1",
      type: "task.capability-tiers-updated",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-task-capability-tiers",
      causationEventId: null,
      correlationId: "cmd-task-capability-tiers",
      metadata: {},
      payload: {
        taskId: "task-1",
        roleCapabilityTiers: { verify: "smart" },
        origin: "client",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    if (taskEvent.type !== "task.capability-tiers-updated") {
      return assert.fail("expected task.capability-tiers-updated");
    }
    assert.deepStrictEqual(taskEvent.payload.roleCapabilityTiers, { verify: "smart" });
  }),
);

it.effect("decodes system gate-resolution origin for internal engine decisions", () =>
  Effect.gen(function* () {
    const origin = yield* decodeGateResolutionOrigin("system");
    assert.strictEqual(origin, "system");
  }),
);

it.effect("decodes task capability-tier websocket input with role-keyed tiers", () =>
  Effect.gen(function* () {
    const input = yield* decodeOrchestratorSetTaskCapabilityTiersInput({
      taskId: "task-1",
      roleCapabilityTiers: { work: "smart" },
    });
    assert.strictEqual(input.taskId, "task-1");
    assert.strictEqual(input.roleCapabilityTiers.work, "smart");

    const result = yield* Effect.exit(
      decodeOrchestratorSetTaskCapabilityTiersInput({
        taskId: "task-1",
        roleCapabilityTiers: { wrk: "smart" },
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

it.effect("thread fork RPC contracts expose explicit strategy and filesystem semantics", () =>
  Effect.gen(function* () {
    const input = yield* decodeForkThreadInput({
      sourceThreadId: "source-thread",
      sourceMessageId: "assistant-message",
    });
    const result = yield* decodeForkThreadResult({
      threadId: "target-thread",
      strategy: "provider-native",
      filesystem: "current-state",
      sequence: 12,
    });

    assert.strictEqual(input.sourceThreadId, ThreadId.make("source-thread"));
    assert.strictEqual(result.strategy, "provider-native");
    assert.strictEqual(result.filesystem, "current-state");
  }),
);

it.effect("thread fork RPC result rejects implicit filesystem rollback semantics", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decodeForkThreadResult({
        threadId: "target-thread",
        strategy: "copied-history",
        filesystem: "selected-message-state",
        sequence: 12,
      }),
    );
    assert.strictEqual(exit._tag, "Failure");
  }),
);
