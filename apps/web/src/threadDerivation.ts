import type { MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import type { EnvironmentState } from "./store";
import type {
  ChatMessage,
  ProposedPlan,
  Thread,
  ThreadSession,
  ThreadShell,
  ThreadTurnState,
  TurnDiffSummary,
} from "./types";
import { collectOrderedRecordValues } from "./storeCollection";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIVITIES: Thread["activities"] = [];
const EMPTY_PROPOSED_PLANS: ProposedPlan[] = [];
const EMPTY_TURN_DIFF_SUMMARIES: TurnDiffSummary[] = [];
const EMPTY_MESSAGE_MAP: Record<MessageId, ChatMessage> = {};
const EMPTY_ACTIVITY_MAP: Record<string, Thread["activities"][number]> = {};
const EMPTY_PROPOSED_PLAN_MAP: Record<string, ProposedPlan> = {};
const EMPTY_TURN_DIFF_MAP: Record<TurnId, TurnDiffSummary> = {};

const threadCache = new WeakMap<
  ThreadShell,
  {
    session: ThreadSession | null;
    turnState: ThreadTurnState | undefined;
    messages: Thread["messages"];
    activities: Thread["activities"];
    proposedPlans: Thread["proposedPlans"];
    turnDiffSummaries: Thread["turnDiffSummaries"];
    thread: Thread;
  }
>();

function selectThreadMessages(state: EnvironmentState, threadId: ThreadId): Thread["messages"] {
  return collectOrderedRecordValues(
    state.messageIdsByThreadId[threadId],
    state.messageByThreadId[threadId] ?? EMPTY_MESSAGE_MAP,
    EMPTY_MESSAGES,
  );
}

function selectThreadActivities(state: EnvironmentState, threadId: ThreadId): Thread["activities"] {
  return collectOrderedRecordValues(
    state.activityIdsByThreadId[threadId],
    state.activityByThreadId[threadId] ?? EMPTY_ACTIVITY_MAP,
    EMPTY_ACTIVITIES,
  );
}

function selectThreadProposedPlans(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread["proposedPlans"] {
  return collectOrderedRecordValues(
    state.proposedPlanIdsByThreadId[threadId],
    state.proposedPlanByThreadId[threadId] ?? EMPTY_PROPOSED_PLAN_MAP,
    EMPTY_PROPOSED_PLANS,
  );
}

function selectThreadTurnDiffSummaries(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread["turnDiffSummaries"] {
  return collectOrderedRecordValues(
    state.turnDiffIdsByThreadId[threadId],
    state.turnDiffSummaryByThreadId[threadId] ?? EMPTY_TURN_DIFF_MAP,
    EMPTY_TURN_DIFF_SUMMARIES,
  );
}

export function getThreadFromEnvironmentState(
  state: EnvironmentState,
  threadId: ThreadId,
): Thread | undefined {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return undefined;
  }

  const session = state.threadSessionById[threadId] ?? null;
  const turnState = state.threadTurnStateById[threadId];
  const messages = selectThreadMessages(state, threadId);
  const activities = selectThreadActivities(state, threadId);
  const proposedPlans = selectThreadProposedPlans(state, threadId);
  const turnDiffSummaries = selectThreadTurnDiffSummaries(state, threadId);
  const cached = threadCache.get(shell);

  if (
    cached &&
    cached.session === session &&
    cached.turnState === turnState &&
    cached.messages === messages &&
    cached.activities === activities &&
    cached.proposedPlans === proposedPlans &&
    cached.turnDiffSummaries === turnDiffSummaries
  ) {
    return cached.thread;
  }

  const thread: Thread = {
    ...shell,
    session,
    latestTurn: turnState?.latestTurn ?? null,
    pendingSourceProposedPlan: turnState?.pendingSourceProposedPlan,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
  };

  threadCache.set(shell, {
    session,
    turnState,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
    thread,
  });

  return thread;
}
