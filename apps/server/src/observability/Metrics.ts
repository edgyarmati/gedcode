import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";
import { dual } from "effect/Function";

import {
  compactMetricAttributes,
  normalizeModelMetricLabel,
  outcomeFromExit,
} from "./Attributes.ts";

export const rpcRequestsTotal = Metric.counter("t3_rpc_requests_total", {
  description: "Total RPC requests handled by the websocket RPC server.",
});

export const rpcRequestDuration = Metric.timer("t3_rpc_request_duration", {
  description: "RPC request handling duration.",
});

export const orchestrationCommandsTotal = Metric.counter("t3_orchestration_commands_total", {
  description: "Total orchestration commands dispatched.",
});

export const orchestrationCommandDuration = Metric.timer("t3_orchestration_command_duration", {
  description: "Orchestration command dispatch duration.",
});

export const orchestrationCommandAckDuration = Metric.timer(
  "t3_orchestration_command_ack_duration",
  {
    description:
      "Time from orchestration command dispatch to the first committed domain event emitted for that command.",
  },
);

export const orchestrationEventsProcessedTotal = Metric.counter(
  "t3_orchestration_events_processed_total",
  {
    description: "Total orchestration intent events processed by runtime reactors.",
  },
);

export const providerSessionsTotal = Metric.counter("t3_provider_sessions_total", {
  description: "Total provider session lifecycle operations.",
});

export const providerTurnsTotal = Metric.counter("t3_provider_turns_total", {
  description: "Total provider turn lifecycle operations.",
});

export const providerTurnDuration = Metric.timer("t3_provider_turn_duration", {
  description: "Provider turn request duration.",
});

export const providerRuntimeEventsTotal = Metric.counter("t3_provider_runtime_events_total", {
  description: "Total canonical provider runtime events processed.",
});

export const gitCommandsTotal = Metric.counter("t3_git_commands_total", {
  description: "Total git commands executed by the server runtime.",
});

export const gitCommandDuration = Metric.timer("t3_git_command_duration", {
  description: "Git command execution duration.",
});

export const terminalSessionsTotal = Metric.counter("t3_terminal_sessions_total", {
  description: "Total terminal sessions started.",
});

export const terminalRestartsTotal = Metric.counter("t3_terminal_restarts_total", {
  description: "Total terminal restart requests handled.",
});

// Orchestrator durability (WP-6)
//
// Observability for the durability paths that keep the orchestrator correct
// under crashes and contention: the PM reconciliation sweep, the PM re-entry
// turn latency, the SQLite busy/locked retry, and the periodic worktree reaper.
// These are instrumentation-only taps — they never change control flow.

export const orchestrationReconciliationSweepsTotal = Metric.counter(
  "t3_orchestration_reconciliation_sweeps_total",
  {
    description: "Total PM runtime reconciliation sweep runs.",
  },
);

export const orchestrationReconciliationSweepDuration = Metric.timer(
  "t3_orchestration_reconciliation_sweep_duration",
  {
    description: "PM runtime reconciliation sweep duration.",
  },
);

export const orchestrationReconciliationSettlementsRedrivenTotal = Metric.counter(
  "t3_orchestration_reconciliation_settlements_redriven_total",
  {
    description:
      "Total settlements re-driven by the PM runtime reconciliation sweep (never-consumed plus pending).",
  },
);

export const orchestrationPmReEntryDuration = Metric.timer("t3_orchestration_pm_reentry_duration", {
  description:
    "PM re-entry latency: time to enqueue a settlement and drain the PM project runtime turn.",
});

export const orchestrationBusyRetryAttemptsTotal = Metric.counter(
  "t3_orchestration_busy_retry_attempts_total",
  {
    description: "Total SQLite busy/locked write retries attempted by the persistence layer.",
  },
);

export const orchestrationBusyRetryExhaustionsTotal = Metric.counter(
  "t3_orchestration_busy_retry_exhaustions_total",
  {
    description:
      "Total SQLite busy/locked retries that exhausted their attempt budget while still busy.",
  },
);

export const orchestrationWorktreeReaperOrphansRemovedTotal = Metric.counter(
  "t3_orchestration_worktree_reaper_orphans_removed_total",
  {
    description: "Total task worktrees removed by the reaper, labeled by cleanup reason.",
  },
);

// Command-queue contention (WP-7)
//
// MEASUREMENT ONLY. These histograms observe the existing single-queue,
// serialized command dispatch in OrchestrationEngine — they do not change
// dispatch ordering or serialization. They exist to inform a FUTURE
// lane-split decision: if a single command class (e.g. high-frequency
// streaming writes) dominates queue depth / wait time, that data justifies
// splitting it onto its own lane. The `commandClass` attribute is attached
// via Metric.withAttributes at the dispatch site (see Attributes label rules).
//
// Boundaries are chosen for the two distributions we expect to be small in
// the common case but heavy-tailed under contention: queue depth (counts of
// in-flight envelopes) and queue wait (milliseconds an envelope sat enqueued
// before the serialized worker began processing it).

export const orchestrationCommandQueueDepth = Metric.histogram(
  "t3_orchestration_command_queue_depth",
  {
    description:
      "Command-queue depth (number of envelopes enqueued, including the one being dispatched) sampled when an envelope is offered to the serialized dispatch queue.",
    boundaries: [0, 1, 2, 4, 8, 16, 32, 64, 128, 256],
  },
);

