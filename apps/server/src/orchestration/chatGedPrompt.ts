/**
 * Lightweight workflow guidance for normal chat threads running in GED mode.
 *
 * This deliberately contains no managed-agent protocol. The selected provider
 * remains the sole owner of the turn and may use its native runtime features at
 * its own discretion.
 */
export const GED_CHAT_WORKFLOW_INSTRUCTIONS = `GED workflow mode is enabled for this chat.

Follow the repository's GED workflow and keep its checkpoint documents current:
- For non-trivial work, clarify important product decisions before implementation. Use the grill-me skill when it is available.
- Write or refresh .ged/work/root/SPEC.md, TASKS.md, and TESTS.md before implementing broad changes. Use the ged-planning skill when it is available.
- Implement one bounded NEXT slice at a time and record progress in .ged/work/root/STATE.md. Use the ged-execution skill when it is available.
- Verify the completed slice before committing it, including repository-required format, lint, typecheck, and test gates. Use the ged-verification skill when it is available.
- Make small, descriptive, atomic commits and preserve unrelated user changes.

GED mode does not require managed subagents or special role models. Provider-native delegation remains at your discretion.`;

export function applyGedChatWorkflowPrompt(input: {
  readonly message: string;
  readonly enabled: boolean;
}): string {
  if (!input.enabled) {
    return input.message;
  }
  return `${GED_CHAT_WORKFLOW_INSTRUCTIONS}\n\nUser request:\n${input.message}`;
}
