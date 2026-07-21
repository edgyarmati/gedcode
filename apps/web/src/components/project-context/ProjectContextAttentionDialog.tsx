import type { EnvironmentId, ProjectContextRunId, ProjectId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, RefreshCwIcon, WandSparklesIcon } from "lucide-react";
import { useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { Badge } from "../ui/badge";
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

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ProjectContextAttentionDialog({
  environmentId,
  projectId,
  runId,
  open,
  onOpenChange,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: ProjectContextRunId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pendingAction, setPendingAction] = useState<"retry" | "reconcile" | "hand-to-pm" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const reviewQuery = useQuery({
    queryKey: ["project-context-attention", environmentId, projectId, runId],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Project environment is unavailable.");
      const result = await api.orchestrator.getProjectContextRunReview({ projectId });
      if (result.review?.runId !== runId) {
        throw new Error("This project-context issue is no longer current.");
      }
      return result.review;
    },
  });
  const resolve = async (action: "retry" | "reconcile" | "hand-to-pm") => {
    if (pendingAction) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) return;
    setPendingAction(action);
    setActionError(null);
    try {
      await api.orchestrator.resolveProjectContextRunAttention({ runId, action });
      onOpenChange(false);
    } catch (error) {
      setActionError(errorMessage(error));
      await reviewQuery.refetch();
    } finally {
      setPendingAction(null);
    }
  };
  const review = reviewQuery.data;
  const conflict = review?.conflict ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Project context needs attention</DialogTitle>
          <DialogDescription>
            GedCode kept the PM paused because the completed context proposal could not be applied
            safely.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {reviewQuery.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Inspecting current state…
            </p>
          ) : null}
          {review ? (
            <>
              <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                {review.result}
              </p>
              {conflict ? (
                <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{conflict.kind}</Badge>
                    {conflict.autoReconcile ? (
                      <Badge variant="outline">Safe merge available</Badge>
                    ) : null}
                  </div>
                  <p>{conflict.detail}</p>
                  {conflict.paths.length > 0 ? (
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {conflict.paths.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The blocking state appears to be clear. Retry will re-audit and settle this run.
                </p>
              )}
            </>
          ) : null}
          {reviewQuery.isError || actionError ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {actionError ?? errorMessage(reviewQuery.error)}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            disabled={pendingAction !== null}
            onClick={() => void reviewQuery.refetch()}
            variant="outline"
          >
            <RefreshCwIcon className="size-4" /> Reinspect
          </Button>
          {review ? (
            <Button disabled={pendingAction !== null} onClick={() => void resolve("retry")}>
              {pendingAction === "retry" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              Retry
            </Button>
          ) : null}
          {conflict?.autoReconcile ? (
            <Button disabled={pendingAction !== null} onClick={() => void resolve("reconcile")}>
              {pendingAction === "reconcile" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <WandSparklesIcon className="size-4" />
              )}
              Reconcile
            </Button>
          ) : null}
          {conflict?.actions.includes("hand-to-pm") ? (
            <Button
              disabled={pendingAction !== null}
              onClick={() => void resolve("hand-to-pm")}
              variant="outline"
            >
              {pendingAction === "hand-to-pm" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : null}
              Hand to PM
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
