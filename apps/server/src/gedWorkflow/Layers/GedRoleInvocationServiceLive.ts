import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  type GedSubagentRole,
  type OrchestrationCommand,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { resolveGedRoleModelSelection } from "@t3tools/shared/gedModelSelection";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { buildGedRolePrompt, GED_ROLE_PROMPT_DEFINITIONS } from "../GedRolePrompts.ts";
import {
  GedRoleInvocationContextError,
  GedRoleInvocationDispatchError,
  GedRoleInvocationInputError,
  GedRoleInvocationService,
  type GedRoleInvocationInput,
  type GedRoleInvocationResult,
  type GedRoleInvocationServiceShape,
} from "../Services/GedRoleInvocationService.ts";

const INVOCATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const validateInput = (input: GedRoleInvocationInput) =>
  Effect.gen(function* () {
    if (!(input.role in GED_ROLE_PROMPT_DEFINITIONS)) {
      return yield* new GedRoleInvocationInputError({
        detail: `Unsupported Ged role: ${input.role}`,
      });
    }

    const invocationId = input.invocationId;
    if (!INVOCATION_ID_PATTERN.test(invocationId)) {
      return yield* new GedRoleInvocationInputError({
        detail:
          "invocationId must be 1-128 chars and contain only letters, digits, underscore, or hyphen",
      });
    }

    if (input.request.trim().length === 0) {
      return yield* new GedRoleInvocationInputError({ detail: "request is required" });
    }

    return { ...input, invocationId, request: input.request.trim() };
  });

const safeIdPart = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, "-");
const commandId = (role: GedSubagentRole, invocationId: string, step: string): CommandId =>
  CommandId.make(`ged-role:${safeIdPart(role)}:${safeIdPart(invocationId)}:${step}`);
const eventId = (role: GedSubagentRole, invocationId: string, step: string): EventId =>
  EventId.make(`ged-role:${safeIdPart(role)}:${safeIdPart(invocationId)}:${step}`);
const childThreadId = (role: GedSubagentRole, invocationId: string): ThreadId =>
  ThreadId.make(`ged-role-${safeIdPart(role)}-${safeIdPart(invocationId)}`);
const messageId = (role: GedSubagentRole, invocationId: string): MessageId =>
  MessageId.make(`ged-role:${safeIdPart(role)}:${safeIdPart(invocationId)}:message`);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const failIfNone = <A>(option: Option.Option<A>, detail: string) =>
  Option.match(option, {
    onNone: () => Effect.fail(new GedRoleInvocationContextError({ detail })),
    onSome: (value) => Effect.succeed(value),
  });

const dispatchStep = (
  engine: OrchestrationEngineShape,
  failedStep: string,
  command: OrchestrationCommand,
) =>
  engine.dispatch(command).pipe(
    Effect.mapError(
      (cause) =>
        new GedRoleInvocationDispatchError({
          failedStep,
          detail: `Failed to dispatch ${failedStep}`,
          cause,
        }),
    ),
  );

