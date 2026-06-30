import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useServerConfig } from "../../rpc/serverState";
import type { Project, Thread } from "../../types";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { backendLabel } from "./RoleBackendPicker";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pmModelSelection = readPmModelSelection(project);
  const providerEntries = useMemo(
    () => deriveProviderInstanceEntries(serverConfig?.providers ?? []),
    [serverConfig?.providers],
  );
  const pmModelLabel = pmModelSelection
    ? backendLabel(
        pmModelSelection,
        providerEntries.find((entry) => entry.instanceId === pmModelSelection.instanceId),
      )
    : "Not configured";
  const environmentAvailable = readEnvironmentApi(environmentId) !== undefined;
  const trimmedMessage = message.trim();
  const canSend = environmentAvailable && !submitting && trimmedMessage.length > 0;

  const onSend = useCallback(
    (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      if (!canSend) {
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
    [canSend, environmentId, projectId, trimmedMessage],
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
        <div className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 shadow-xs/5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24">
          <Textarea
            aria-label="Message PM"
            className="min-w-0 flex-1"
            disabled={submitting}
            onChange={(event) => setMessage(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message PM"
            ref={textareaRef}
            rows={3}
            unstyled
            value={message}
          />
          <Button
            aria-label="Send PM message"
            disabled={!canSend}
            size="icon"
            title={environmentAvailable ? "Send PM message" : "Environment unavailable"}
            type="submit"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </div>
        <div className="flex min-h-5 items-center justify-between gap-2">
          <span className="truncate text-[11px] text-muted-foreground">
            PM model: {pmModelLabel}
          </span>
          {isRunning ? (
            <span className="text-[11px] font-medium text-muted-foreground">Running</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
