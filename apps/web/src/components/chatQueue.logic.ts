import type { SessionPhase } from "../types";

export function shouldQueueComposerSubmission(input: {
  readonly isServerThread: boolean;
  readonly phase: SessionPhase;
  readonly messageQueueEnabled: boolean;
}): boolean {
  return input.isServerThread && input.phase === "running" && input.messageQueueEnabled;
}