export const orchestrationCommandQueueWaitDuration = Metric.histogram(
  "t3_orchestration_command_queue_wait_duration",
  {
    description:
      "Command-queue wait time in milliseconds: from when an envelope was enqueued to when the serialized worker began processing it.",
    boundaries: [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  },
);

// Subscription-quota handling (WP-Q7)
//
// Observability for the quota-exhaustion handling (WP-Q1..Q5): how many provider
// instances and worker stages are currently parked on subscription quota, how
// many blocked stages the reconciliation sweep has re-driven once their instance
// recovered, and how long stages sat blocked. The gauges are sampled once per
// reconciliation sweep (instantaneous "how much is parked right now"); the
// counter and timer are emitted as the sweep resumes blocked stages.

export const orchestrationQuotaBlockedInstances = Metric.gauge(
  "t3_orchestration_quota_blocked_instances",
  {
    description:
      "Provider instances currently marked quota-blocked, sampled once per PM reconciliation sweep.",
  },
);

export const orchestrationQuotaBlockedStages = Metric.gauge(
  "t3_orchestration_quota_blocked_stages",
  {
    description:
      "Worker stages currently parked on subscription quota, sampled once per PM reconciliation sweep.",
  },
);

export const orchestrationQuotaStageResumedTotal = Metric.counter(
  "t3_orchestration_quota_stage_resumed_total",
  {
    description:
      "Total quota-blocked worker stages re-driven by the reconciliation sweep after their provider instance recovered.",
  },
);

export const orchestrationQuotaResetClearedTotal = Metric.counter(
  "t3_orchestration_quota_reset_cleared_total",
  {
    description:
      "Total provider instances optimistically cleared to ok by the reconciliation sweep once their parsed quota reset time elapsed (WP-Q6 auto-resume-at-reset).",
  },
);

export const orchestrationQuotaBlockedDuration = Metric.timer(
  "t3_orchestration_quota_blocked_duration",
  {
    description:
      "Time a worker stage spent parked on subscription quota, from blockedAt to resume.",
  },
);

export const metricAttributes = (
  attributes: Readonly<Record<string, unknown>>,
): ReadonlyArray<[string, string]> => Object.entries(compactMetricAttributes(attributes));

export const setGauge = (
  metric: Metric.Metric<number, unknown>,
  value: number,
  attributes: Readonly<Record<string, unknown>> = {},
) => Metric.update(Metric.withAttributes(metric, metricAttributes(attributes)), value);

export const recordDuration = (
  metric: Metric.Metric<Duration.Duration, unknown>,
  duration: Duration.Duration,
  attributes: Readonly<Record<string, unknown>> = {},
) => Metric.update(Metric.withAttributes(metric, metricAttributes(attributes)), duration);

export const increment = (
  metric: Metric.Metric<number, unknown>,
  attributes: Readonly<Record<string, unknown>>,
  amount = 1,
) => Metric.update(Metric.withAttributes(metric, metricAttributes(attributes)), amount);

export interface WithMetricsOptions {
  readonly counter?: Metric.Metric<number, unknown>;
  readonly timer?: Metric.Metric<Duration.Duration, unknown>;
  readonly attributes?:
    | Readonly<Record<string, unknown>>
    | (() => Readonly<Record<string, unknown>>);
  readonly outcomeAttributes?: (
    outcome: ReturnType<typeof outcomeFromExit>,
  ) => Readonly<Record<string, unknown>>;
}

const withMetricsImpl = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: WithMetricsOptions,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeNanos;
    const exit = yield* Effect.exit(effect);
    const endedAt = yield* Clock.currentTimeNanos;
    const elapsedNanos = endedAt > startedAt ? endedAt - startedAt : 0n;
    const duration = Duration.nanos(elapsedNanos);
    const baseAttributes =
      typeof options.attributes === "function" ? options.attributes() : (options.attributes ?? {});

    if (options.timer) {
      yield* Metric.update(
        Metric.withAttributes(options.timer, metricAttributes(baseAttributes)),
        duration,
      );
    }

    if (options.counter) {
      const outcome = outcomeFromExit(exit);
      yield* Metric.update(
        Metric.withAttributes(
          options.counter,
          metricAttributes({
            ...baseAttributes,
            outcome,
            ...(options.outcomeAttributes ? options.outcomeAttributes(outcome) : {}),
          }),
        ),
        1,
      );
    }

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    return yield* Effect.failCause(exit.cause);
  });

export const withMetrics: {
  <A, E, R>(
    options: WithMetricsOptions,
  ): (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  <A, E, R>(effect: Effect.Effect<A, E, R>, options: WithMetricsOptions): Effect.Effect<A, E, R>;
} = dual(2, withMetricsImpl);

export const providerMetricAttributes = (
  provider: string,
  extra?: Readonly<Record<string, unknown>>,
) =>
  compactMetricAttributes({
    provider,
    ...extra,
  });

export const providerTurnMetricAttributes = (input: {
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly extra?: Readonly<Record<string, unknown>>;
}) => {
  const modelFamily = normalizeModelMetricLabel(input.model);
  return compactMetricAttributes({
    provider: input.provider,
    ...(modelFamily ? { modelFamily } : {}),
    ...input.extra,
  });
};
