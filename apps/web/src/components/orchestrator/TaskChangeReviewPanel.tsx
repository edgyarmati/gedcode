import type { EnvironmentId, OrchestratorTaskChanges } from "@t3tools/contracts";
import { CheckIcon, LoaderCircleIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { ensureLocalApi } from "../../localApi";
import type { OrchestratorTask } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type PendingAction = "commit" | "discard" | "return" | "no-change" | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TaskChangeReviewPanel({
  environmentId,
  task,
}: {
  environmentId: EnvironmentId;
  task: OrchestratorTask;
}) {
  const [changes, setChanges] = useState<OrchestratorTaskChanges | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState("");
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChanges = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || task.status !== "change-review") return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.orchestrator.inspectTaskChanges({ taskId: task.id });
      setChanges(result.changes);
      setSelectedPaths(new Set(result.changes.paths));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [environmentId, task.id, task.status]);

  useEffect(() => {
    if (task.status !== "change-review") {
      setChanges(null);
      setSelectedPaths(new Set());
      setError(null);
      return;
    }
    void loadChanges();
  }, [loadChanges, task.status]);

  const selected = useMemo(
    () => changes?.paths.filter((path) => selectedPaths.has(path)) ?? [],
    [changes, selectedPaths],
  );
  const updateAfterMutation = (next: OrchestratorTaskChanges) => {
    setChanges(next);
    setSelectedPaths(new Set(next.paths));
  };
  const runAction = async (
    action: Exclude<PendingAction, null>,
    operation: () => Promise<void>,
  ) => {
    setPendingAction(action);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingAction(null);
    }
  };

  if (task.status === "review" && task.changeReview === null && task.verification === null) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Work outcome</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If the completed work correctly required no repository changes, record that outcome and
          archive the task. The server verifies the branch baseline and clean worktree first.
        </p>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <Button
          className="mt-3 w-full"
          disabled={pendingAction !== null}
          onClick={() =>
            void runAction("no-change", async () => {
              const api = readEnvironmentApi(environmentId);
              if (!api) return;
              await api.orchestrator.completeTaskWithoutChanges({ taskId: task.id });
            })
          }
          size="sm"
          variant="outline"
        >
          {pendingAction === "no-change" ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          No changes needed
        </Button>
      </section>
    );
  }

  if (task.status !== "change-review") return null;

  const disabled = loading || pendingAction !== null;
  return (
    <section className="space-y-3 rounded-lg border border-warning/35 bg-warning/8 p-4 dark:bg-warning/12">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-warning-foreground uppercase">Change review</h2>
        {changes ? <Badge variant="outline">{changes.paths.length} paths</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Review worker changes before verification. Untracked files are listed, but their contents
        are not included in the automatic preview.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" /> Inspecting task worktree…
        </div>
      ) : null}
      {changes ? (
        <>
          {changes.staged ? (
            <p className="text-xs text-destructive">
              The worktree already has staged changes. Return it to the worker to resolve the index
              before making a scoped commit.
            </p>
          ) : null}
          <div className="max-h-48 space-y-1 overflow-auto rounded-md border border-border bg-background p-2">
            {changes.paths.map((path) => (
              <label className="flex cursor-pointer items-start gap-2 text-xs" key={path}>
                <Checkbox
                  checked={selectedPaths.has(path)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setSelectedPaths((current) => {
                      const next = new Set(current);
                      if (checked) next.add(path);
                      else next.delete(path);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 break-all font-mono">{path}</span>
              </label>
            ))}
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
            {changes.diff || "No tracked diff preview is available."}
          </pre>
          {changes.diffTruncated ? (
            <p className="text-xs text-warning-foreground">
              Preview truncated at the server limit. Inspect the worktree directly before
              committing.
            </p>
          ) : null}
          <Input
            aria-label="Commit message"
            disabled={disabled}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Descriptive commit message"
            value={commitMessage}
          />
          <Button
            className="w-full"
            disabled={disabled || selected.length === 0 || changes.staged}
            onClick={() =>
              void runAction("commit", async () => {
                const api = readEnvironmentApi(environmentId);
                if (!api) return;
                const result = await api.orchestrator.commitTaskChanges({
                  taskId: task.id,
                  paths: selected,
                  message: commitMessage,
                });
                updateAfterMutation(result.changes);
                setCommitMessage("");
              })
            }
            size="sm"
          >
            {pendingAction === "commit" ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <CheckIcon className="size-4" />
            )}
            Commit selected
          </Button>
          <Textarea
            aria-label="Revision instructions"
            disabled={disabled}
            onChange={(event) => setRevisionInstructions(event.target.value)}
            placeholder="Explain precisely what the worker should revise"
            size="sm"
            value={revisionInstructions}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={disabled || revisionInstructions.trim().length === 0}
              onClick={() =>
                void runAction("return", async () => {
                  const api = readEnvironmentApi(environmentId);
                  if (!api) return;
                  await api.orchestrator.returnTaskChanges({
                    taskId: task.id,
                    instructions: revisionInstructions,
                  });
                })
              }
              size="sm"
              variant="outline"
            >
              {pendingAction === "return" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <RotateCcwIcon className="size-4" />
              )}
              Revise
            </Button>
            <Button
              disabled={disabled || selected.length === 0}
              onClick={() =>
                void runAction("discard", async () => {
                  const confirmed = await ensureLocalApi().dialogs.confirm(
                    `Permanently discard ${selected.length} selected path${selected.length === 1 ? "" : "s"} from this task worktree? This cannot be undone.`,
                  );
                  if (!confirmed) return;
                  const api = readEnvironmentApi(environmentId);
                  if (!api) return;
                  const result = await api.orchestrator.discardTaskChanges({
                    taskId: task.id,
                    paths: selected,
                  });
                  updateAfterMutation(result.changes);
                })
              }
              size="sm"
              variant="destructive"
            >
              {pendingAction === "discard" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <Trash2Icon className="size-4" />
              )}
              Discard
            </Button>
          </div>
        </>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!loading && !changes ? (
        <Button className="w-full" onClick={() => void loadChanges()} size="sm" variant="outline">
          Retry inspection
        </Button>
      ) : null}
    </section>
  );
}
