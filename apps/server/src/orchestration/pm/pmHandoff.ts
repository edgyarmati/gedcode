import type { OrchestrationThread, OrchestrationThreadActivity } from "@t3tools/contracts";

export const DEFAULT_PM_HANDOFF_TRANSCRIPT_BUDGET_CHARS = 60_000;

type TranscriptEntry = {
  readonly createdAt: string;
  readonly order: number;
  readonly text: string;
};

const BEGIN_MARKER = "--- BEGIN PM HANDOFF CONTEXT ---";
const END_MARKER = "--- END PM HANDOFF CONTEXT ---";
const INTRO =
  "You are taking over as the project PM mid-conversation; the prior conversation follows.";
const TRUNCATION_NOTE = "[earlier history truncated]";
const EMPTY_NOTE = "[no prior PM messages or activities]";

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

const formatActivity = (activity: OrchestrationThreadActivity): string => {
  const label = activity.kind.length > 0 ? `activity:${activity.kind}` : "activity";
  return `[${activity.createdAt}] ${label}: ${oneLine(activity.summary)}`;
};

const formatThreadMessage = (message: OrchestrationThread["messages"][number]): string =>
  `[${message.createdAt}] ${message.role}: ${message.text.trim()}`;

const renderTranscript = (entries: ReadonlyArray<string>, truncated: boolean): string => {
  const body = entries.length > 0 ? entries.join("\n\n") : EMPTY_NOTE;
  return [BEGIN_MARKER, INTRO, ...(truncated ? [TRUNCATION_NOTE] : []), body, END_MARKER].join(
    "\n",
  );
};

function trimToBudget(text: string, budgetChars: number): string {
  if (text.length <= budgetChars) {
    return text;
  }
  if (budgetChars <= 0) {
    return "";
  }
  return text.slice(Math.max(0, text.length - budgetChars));
}

export function buildPmHandoffTranscript(
  thread: OrchestrationThread,
  budgetChars: number = DEFAULT_PM_HANDOFF_TRANSCRIPT_BUDGET_CHARS,
): string {
  const normalizedBudget = Math.max(0, Math.floor(budgetChars));
  const entries: TranscriptEntry[] = [
    ...thread.messages.map((message, index) => ({
      createdAt: message.createdAt,
      order: index,
      text: formatThreadMessage(message),
    })),
    ...thread.activities.map((activity, index) => ({
      createdAt: activity.createdAt,
      order: thread.messages.length + index,
      text: formatActivity(activity),
    })),
  ].toSorted((left, right) => {
    const createdAt = left.createdAt.localeCompare(right.createdAt);
    return createdAt === 0 ? left.order - right.order : createdAt;
  });

  let retained = entries.map((entry) => entry.text);
  let truncated = false;
  let rendered = renderTranscript(retained, truncated);

  while (rendered.length > normalizedBudget && retained.length > 0) {
    retained = retained.slice(1);
    truncated = true;
    rendered = renderTranscript(retained, truncated);
  }

  if (rendered.length <= normalizedBudget) {
    return rendered;
  }

  return trimToBudget(renderTranscript(retained, true), normalizedBudget);
}
