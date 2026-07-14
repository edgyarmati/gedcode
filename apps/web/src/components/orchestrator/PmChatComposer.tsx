import type {
  ApprovalRequestId,
  EnvironmentId,
  ModelSelection,
  OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ProviderOptionSelection,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { createModelSelection } from "@t3tools/shared/model";
import { ArrowUpIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useComposerDraftStore, useComposerThreadDraft } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import { useEnvironmentApiAvailable } from "../../hooks/useEnvironmentApiAvailable";
import { useSettings } from "../../hooks/useSettings";
import { newCommandId } from "../../lib/utils";
import { pmThreadIdForProject } from "../../lib/orchestratorThreads";
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
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
const SUPPORTED_PM_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("claudeAgent"),
  ProviderDriverKind.make("codex"),
]);

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
  readonly selection: {
    readonly instanceId: ModelSelection["instanceId"];
    readonly model: string;
    readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  };
}): Extract<OrchestrationCommand, { type: "project.meta.update" }> {
  return {
    type: "project.meta.update",
    commandId: newCommandId(),
    projectId: input.project.id,
    orchestratorConfig: {
      ...input.project.orchestratorConfig,
      pmModelSelection: createModelSelection(
        input.selection.instanceId,
        input.selection.model,
        input.selection.options,
      ),
    },
  };
}

type PmModelSelectionUpdateCommand = ReturnType<typeof buildPmModelSelectionUpdateCommand>;

export type PmHarnessSwitchGateDecision =
  | { readonly kind: "silent" }
  | {
      readonly kind: "cross-harness";
      readonly fromDriver: ProviderDriverKind;
      readonly fromLabel: string;
      readonly toDriver: ProviderDriverKind;
      readonly toLabel: string;
    };

export function decidePmHarnessSwitchGate(input: {
  readonly currentSelection: ModelSelection | null;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly picked: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
  };
}): PmHarnessSwitchGateDecision {
  if (!input.currentSelection) {
    return { kind: "silent" };
  }

  const currentEntry =
    input.providerEntries.find(
      (entry) => entry.instanceId === input.currentSelection?.instanceId,
    ) ?? null;
  const pickedEntry =
    input.providerEntries.find((entry) => entry.instanceId === input.picked.instanceId) ?? null;
  if (!currentEntry || !pickedEntry || currentEntry.driverKind === pickedEntry.driverKind) {
    return { kind: "silent" };
  }

  return {
    kind: "cross-harness",
    fromDriver: currentEntry.driverKind,
    fromLabel: currentEntry.displayName,
    toDriver: pickedEntry.driverKind,
    toLabel: pickedEntry.displayName,
  };
}

export type PmHarnessSwitchAction = "transcript" | "summary" | "fresh" | "cancel";

