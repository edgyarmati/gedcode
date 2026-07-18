import {
  HELPER_RUN_RESULT_MAX_CHARS,
  type OrchestrationHelperRun,
  type TaskId,
} from "@t3tools/contracts";

import { scrubSecrets } from "./untrustedContent.ts";

const HELPER_CONTEXT_MAX_CHARS = 16_000;

export function sanitizeHelperResult(result: string): string {
  return scrubSecrets(result)
    .replace(/\bauthorization\s*:\s*(?:bearer\s+)?[^\s]+/gi, "Authorization: [REDACTED]")
    .slice(0, HELPER_RUN_RESULT_MAX_CHARS);
}

export function appendCompletedHelperContext(input: {
  readonly instructions: string;
  readonly taskId: TaskId;
  readonly helperRuns: ReadonlyArray<OrchestrationHelperRun>;
}): string {
  const completed = input.helperRuns.filter(
    (run) =>
      run.attachment.kind === "task" &&
      run.attachment.taskId === input.taskId &&
      run.status === "completed" &&
      run.result !== null,
  );
  if (completed.length === 0) return input.instructions;

  const context = completed
    .map(
      (run) =>
        `Helper ${run.id} (${run.tier}, ${run.model}):\n${sanitizeHelperResult(run.result ?? "")}`,
    )
    .join("\n\n")
    .slice(0, HELPER_CONTEXT_MAX_CHARS);
  return `${input.instructions}\n\n----- BEGIN GEDCODE READ-ONLY HELPER RESULTS -----\n${context}\n----- END GEDCODE READ-ONLY HELPER RESULTS -----`;
}
