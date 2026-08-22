/**
 * StreamSupervision - restart-on-exit supervision for long-lived stream
 * consumption fibers.
 *
 * Subscription fibers that die on a failure or defect silently wedge the
 * pipelines they feed. Wrap the consumption effect in `superviseForever`
 * before forking it so a crashed consumer is restarted with backoff and each
 * restart is logged under a stable site name.
 *
 * @module StreamSupervision
 */
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

const defaultInitialBackoff = Duration.millis(500);
const defaultMaxBackoff = Duration.seconds(30);
const defaultBackoffFactor = 2;

export interface SuperviseForeverOptions {
  /**
   * Stable, human-readable name of the consumption site. Included in every
   * restart log so restart state stays observable.
   */
  readonly site: string;
  /** Delay before the first restart. Defaults to 500ms. */
  readonly initialBackoff?: Duration.Input | undefined;
  /** Multiplier applied to each consecutive restart delay. Defaults to 2. */
  readonly backoffFactor?: number | undefined;
  /** Upper bound for a single restart delay. Defaults to 30 seconds. */
  readonly maxBackoff?: Duration.Input | undefined;
  /**
   * Also restart when the supervised effect completes successfully (for
   * example when an upstream stream ends). Defaults to false so streams that
   * legitimately terminate — such as a removed provider instance's event
   * source — are not spun on forever.
   */
  readonly restartOnSuccess?: boolean | undefined;
}

/**
 * Run `worker` forever, restarting it with exponential backoff whenever it
 * exits with a failure or defect — and, when `restartOnSuccess` is set,
 * whenever it completes (e.g. its stream ended).
 *
 * Interruption is never restarted: it means the enclosing scope is closing or
 * the supervisor was cancelled deliberately. A run that stayed healthy longer
 * than `maxBackoff` resets the backoff series, so long-lived consumers do not
 * accumulate restart delay across unrelated failures.
 *
 * Every restart logs a warning tagged with `site`.
 *
 * @example
 * yield* Effect.forkScoped(
 *   superviseForever(
 *     { site: "Ingestion.runtimeEvents", restartOnSuccess: true },
 *     Stream.runForEach(source.streamEvents, (event) => worker.enqueue(event)),
 *   ),
 * );
 */
export const superviseForever = <A, E, R>(
  options: SuperviseForeverOptions,
  worker: Effect.Effect<A, E, R>,
): Effect.Effect<never, never, R> => {
  const initialBackoffMillis = Duration.toMillis(options.initialBackoff ?? defaultInitialBackoff);
  const maxBackoffMillis = Duration.toMillis(options.maxBackoff ?? defaultMaxBackoff);
  const backoffFactor = options.backoffFactor ?? defaultBackoffFactor;
  const loop: Effect.Effect<never, never, R> = Effect.gen(function* () {
    let consecutiveRestarts = 0;
    while (true) {
      const startedAtMillis = yield* Clock.currentTimeMillis;
      const outcome = yield* Effect.exit(worker);
      const shouldRestart = Exit.isSuccess(outcome)
        ? options.restartOnSuccess === true
        : !Cause.hasInterruptsOnly(outcome.cause);
      if (!shouldRestart) {
        return yield* Effect.interrupt;
      }
      const ranForMillis = (yield* Clock.currentTimeMillis) - startedAtMillis;
      if (ranForMillis > maxBackoffMillis) {
        consecutiveRestarts = 0;
      }
      const backoffMillis = Math.min(
        initialBackoffMillis * backoffFactor ** consecutiveRestarts,
        maxBackoffMillis,
      );
      consecutiveRestarts += 1;
      yield* Effect.logWarning("Supervised consumption site exited; restarting", {
        site: options.site,
        restartAttempt: consecutiveRestarts,
        restartBackoffMs: backoffMillis,
        exit: Exit.isSuccess(outcome) ? "completed" : Cause.pretty(outcome.cause),
      });
      yield* Effect.sleep(Duration.millis(backoffMillis));
    }
  });
  return loop;
};