const failureActivity = (input: {
  readonly role: GedSubagentRole;
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly childThreadId?: ThreadId;
  readonly failedStep: string;
  readonly detail: string;
  readonly suffix: string;
  readonly createdAt: string;
}): OrchestrationThreadActivity => ({
  id: eventId(input.role, input.invocationId, `failed-${input.suffix}`),
  tone: "error",
  kind: "ged.role-invocation.failed",
  summary: `${input.role} invocation failed at ${input.failedStep}`,
  payload: {
    invocationId: input.invocationId,
    role: input.role,
    parentThreadId: input.parentThreadId,
    childThreadId: input.childThreadId,
    failedStep: input.failedStep,
    detail: input.detail,
  },
  turnId: null,
  createdAt: input.createdAt,
});

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const settingsService = yield* ServerSettingsService;

  const invoke: GedRoleInvocationServiceShape["invoke"] = (rawInput) =>
    Effect.gen(function* () {
      const input = yield* validateInput(rawInput);
      const roleDefinition = GED_ROLE_PROMPT_DEFINITIONS[input.role];
      const parent = yield* projections
        .getThreadDetailById(input.parentThreadId)
        .pipe(Effect.flatMap((option) => failIfNone(option, "Parent thread not found")));
      const project = yield* projections
        .getProjectShellById(parent.projectId)
        .pipe(Effect.flatMap((option) => failIfNone(option, "Parent project not found")));

      const settings = yield* settingsService.getSettings;
      if (!settings.gedSubagentsEnabled) {
        return yield* new GedRoleInvocationInputError({
          detail: "Ged subagents are disabled",
        });
      }
      if (settings.gedRoleSettings[input.role]?.enabled === false) {
        return yield* new GedRoleInvocationInputError({
          detail: `Ged role is disabled: ${input.role}`,
        });
      }
      const roleModelSelection = resolveGedRoleModelSelection({
        role: input.role,
        projectRoleModelSelections: project.roleModelSelections,
        globalRoleModelSelections: settings.gedModelSelections.roles,
        parentThreadModelSelection: parent.modelSelection,
        projectDefaultModelSelection: project.defaultModelSelection,
        globalMainModelSelection: settings.gedModelSelections.mainThread,
        fallbackModelSelection: parent.modelSelection,
      });

      const createdAt = yield* nowIso;
      const childId = childThreadId(input.role, input.invocationId);
      const effectiveCwd = parent.worktreePath ?? project.workspaceRoot;
      const prompt = buildGedRolePrompt({
        role: input.role,
        invocationId: input.invocationId,
        parentThreadId: input.parentThreadId,
        projectId: parent.projectId,
        workspaceRoot: project.workspaceRoot,
        branch: parent.branch,
        worktreePath: parent.worktreePath,
        effectiveCwd,
        modelSelection: roleModelSelection,
        request: input.request,
      });

      const parentActivity: OrchestrationThreadActivity = {
        id: eventId(input.role, input.invocationId, "parent-started"),
        tone: "info",
        kind: "ged.role-invocation.started",
        summary: `Started ${input.role} child thread`,
        payload: {
          invocationId: input.invocationId,
          role: input.role,
          parentThreadId: input.parentThreadId,
          childThreadId: childId,
          projectId: parent.projectId,
          branch: parent.branch,
          worktreePath: parent.worktreePath,
        },
        turnId: null,
        createdAt,
      };

      const childActivity: OrchestrationThreadActivity = {
        id: eventId(input.role, input.invocationId, "child-linked"),
        tone: "info",
        kind: "ged.role-invocation.child",
        summary: `${input.role} child of parent thread`,
        payload: {
          invocationId: input.invocationId,
          role: input.role,
          parentThreadId: input.parentThreadId,
          childThreadId: childId,
          projectId: parent.projectId,
        },
        turnId: null,
        createdAt,
      };

      const dispatchFailure = (error: GedRoleInvocationDispatchError) =>
        Effect.gen(function* () {
          const failureCreatedAt = yield* nowIso;
          yield* engine
            .dispatch({
              type: "thread.activity.append",
              createdAt: failureCreatedAt,
              commandId: commandId(
                input.role,
                input.invocationId,
                `failed-parent-${error.failedStep}`,
              ),
              threadId: input.parentThreadId,
              activity: failureActivity({
                role: input.role,
                invocationId: input.invocationId,
                parentThreadId: input.parentThreadId,
                childThreadId: childId,
                failedStep: error.failedStep,
                detail: error.detail,
                suffix: `parent-${error.failedStep}`,
                createdAt: failureCreatedAt,
              }),
            })
            .pipe(Effect.ignore);
          if (error.failedStep !== "child-thread-create") {
            yield* engine
              .dispatch({
                type: "thread.activity.append",
                createdAt: failureCreatedAt,
                commandId: commandId(
                  input.role,
                  input.invocationId,
                  `failed-child-${error.failedStep}`,
                ),
                threadId: childId,
                activity: failureActivity({
                  role: input.role,
                  invocationId: input.invocationId,
                  parentThreadId: input.parentThreadId,
                  childThreadId: childId,
                  failedStep: error.failedStep,
                  detail: error.detail,
                  suffix: `child-${error.failedStep}`,
                  createdAt: failureCreatedAt,
                }),
              })
              .pipe(Effect.ignore);
          }
          return yield* error;
        });

      yield* dispatchStep(engine, "child-thread-create", {
        type: "thread.create",
        commandId: commandId(input.role, input.invocationId, "child-thread-create"),
        threadId: childId,
        projectId: parent.projectId,
        title: roleDefinition.title,
        modelSelection: roleModelSelection,
        gedWorkflowEnabled: false,
        runtimeMode: roleDefinition.runtimeMode,
        interactionMode: roleDefinition.interactionMode,
        branch: parent.branch,
        worktreePath: parent.worktreePath,
        createdAt,
      }).pipe(
        Effect.catchIf((error) => error instanceof GedRoleInvocationDispatchError, dispatchFailure),
      );

      yield* dispatchStep(engine, "parent-activity-append", {
        type: "thread.activity.append",
        createdAt,
        commandId: commandId(input.role, input.invocationId, "parent-activity-append"),
        threadId: input.parentThreadId,
        activity: parentActivity,
      }).pipe(
        Effect.catchIf((error) => error instanceof GedRoleInvocationDispatchError, dispatchFailure),
      );

      yield* dispatchStep(engine, "child-activity-append", {
        type: "thread.activity.append",
        createdAt,
        commandId: commandId(input.role, input.invocationId, "child-activity-append"),
        threadId: childId,
        activity: childActivity,
      }).pipe(
        Effect.catchIf((error) => error instanceof GedRoleInvocationDispatchError, dispatchFailure),
      );

      yield* dispatchStep(engine, "child-turn-start", {
        type: "thread.turn.start",
        commandId: commandId(input.role, input.invocationId, "child-turn-start"),
        threadId: childId,
        message: {
          messageId: messageId(input.role, input.invocationId),
          role: "user",
          text: prompt,
          attachments: [],
        },
        modelSelection: roleModelSelection,
        gedWorkflowEnabled: false,
        runtimeMode: roleDefinition.runtimeMode,
        interactionMode: roleDefinition.interactionMode,
        createdAt,
      }).pipe(
        Effect.catchIf((error) => error instanceof GedRoleInvocationDispatchError, dispatchFailure),
      );

      return {
        role: input.role,
        invocationId: input.invocationId,
        parentThreadId: input.parentThreadId,
        childThreadId: childId,
      } satisfies GedRoleInvocationResult;
    });

  return { invoke } satisfies GedRoleInvocationServiceShape;
});

export const GedRoleInvocationServiceLive = Layer.effect(GedRoleInvocationService, make);
