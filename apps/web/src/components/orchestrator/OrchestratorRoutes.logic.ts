import type { ProjectId } from "@t3tools/contracts";

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