export async function runPmHarnessSwitchAction(input: {
  readonly action: PmHarnessSwitchAction;
  readonly projectId: ProjectId;
  readonly project: Project;
  readonly selection: {
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
  };
  readonly requestPmHandoff: (request: {
    readonly projectId: ProjectId;
    readonly mode: "transcript" | "summary";
  }) => Promise<{
    readonly accepted: true;
    readonly mode: "transcript" | "summary";
    readonly fallback?: string | undefined;
  }>;
  readonly clearPmChat: (request: { readonly projectId: ProjectId }) => Promise<unknown>;
  readonly dispatchCommand: (command: PmModelSelectionUpdateCommand) => Promise<unknown>;
  readonly onFallback?: (fallback: string) => void;
}): Promise<boolean> {
  if (input.action === "cancel") {
    return false;
  }

  if (input.action === "transcript" || input.action === "summary") {
    const result = await input.requestPmHandoff({
      projectId: input.projectId,
      mode: input.action,
    });
    if (input.action === "summary" && result.fallback) {
      input.onFallback?.(result.fallback);
    }
  } else {
    await input.clearPmChat({ projectId: input.projectId });
  }

  await input.dispatchCommand(
    buildPmModelSelectionUpdateCommand({
      project: input.project,
      selection: input.selection,
    }),
  );
  return true;
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
  pmProviderEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
): ModelSelection | null {
  const selectedEntry = selection
    ? (pmProviderEntries.find((entry) => entry.instanceId === selection.instanceId) ?? null)
    : null;
  if (selection && selectedEntry) {
    return selection;
  }

  const fallbackEntry = pmProviderEntries.find((entry) => entry.enabled && entry.isAvailable);
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
  const composerDraftTarget = useMemo(
    () => scopeThreadRef(environmentId, pmThreadIdForProject(projectId)),
    [environmentId, projectId],
  );
  const draftPrompt = useComposerThreadDraft(composerDraftTarget).prompt;
  const setComposerDraftPrompt = useComposerDraftStore((state) => state.setPrompt);
  const [submitting, setSubmitting] = useState(false);
  const [savingPmModelSelection, setSavingPmModelSelection] = useState(false);
  const [pendingHarnessSwitch, setPendingHarnessSwitch] = useState<{
    readonly gate: Extract<PmHarnessSwitchGateDecision, { readonly kind: "cross-harness" }>;
    readonly selection: {
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    };
  } | null>(null);
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pmModelSelection = readPmModelSelection(project);
  const providerEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverConfig?.providers ?? [])),
    [serverConfig?.providers],
  );
  const pmProviderEntries = useMemo(
    () => providerEntries.filter((entry) => SUPPORTED_PM_DRIVERS.has(entry.driverKind)),
    [providerEntries],
  );
  const pmModelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of pmProviderEntries) {
      out.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
    }
    return out;
  }, [pmProviderEntries, settings]);
  const pmPickerSelection = useMemo(
    () => resolvePmPickerSelection(pmModelSelection, pmProviderEntries, pmModelOptionsByInstance),
    [pmProviderEntries, pmModelOptionsByInstance, pmModelSelection],
  );
  const pmSelectedInstanceEntry = useMemo(
    () =>
      pmPickerSelection
        ? (pmProviderEntries.find((entry) => entry.instanceId === pmPickerSelection.instanceId) ??
          null)
        : null,
    [pmProviderEntries, pmPickerSelection],
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
  const message = activePendingProgress ? activePendingProgress.customAnswer : draftPrompt;
  const trimmedMessage = message.trim();
  const canSend = activePendingProgress
    ? environmentAvailable &&
      !savingPmModelSelection &&
      !submitting &&
      !isAnsweringUserInput &&
      activePendingProgress.canAdvance
    : environmentAvailable && !savingPmModelSelection && !submitting && trimmedMessage.length > 0;

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
  }, [
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
      setNotice(null);
      void api.orchestrator
        .sendMessage({ projectId, message: trimmedMessage })
        .then(() => {
          setComposerDraftPrompt(composerDraftTarget, "");
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
      composerDraftTarget,
      environmentId,
      projectId,
      setComposerDraftPrompt,
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

      const gate = decidePmHarnessSwitchGate({
        currentSelection: pmModelSelection,
        providerEntries,
        picked: { instanceId, model },
      });
      if (gate.kind === "cross-harness") {
        setPendingHarnessSwitch({ gate, selection: { instanceId, model } });
        setError(null);
        setNotice(null);
        return;
      }

      setSavingPmModelSelection(true);
      setError(null);
      setNotice(null);
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
    [environmentId, pmModelSelection, project, providerEntries],
  );
  const closePmHarnessSwitchDialog = useCallback(() => {
    if (savingPmModelSelection) {
      return;
    }
    setPendingHarnessSwitch(null);
  }, [savingPmModelSelection]);
  const runPendingHarnessSwitchAction = useCallback(
    (action: PmHarnessSwitchAction) => {
      const api = readEnvironmentApi(environmentId);
      const pending = pendingHarnessSwitch;
      if (!api) {
        setError("Environment API unavailable.");
        return;
      }
      if (!project) {
        setError("Project unavailable.");
        return;
      }
      if (!pending) {
        return;
      }
      if (action === "cancel") {
        setPendingHarnessSwitch(null);
        return;
      }

      setSavingPmModelSelection(true);
      setError(null);
      setNotice(null);
      void runPmHarnessSwitchAction({
        action,
        projectId,
        project,
        selection: pending.selection,
        requestPmHandoff: api.orchestrator.requestPmHandoff,
        clearPmChat: api.orchestrator.clearPmChat,
        dispatchCommand: api.orchestration.dispatchCommand,
        onFallback: (fallback) => {
          setNotice(`Summary handoff fell back to the full transcript: ${fallback}`);
        },
      })
        .then(() => {
          setPendingHarnessSwitch(null);
        })
        .catch((switchError) => {
          setError(
            switchError instanceof Error ? switchError.message : "Failed to switch PM harness.",
          );
        })
        .finally(() => {
          setSavingPmModelSelection(false);
        });
    },
    [environmentId, pendingHarnessSwitch, project, projectId],
  );
  const onPmModelOptionsChange = useCallback(
    (options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        setError("Environment API unavailable.");
        return;
      }
      if (!project) {
        setError("Project unavailable.");
        return;
      }
      if (!pmPickerSelection) {
        setError("PM model unavailable.");
        return;
      }

      setSavingPmModelSelection(true);
      setError(null);
      setNotice(null);
      void api.orchestration
        .dispatchCommand(
          buildPmModelSelectionUpdateCommand({
            project,
            selection: {
              instanceId: pmPickerSelection.instanceId,
              model: pmPickerSelection.model,
              options,
            },
          }),
        )
        .catch((saveError) => {
          setError(
            saveError instanceof Error ? saveError.message : "Failed to update PM model options.",
          );
        })
        .finally(() => {
          setSavingPmModelSelection(false);
        });
    },
    [environmentId, pmPickerSelection, project],
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
      {!error && notice ? (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          {notice}
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
            disabled={savingPmModelSelection || submitting || isAnsweringUserInput}
            onChange={(event) => {
              if (activePendingProgress) {
                setActivePendingUserInputCustomAnswer(event.currentTarget.value);
              } else {
                setComposerDraftPrompt(composerDraftTarget, event.currentTarget.value);
              }
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
              <div className="flex flex-wrap items-center gap-1.5">
                <ProviderModelPicker
                  compact
                  activeInstanceId={pmPickerSelection.instanceId}
                  model={pmPickerSelection.model}
                  lockedProvider={null}
                  lockedContinuationGroupKey={null}
                  instanceEntries={pmProviderEntries}
                  modelOptionsByInstance={pmModelOptionsByInstance}
                  disabled={!project || savingPmModelSelection}
                  triggerClassName="max-w-64"
                  {...(serverConfig?.keybindings ? { keybindings: serverConfig.keybindings } : {})}
                  onInstanceModelChange={onPmModelSelect}
                />
                <TraitsPicker
                  provider={pmSelectedInstanceEntry?.driverKind ?? ProviderDriverKind.make("codex")}
                  models={pmSelectedInstanceEntry?.models ?? []}
                  model={pmPickerSelection.model}
                  prompt=""
                  onPromptChange={() => {}}
                  modelOptions={pmModelSelection?.options ?? null}
                  allowPromptInjectedEffort={false}
                  triggerVariant="outline"
                  triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                  disabled={!project || savingPmModelSelection}
                  onModelOptionsChange={onPmModelOptionsChange}
                />
              </div>
            ) : (
              <span className="truncate text-[11px] text-muted-foreground">
                No PM model configured
              </span>
            )}
          </div>
          {isRunning ? (
            <span className="text-[11px] font-medium text-muted-foreground">Running</span>
          ) : null}
        </div>
      </form>
      <PmHarnessSwitchDialog
        decision={pendingHarnessSwitch?.gate ?? null}
        disabled={savingPmModelSelection}
        onAction={runPendingHarnessSwitchAction}
        onClose={closePmHarnessSwitchDialog}
      />
    </div>
  );
}

export function PmHarnessSwitchDialog({
  decision,
  disabled,
  onAction,
  onClose,
}: {
  readonly decision: Extract<
    PmHarnessSwitchGateDecision,
    { readonly kind: "cross-harness" }
  > | null;
  readonly disabled: boolean;
  readonly onAction: (action: PmHarnessSwitchAction) => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Switch PM harness?</DialogTitle>
          <DialogDescription>
            The PM session cannot continue directly across harnesses. Switch from{" "}
            {decision?.fromLabel ?? "the current harness"} to{" "}
            {decision?.toLabel ?? "the new harness"} by handing off the conversation or starting
            with a fresh PM chat.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              disabled={disabled}
              onClick={() => onAction("transcript")}
              type="button"
              variant="outline"
            >
              Hand off history (full transcript)
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onAction("summary")}
              type="button"
              variant="outline"
            >
              Hand off history (summary brief)
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onAction("fresh")}
              type="button"
              variant="outline"
            >
              Start fresh
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onAction("cancel")}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
