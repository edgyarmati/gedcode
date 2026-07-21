import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import {
  EnvironmentId,
  ORCHESTRATION_CAPABILITY_TIERS,
  ProjectId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCapabilityTier,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { FileTextIcon, LoaderCircleIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { retainOrchestratorProjectSubscription } from "../../environments/runtime/service";
import { useEnvironmentApiAvailable } from "../../hooks/useEnvironmentApiAvailable";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { selectProjectByRef, selectThreadShellByRef, useStore } from "../../store";
import { seedOrchestratorConfigDraft } from "../orchestrator/projectOrchestrationSettings.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ProjectContextTierCard } from "./ProjectContextTierCard";
import { ProjectContextRunReviewDialog } from "./ProjectContextRunReviewDialog";

const ONBOARDING_QUERY_PREFIX = "project-context-onboarding";

function decodeRoutePart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function projectContextRouteTarget(pathname: string):
  | {
      readonly kind: "project";
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
    }
  | {
      readonly kind: "thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | { readonly kind: "draft"; readonly draftId: DraftId }
  | null {
  const orchestrator = pathname.match(/^\/orch\/([^/]+)\/([^/]+)(?:\/|$)/u);
  if (orchestrator) {
    const environmentId = decodeRoutePart(orchestrator[1] ?? "");
    const projectId = decodeRoutePart(orchestrator[2] ?? "");
    return environmentId && projectId
      ? {
          kind: "project",
          environmentId: EnvironmentId.make(environmentId),
          projectId: ProjectId.make(projectId),
        }
      : null;
  }
  if (pathname === "/orch" || pathname.startsWith("/orch/")) {
    return null;
  }

  const draft = pathname.match(/^\/draft\/([^/]+)(?:\/|$)/u);
  if (draft) {
    const draftId = decodeRoutePart(draft[1] ?? "");
    return draftId ? { kind: "draft", draftId: DraftId.make(draftId) } : null;
  }

  const thread = pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/u);
  if (thread) {
    const environmentId = decodeRoutePart(thread[1] ?? "");
    const threadId = decodeRoutePart(thread[2] ?? "");
    return environmentId && threadId
      ? {
          kind: "thread",
          environmentId: EnvironmentId.make(environmentId),
          threadId: ThreadId.make(threadId),
        }
      : null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectContextOnboardingCoordinator() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeTarget = useMemo(() => projectContextRouteTarget(pathname), [pathname]);
  const serverThread = useStore((state) =>
    routeTarget?.kind === "thread"
      ? selectThreadShellByRef(
          state,
          scopeThreadRef(routeTarget.environmentId, routeTarget.threadId),
        )
      : undefined,
  );
  const draftThread = useComposerDraftStore((state) =>
    routeTarget?.kind === "draft" ? state.getDraftSession(routeTarget.draftId) : null,
  );
  const projectRef: ScopedProjectRef | null = useMemo(
    () =>
      routeTarget?.kind === "project"
        ? scopeProjectRef(routeTarget.environmentId, routeTarget.projectId)
        : serverThread
          ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
          : draftThread
            ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
            : null,
    [draftThread, routeTarget, serverThread],
  );
  const project = useStore((state) => selectProjectByRef(state, projectRef));
  const latestContextRun = useStore((state) => {
    if (!projectRef) return undefined;
    return Object.values(
      state.environmentStateById[String(projectRef.environmentId)]?.projectContextRunById ?? {},
    )
      .filter((run) => run.projectId === projectRef.projectId)
      .toSorted(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          String(right.id).localeCompare(String(left.id)),
      )[0];
  });
  const apiAvailable = useEnvironmentApiAvailable(
    projectRef?.environmentId ?? EnvironmentId.make("unavailable"),
  );
  const queryClient = useQueryClient();
  const [selectedTier, setSelectedTier] = useState<OrchestrationCapabilityTier>("smart");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"dismiss" | "start" | null>(null);
  const [acknowledgedPromptKey, setAcknowledgedPromptKey] = useState<string | null>(null);
  const queryKey = useMemo(
    () => [ONBOARDING_QUERY_PREFIX, projectRef?.environmentId, projectRef?.projectId] as const,
    [projectRef?.environmentId, projectRef?.projectId],
  );

  useEffect(() => {
    if (!projectRef) return;
    return retainOrchestratorProjectSubscription(projectRef.environmentId, projectRef.projectId);
  }, [projectRef]);

  const onboardingQuery = useQuery({
    queryKey,
    enabled: Boolean(projectRef && apiAvailable),
    queryFn: async () => {
      if (!projectRef) throw new Error("Project context is unavailable.");
      const api = readEnvironmentApi(projectRef.environmentId);
      if (!api) throw new Error("Project environment is unavailable.");
      const migration = await api.orchestrator.getPresetMigration();
      if (migration.status !== "completed") return null;
      const [onboarding, config] = await Promise.all([
        api.orchestrator.getProjectContextOnboarding({
          projectId: projectRef.projectId,
        }),
        api.server.getConfig(),
      ]);
      return { onboarding, config };
    },
    retry: false,
  });

  useEffect(() => {
    setSelectedTier(
      onboardingQuery.data?.config.settings.orchestratorDefaults.projectContextDefaultTier ??
        "smart",
    );
    setActionError(null);
    setSubmitting(null);
  }, [
    projectRef?.environmentId,
    projectRef?.projectId,
    onboardingQuery.data?.config.settings.orchestratorDefaults.projectContextDefaultTier,
  ]);

  useEffect(() => {
    if (!latestContextRun) return;
    void queryClient.invalidateQueries({ queryKey });
  }, [latestContextRun, queryClient, queryKey]);

  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        deriveProviderInstanceEntries(onboardingQuery.data?.config.providers ?? []),
      ),
    [onboardingQuery.data?.config.providers],
  );

  const projectPresetOverrides = useMemo(
    () => seedOrchestratorConfigDraft(project?.orchestratorConfig).capabilityPresets,
    [project?.orchestratorConfig],
  );
  const selections = useMemo(() => {
    const global = onboardingQuery.data?.config.settings.orchestratorDefaults.capabilityPresets;
    if (!global) return null;
    return Object.fromEntries(
      ORCHESTRATION_CAPABILITY_TIERS.map((tier) => [
        tier,
        projectPresetOverrides[tier] ?? global[tier],
      ]),
    ) as Record<OrchestrationCapabilityTier, ModelSelection>;
  }, [
    onboardingQuery.data?.config.settings.orchestratorDefaults.capabilityPresets,
    projectPresetOverrides,
  ]);

  if (!projectRef) return null;

  if (latestContextRun?.status === "pending-review") {
    return (
      <ProjectContextRunReviewDialog
        environmentId={projectRef.environmentId}
        projectId={projectRef.projectId}
        runId={latestContextRun.id}
      />
    );
  }

  if (onboardingQuery.isError) {
    return (
      <Dialog open onOpenChange={() => undefined}>
        <DialogPopup showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Project context could not be checked</DialogTitle>
            <DialogDescription>
              GedCode could not safely inspect this project's context files.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <p className="text-sm text-destructive">{errorMessage(onboardingQuery.error)}</p>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={() => void onboardingQuery.refetch()}>
              <RefreshCwIcon className="size-4" /> Retry
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  }

  const onboarding = onboardingQuery.data?.onboarding;
  const onboardingPromptKey = onboarding
    ? [
        projectRef.environmentId,
        projectRef.projectId,
        onboarding.schemaVersion,
        onboarding.fingerprint,
      ].join("\0")
    : null;
  if (
    !onboarding?.shouldPrompt ||
    (onboardingPromptKey !== null && acknowledgedPromptKey === onboardingPromptKey)
  ) {
    return null;
  }

  if (!selections) {
    return (
      <Dialog open onOpenChange={() => undefined}>
        <DialogPopup showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Project context needs capability presets</DialogTitle>
            <DialogDescription>
              Complete Orchestrator preset setup before choosing an agent for project context.
            </DialogDescription>
          </DialogHeader>
        </DialogPopup>
      </Dialog>
    );
  }

  const runAction = async (action: "dismiss" | "start") => {
    const api = readEnvironmentApi(projectRef.environmentId);
    if (!api || submitting) return;
    setSubmitting(action);
    setActionError(null);
    try {
      if (action === "dismiss") {
        await api.orchestrator.dismissProjectContextOnboarding({
          projectId: projectRef.projectId,
          schemaVersion: onboarding.schemaVersion,
          fingerprint: onboarding.fingerprint,
        });
      } else {
        await api.orchestrator.requestProjectContextRun({
          projectId: projectRef.projectId,
          tier: selectedTier,
        });
      }
      setAcknowledgedPromptKey(onboardingPromptKey);
      await queryClient.invalidateQueries({ queryKey });
      queryClient.setQueryData<typeof onboardingQuery.data>(queryKey, (current) => {
        if (
          !current?.onboarding ||
          current.onboarding.schemaVersion !== onboarding.schemaVersion ||
          current.onboarding.fingerprint !== onboarding.fingerprint
        ) {
          return current;
        }
        return {
          ...current,
          onboarding: {
            ...current.onboarding,
            shouldPrompt: false,
          },
        };
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setSubmitting(null);
    }
  };

  const isPopulate = onboarding.promptKind === "populate";
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogPopup className="max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-primary" />
            {isPopulate ? "Populate project context?" : "Review project context?"}
          </DialogTitle>
          <DialogDescription>
            {isPopulate
              ? "Give coding agents durable guidance about this project before they start working."
              : "Have an agent review the existing project guidance and propose focused updates."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon className="size-4" /> Canonical context
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {onboarding.files.map((file) => (
                <div key={file.path} className="flex min-w-0 justify-between gap-3">
                  <span className="truncate">{file.path}</span>
                  <span className="shrink-0 capitalize">{file.classification}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Choose the agent preset</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              This choice becomes the default for future project-context runs.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {ORCHESTRATION_CAPABILITY_TIERS.map((tier) => (
                <ProjectContextTierCard
                  key={tier}
                  tier={tier}
                  selection={selections[tier]}
                  instanceEntries={instanceEntries}
                  selected={selectedTier === tier}
                  onSelect={() => setSelectedTier(tier)}
                />
              ))}
            </div>
          </div>
          {actionError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {actionError}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting !== null}
            onClick={() => void runAction("dismiss")}
          >
            {submitting === "dismiss" ? <LoaderCircleIcon className="animate-spin" /> : null}
            Dismiss for now
          </Button>
          <Button disabled={submitting !== null} onClick={() => void runAction("start")}>
            {submitting === "start" ? <LoaderCircleIcon className="animate-spin" /> : null}
            {isPopulate ? "Populate context" : "Review context"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
