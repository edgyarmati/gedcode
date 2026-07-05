import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { useEnvironmentApiAvailable } from "../../hooks/useEnvironmentApiAvailable";
import { useSettings } from "../../hooks/useSettings";
import { newCommandId } from "../../lib/utils";
import { getAppModelOptionsForInstance, type AppModelOption } from "../../modelSelection";
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useServerConfig } from "../../rpc/serverState";
import { derivePendingUserInputs } from "../../session-logic";
import type { Project, Thread } from "../../types";
import { ComposerPendingUserInputPanel } from "../chat/ComposerPendingUserInputPanel";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const CLAUDE_PM_DRIVER = ProviderDriverKind.make("claudeAgent");

export function buildPmUserInputRespondCommand(input: {
  readonly threadId: ThreadId;
  readonly requestId: ApprovalRequestId;
  readonly answers: Record<string, unknown>;
  readonly createdAt?: string;
}): Extract<OrchestrationCommand, { type: "thread.user-input.respond" }> {
  return {
    type: "thread.user-input.respond",
    commandId: newCommandId(),
    threadId: input.threadId,
    requestId: input.requestId,
    answers: input.answers,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function buildPmModelSelectionUpdateCommand(input: {
  readonly project: Project;
  readonly selection: ModelSelection;
}): Extract<OrchestrationCommand, { type: "project.meta.update" }> {
  return {
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.project.id,
    orchestratorConfig: {
      ...input.project.orchestratorConfig,
      pmModelSelection: input.selection,
    },
  };
}

function readPmModelSelection(project: Project | undefined): ModelSelection | null {
  const raw = project?.orchestratorConfig?.pmModelSelection;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.instanceId !== "string" || typeof record.model !== "string") {
    return null;
  }
  const selection = {
    instanceId: record.instanceId as ModelSelection["instanceId"],
    model: record.model,
  } satisfies ModelSelection;
  return Array.isArray(record.options)
    ? { ...selection, options: record.options as NonNullable<ModelSelection["options"]> }
    : selection;
}

function firstPickerModelForEntry(
  entry: ProviderInstanceEntry,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
): string | null {
  return modelOptionsByInstance.get(entry.instanceId)?.[0]?.slug ?? entry.models[0]?.slug ?? null;
}

function resolvePmPickerSelection(
  selection: ModelSelection | null,
  claudeProviderEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
): ModelSelection | null {
  const selectedEntry = selection
    ? (claudeProviderEntries.find((entry) => entry.instanceId === selection.instanceId) ?? null)
    : null;
  if (selection && selectedEntry) {
    return selection;
  }

  const fallbackEntry = claudeProviderEntries.find((entry) => entry.enabled && entry.isAvailable);
  if (!fallbackEntry) {
    return null;
  }
  const fallbackModel = firstPickerModelForEntry(fallbackEntry, modelOptionsByInstance);
  return fallbackModel ? { instanceId: fallbackEntry.instanceId, model: fallbackModel } : null;
}

export function PmChatComposer({
  environmentId,
  project,
  projectId,
  thread,
}: {
  environmentId: EnvironmentId;
  project: Project | undefined;
  projectId: ProjectId;
  thread: Thread | undefined;
}) {
  const serverConfig = useServerConfig();
  const settings = useSettings();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingPmModelSelection, setSavingPmModelSelection] = useState(false);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const pmModelSelection = readPmModelSelection(project);
  const providerEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverConfig?.providers ?? [])),
    [serverConfig?.providers],
  );
  const claudeProviderEntries = useMemo(
    () => providerEntries.filter((entry) => entry.driverKind === CLAUDE_PM_DRIVER),
    [providerEntries],
  );
  const pmModelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of claudeProviderEntries) {
      out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
    }
    return out;
  }, [claudeProviderEntries, settings]);
  const pmPickerSelection = useMemo(
    () =>
      resolvePmPickerSelection(pmModelSelection, claudeProviderEntries, pmModelOptionsByInstance),
    [claudeProviderEntries, pmModelOptionsByInstance, pmModelSelection],
  );
  const environmentAvailable = useEnvironmentApiAvailable(environmentId);
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(thread?.activities ?? []),
    [thread?.activities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const isAnsweringUserInput =
    activePendingUserInput !== null &&
    respondingRequestIds.includes(activePendingUserInput.requestId);
  const trimmedMessage = message.trim();
  const canSend = activePendingProgress
    ? environmentAvailable &&
      !submitting &&
      !isAnsweringUserInput &&
      activePendingProgress.canAdvance
    : environmentAvailable && !submitting && trimmedMessage.length > 0;

  useEffect(() => {
    if (!activePendingProgress) {
      return;
    }
    setMessage(activePendingProgress.customAnswer);
  }, [activePendingProgress, activePendingUserInput?.requestId]);

  const respondToActivePendingUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || !thread) {
        setError("Environment API unavailable.");
        return;
      }

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      setError(null);
      await api.orchestration
        .dispatchCommand({
          ...buildPmUserInputRespondCommand({
            threadId: thread.id,
            requestId,
            answers,
          }),
        })
        .then(() => {
          setMessage("");
          setPendingUserInputAnswersByRequestId((existing) => {
            const { [requestId]: _removed, ...remaining } = existing;
            return remaining;
          });
          setPendingUserInputQuestionIndexByRequestId((existing) => {
            const { [requestId]: _removed, ...remaining } = existing;
            return remaining;
          });
        })
        .catch((sendError: unknown) => {
          setError(sendError instanceof Error ? sendError.message : "Failed to submit user input.");
        });
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
    },
    [environmentId, thread],
  );

  const advanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void respondToActivePendingUserInput(
          activePendingUserInput.requestId,
          activePendingResolvedAnswers,
        );
      }
      return;
    }

    const nextQuestionIndex = activePendingProgress.questionIndex + 1;
    setPendingUserInputQuestionIndexByRequestId((existing) => ({
      ...existing,
      [activePendingUserInput.requestId]: nextQuestionIndex,
    }));
    const nextQuestion = activePendingUserInput.questions[nextQuestionIndex];
    setMessage(
      nextQuestion ? (activePendingDraftAnswers[nextQuestion.id]?.customAnswer ?? "") : "",
    );
  }, [
    activePendingDraftAnswers,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    respondToActivePendingUserInput,
  ]);

  const selectActivePendingUserInputOption = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          activePendingUserInput.questions.find((entry) => entry.id === questionId) ?? null;
        if (!question) {
          return existing;
        }
        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionLabel,
            ),
          },
        };
      });
      setMessage("");
      textareaRef.current?.focus();
    },
    [activePendingUserInput],
  );

  const setActivePendingUserInputCustomAnswer = useCallback(
    (value: string) => {
      if (!activePendingUserInput || !activePendingProgress?.activeQuestion) {
        return;
      }
      const questionId = activePendingProgress.activeQuestion.id;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
    },
    [activePendingProgress?.activeQuestion, activePendingUserInput],
  );

  const onSend = useCallback(
    (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      if (!canSend) {
        return;
      }
      if (activePendingProgress) {
        advanceActivePendingUserInput();
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        setError("Environment API unavailable.");
        return;
      }
      setSubmitting(true);
      setError(null);
      void api.orchestrator
        .sendMessage({ projectId, message: trimmedMessage })
        .then(() => {
          setMessage("");
          textareaRef.current?.focus();
        })
        .catch((sendError) => {
          setError(sendError instanceof Error ? sendError.message : String(sendError));
        })
        .finally(() => {
          setSubmitting(false);
        });
    },
    [
      activePendingProgress,
      advanceActivePendingUserInput,
      canSend,
      environmentId,
      projectId,
      trimmedMessage,
    ],
  );
  const onPmModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        setError("Environment API unavailable.");
        return;
      }
      if (!project) {
        setError("Project unavailable.");
        return;
      }

      setSavingPmModelSelection(true);
      setError(null);
      void api.orchestration
        .dispatchCommand(
          buildPmModelSelectionUpdateCommand({
            project,
            selection: { instanceId, model },
          }),
        )
        .catch((saveError) => {
          setError(saveError instanceof Error ? saveError.message : "Failed to update PM model.");
        })
        .finally(() => {
          setSavingPmModelSelection(false);
        });
    },
    [environmentId, project],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        onSend(event);
      }
    },
    [onSend],
  );
  const isRunning = thread?.latestTurn?.state === "running";

  return (
    <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4">
      {error ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <form className="space-y-2" onSubmit={onSend}>
        {pendingUserInputs.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/20">
            <ComposerPendingUserInputPanel
              pendingUserInputs={pendingUserInputs}
              respondingRequestIds={respondingRequestIds}
              answers={activePendingDraftAnswers}
              questionIndex={activePendingQuestionIndex}
              onToggleOption={selectActivePendingUserInputOption}
              onAdvance={advanceActivePendingUserInput}
            />
          </div>
        ) : null}
        <div className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 shadow-xs/5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24">
          <Textarea
            aria-label="Message PM"
            className="min-w-0 flex-1"
            disabled={submitting || isAnsweringUserInput}
            onChange={(event) => {
              setMessage(event.currentTarget.value);
              setActivePendingUserInputCustomAnswer(event.currentTarget.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              activePendingProgress
                ? "Type your own answer, or leave this blank to use the selected option"
                : "Message PM"
            }
            ref={textareaRef}
            rows={3}
            unstyled
            value={message}
          />
          <Button
            aria-label="Send PM message"
            disabled={!canSend}
            size="icon"
            title={
              environmentAvailable
                ? activePendingProgress
                  ? activePendingProgress.isLastQuestion
                    ? "Submit answer"
                    : "Next question"
                  : "Send PM message"
                : "Environment unavailable"
            }
            type="submit"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </div>
        <div className="flex min-h-5 items-center justify-between gap-2">
          <div className="-m-1 flex min-w-0 flex-1 items-center overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pmPickerSelection ? (
              <ProviderModelPicker
                compact
                activeInstanceId={pmPickerSelection.instanceId}
                model={pmPickerSelection.model}
                lockedProvider={CLAUDE_PM_DRIVER}
                lockedContinuationGroupKey={null}
                instanceEntries={claudeProviderEntries}
                modelOptionsByInstance={pmModelOptionsByInstance}
                disabled={!project || savingPmModelSelection}
                triggerClassName="max-w-64"
                {...(serverConfig?.keybindings ? { keybindings: serverConfig.keybindings } : {})}
                onInstanceModelChange={onPmModelSelect}
              />
            ) : (
              <span className="truncate text-[11px] text-muted-foreground">
                No Claude PM model configured
              </span>
            )}
          </div>
          {isRunning ? (
            <span className="text-[11px] font-medium text-muted-foreground">Running</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
