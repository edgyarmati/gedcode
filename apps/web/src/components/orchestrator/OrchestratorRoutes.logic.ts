import type { ProjectId, TaskId } from "@t3tools/contracts";

export async function confirmAndClearPmChat(input: {
  readonly projectId: ProjectId;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly clearPmChat: (input: { readonly projectId: ProjectId }) => Promise<unknown>;
}): Promise<boolean> {
  const confirmed = await input.confirm(
    "Clear the PM chat? This resets the visible PM conversation and starts the PM with fresh memory.",
  );
  if (!confirmed) {
    return false;
  }
  await input.clearPmChat({ projectId: input.projectId });
  return true;
}

export async function confirmAndCancelTask(input: {
  readonly taskId: TaskId;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly cancelTask: (input: { readonly taskId: TaskId }) => Promise<unknown>;
}): Promise<boolean> {
  const confirmed = await input.confirm(
    "Cancel this task? This marks it abandoned and frees its worktree slot.",
  );
  if (!confirmed) {
    return false;
  }
  await input.cancelTask({ taskId: input.taskId });
  return true;
}
