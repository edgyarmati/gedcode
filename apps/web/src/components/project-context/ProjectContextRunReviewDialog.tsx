import type { EnvironmentId, ProjectContextRunId, ProjectId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, FileDiffIcon, LoaderCircleIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { ensureLocalApi } from "../../localApi";
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
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export const projectContextRunReviewQueryKey = (
  environmentId: EnvironmentId,
  projectId: ProjectId,
  runId: ProjectContextRunId,
) => ["project-context-run-review", environmentId, projectId, runId] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectContextRunReviewDialog({
  environmentId,
  projectId,
  runId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: ProjectContextRunId;
}) {
  const queryKey = projectContextRunReviewQueryKey(environmentId, projectId, runId);
  const [commitMessage, setCommitMessage] = useState("docs(context): update project guidance");
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [pendingAction, setPendingAction] = useState<"commit" | "revise" | "discard" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reviewQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const api = readEnvironmentApi(environmentId);
      if (!api) throw new Error("Project environment is unavailable.");
      const result = await api.orchestrator.getProjectContextRunReview({ projectId });
      if (result.review?.runId !== runId) {
        throw new Error("This project-context review is no longer current.");
      }
      return result.review;
    },
    retry: false,
  });

  const runAction = async (
    action: Exclude<typeof pendingAction, null>,
    operation: () => Promise<void>,
  ) => {
    if (pendingAction !== null) return;
    setPendingAction(action);
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const review = reviewQuery.data;
  const disabled = pendingAction !== null || reviewQuery.isFetching;

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogPopup className="max-w-3xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDiffIcon className="size-5 text-primary" /> Review project context changes
          </DialogTitle>
          <DialogDescription>
            Nothing is committed automatically. Review the agent's exact proposal, then commit,
            request another revision, or discard it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {reviewQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Loading reviewed changes…
            </div>
          ) : null}
          {review ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {review.changes.length} changed path{review.changes.length === 1 ? "" : "s"}
                </Badge>
                {review.scopeViolationPaths.length > 0 ? (
                  <Badge variant="destructive">
                    {review.scopeViolationPaths.length} scope violation
                    {review.scopeViolationPaths.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
                {review.result}
              </div>
              {review.scopeViolationPaths.length > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  The agent changed state outside its allowed context scope. Resolve these paths
                  before accepting or revising the run: {review.scopeViolationPaths.join(", ")}
                </div>
              ) : null}
              <div className="max-h-64 overflow-auto rounded-md border border-border bg-background p-2">
                {review.changes.map((change) => (
                  <div
                    className="flex items-center justify-between gap-3 px-1 py-1 text-xs"
                    key={change.path}
                  >
                    <span className="min-w-0 break-all font-mono">{change.path}</span>
                    <Badge className="shrink-0 capitalize" variant="outline">
                      {change.kind}
                    </Badge>
                  </div>
                ))}
              </div>
              <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                {review.diff || "The agent reported no context-file changes."}
              </pre>
              {review.diffTruncated ? (
                <p className="text-xs text-warning-foreground">
                  The preview reached the server size limit. Inspect the listed files before
                  committing.
                </p>
              ) : null}
              <Input
                aria-label="Project context commit message"
                disabled={disabled}
                onChange={(event) => setCommitMessage(event.target.value)}
                value={commitMessage}
              />
              <Button
                className="w-full"
                disabled={
                  disabled || review.changes.length === 0 || commitMessage.trim().length === 0
                }
                onClick={() =>
                  void runAction("commit", async () => {
                    const api = readEnvironmentApi(environmentId);
                    if (!api) throw new Error("Project environment is unavailable.");
                    await api.orchestrator.commitProjectContextRun({
                      runId,
                      message: commitMessage,
                    });
                  })
                }
              >
                {pendingAction === "commit" ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <CheckIcon className="size-4" />
                )}
                Commit context changes
              </Button>
              <Textarea
                aria-label="Project context revision instructions"
                disabled={disabled}
                onChange={(event) => setRevisionInstructions(event.target.value)}
                placeholder="Explain what the context agent should change"
                size="sm"
                value={revisionInstructions}
              />
            </>
          ) : null}
          {reviewQuery.isError || actionError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {actionError ?? errorMessage(reviewQuery.error)}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          {reviewQuery.isError ? (
            <Button onClick={() => void reviewQuery.refetch()} variant="outline">
              Retry inspection
            </Button>
          ) : null}
          {review ? (
            <>
              <Button
                disabled={disabled || revisionInstructions.trim().length === 0}
                onClick={() =>
                  void runAction("revise", async () => {
                    const api = readEnvironmentApi(environmentId);
                    if (!api) throw new Error("Project environment is unavailable.");
                    await api.orchestrator.reviseProjectContextRun({
                      runId,
                      instructions: revisionInstructions,
                    });
                  })
                }
                variant="outline"
              >
                {pendingAction === "revise" ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <RotateCcwIcon className="size-4" />
                )}
                Revise
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  void runAction("discard", async () => {
                    const confirmed = await ensureLocalApi().dialogs.confirm(
                      "Discard this context agent proposal and restore the exact pre-run context? Existing unrelated checkout changes will be preserved.",
                    );
                    if (!confirmed) return;
                    const api = readEnvironmentApi(environmentId);
                    if (!api) throw new Error("Project environment is unavailable.");
                    await api.orchestrator.discardProjectContextRun({ runId });
                  })
                }
                variant="destructive"
              >
                {pendingAction === "discard" ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <Trash2Icon className="size-4" />
                )}
                Discard
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
