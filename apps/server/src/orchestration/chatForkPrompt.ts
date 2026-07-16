import type { OrchestrationMessage } from "@t3tools/contracts";

function renderMessage(message: OrchestrationMessage): string {
  const attachments =
    message.attachments && message.attachments.length > 0
      ? `\nAttachments: ${message.attachments.map((attachment) => attachment.name).join(", ")}`
      : "";
  return `<message role="${message.role}">\n${message.text}${attachments}\n</message>`;
}

export function prependCopiedForkHistory(input: {
  readonly history: ReadonlyArray<OrchestrationMessage>;
  readonly message: string;
}): string {
  if (input.history.length === 0) return input.message;
  return [
    "<forked_conversation_history>",
    "This task continues the visible conversation below in a fresh provider session.",
    "The filesystem is the current filesystem state; do not assume it was rolled back to the selected message.",
    ...input.history.map(renderMessage),
    "</forked_conversation_history>",
    "<new_user_message>",
    input.message,
    "</new_user_message>",
  ].join("\n");
}
