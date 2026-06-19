/**
 * SQLite write resilience for the persistence layer (Plan 019 WP-1).
 *
 * SQLite serializes writers: a second connection that cannot immediately take
 * the write lock fails with `SQLITE_BUSY` / `SQLITE_LOCKED`. `PRAGMA
 * busy_timeout` (set in `Layers/Sqlite.ts`) makes SQLite *block* for a bounded
 * window before surfacing that error; this module is the second line of
 * defense — a jittered, bounded retry around a write transaction for the
 * residual cases (busy_timeout exhausted, a WAL checkpoint race, or a
 * `SQLITE_LOCKED` shared-cache conflict).
 *
 * **Why only busy/locked.** Retrying any other failure is unsafe: a constraint
 * violation, syntax error, or logic error is not transient, and re-running a
 * partially-applied non-idempotent statement could corrupt state. The retry is
 * therefore gated *strictly* on `SQLITE_BUSY` (primary result code 5) and
 * `SQLITE_LOCKED` (6), and on nothing else. We deliberately do **not** trust the
 * broader `SqlError.isRetryable` getter (it is also `true` for
 * connection/deadlock/serialization/statement-timeout reasons that SQLite does
 * not raise here).
 *
 * **Why we can't gate on `LockTimeoutError` alone.** Effect's
 * `classifySqliteError` maps busy/locked to a {@link LockTimeoutError} reason
 * only when it can read the primary result code from `cause.code` (string
 * `"SQLITE_BUSY"`) or `cause.errno`/`cause.code` (numeric). The Node `node:sqlite`
 * driver this server ships on reports the primary code on **`cause.errcode`**
 * instead (e.g. `{ code: "ERR_SQLITE_ERROR", errcode: 5, errstr: "database is
 * locked" }`), which the classifier never inspects — so a *real* busy/locked
 * surfaces as an `UnknownError`, not a `LockTimeoutError`. Gating on the reason
 * tag alone would therefore make the entire retry silently dead in production
 * while every synthetic test (which hand-builds a `LockTimeoutError`) stayed
 * green. {@link isRetryableSqlError} closes that gap by also narrowing the raw
 * `errcode` off the reason's `cause` — see {@link isNodeSqliteBusyOrLocked}.
 *
 * **Why retrying a transaction is safe.** `sql.withTransaction` rolls the whole
 * transaction back on failure, so a retry re-runs the body against the
 * pre-transaction state — the unit of work stays atomic and idempotent. Always
 * wrap the *entire* `sql.withTransaction(...)` effect (before the error is
 * mapped to a {@link PersistenceSqlError}, so the raw `SqlError.reason` is still
 * inspectable), never a fragment of it.
 *
 * @module persistence/retryPolicy
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { isSqlError } from "effect/unstable/sql/SqlError";

/**
 * Tunables for SQLite write resilience. `busyTimeoutMs` is the in-SQLite block
 * window (`PRAGMA busy_timeout`); the remaining fields shape the jittered
 * application-level retry that backstops it.
 */
export interface PersistenceRetryPolicy {
  /** `PRAGMA busy_timeout` window, in milliseconds. */
  readonly busyTimeoutMs: number;
  /** First backoff delay before the exponential growth (per retry). */
  readonly initialBackoffMs: number;
  /** Upper bound each backoff delay is capped to. */
  readonly maxBackoffMs: number;
  /** Total executions, including the first attempt (so `1` disables retry). */
  readonly maxAttempts: number;
}

export const DEFAULT_PERSISTENCE_RETRY_POLICY: PersistenceRetryPolicy = {
  busyTimeoutMs: 5000,
  initialBackoffMs: 50,
  maxBackoffMs: 1000,
  maxAttempts: 4,
};

/** SQLite primary result code for `SQLITE_BUSY`. */
const SQLITE_BUSY = 5;
/** SQLite primary result code for `SQLITE_LOCKED`. */
const SQLITE_LOCKED = 6;

/**
 * `true` when `cause` is a raw `node:sqlite` error reporting `SQLITE_BUSY` /
 * `SQLITE_LOCKED` on its `errcode` field. `node:sqlite` surfaces the SQLite
 * primary result code there (e.g. `{ code: "ERR_SQLITE_ERROR", errcode: 5,
 * errstr: "database is locked" }`), which Effect's `classifySqliteError` does
 * not read — so this is how a real busy/locked error is recovered after it has
 * been classified as an `UnknownError`. Narrows `unknown` without trusting the
 * shape: a missing or non-numeric `errcode` yields `false`.
 */
const isNodeSqliteBusyOrLocked = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null || !("errcode" in cause)) {
    return false;
  }
  const { errcode } = cause as { readonly errcode: unknown };
  return errcode === SQLITE_BUSY || errcode === SQLITE_LOCKED;
};

/**
 * `true` only when `error` is a `SqlError` caused by `SQLITE_BUSY` /
 * `SQLITE_LOCKED` — either because Effect classified it as a
 * {@link LockTimeoutError}, or because the raw `node:sqlite` cause carries an
 * `errcode` of 5/6 that the classifier missed (see {@link isNodeSqliteBusyOrLocked}).
 * Everything else — a `SqlError` already mapped to `PersistenceSqlError`, a
 * unique/constraint violation, a syntax error, or any non-SQL failure — is
 * treated as non-retryable.
 */
export const isRetryableSqlError = (error: unknown): boolean =>
  isSqlError(error) &&
  (error.reason._tag === "LockTimeoutError" || isNodeSqliteBusyOrLocked(error.reason.cause));

/**
 * Wrap a write transaction with a jittered, bounded retry that fires *only* on
 * `SQLITE_BUSY` / `SQLITE_LOCKED`. The backoff grows exponentially from
 * `initialBackoffMs`, is capped at `maxBackoffMs` (via `either`, which takes the
 * minimum of the two delays), jittered to avoid thundering-herd alignment, and
 * bounded to `maxAttempts` total executions. Non-busy errors short-circuit on
 * the first failure.
 */
export const retryOnBusy = (policy: PersistenceRetryPolicy) => {
  // The recurrence bound lives *inside* the schedule via `both`+`recurs` (an
  // intersection that stops as soon as `recurs` is exhausted). A free-standing
  // `times` option does not bound a provided `schedule`, so an unbounded
  // `either(exponential, spaced)` would otherwise retry a persistently-busy
  // write forever.
  const schedule = Schedule.exponential(Duration.millis(policy.initialBackoffMs), 2).pipe(
    // Cap each backoff at `maxBackoffMs` — `either` takes the minimum delay.
    Schedule.either(Schedule.spaced(Duration.millis(policy.maxBackoffMs))),
    Schedule.jittered,
    // Bound to `maxAttempts` total executions (one initial + `maxAttempts - 1` retries).
    Schedule.both(Schedule.recurs(Math.max(0, policy.maxAttempts - 1))),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.retry(effect, {
      schedule,
      while: isRetryableSqlError,
    });
};

/**
 * The resolved {@link PersistenceRetryPolicy} for the running process. Provided
 * alongside the SQLite client by the persistence layer, so every repository
 * that opens a write transaction can read one consistent policy.
 */
export class PersistenceRetryPolicyService extends Context.Service<
  PersistenceRetryPolicyService,
  PersistenceRetryPolicy
>()("gedcode/persistence/retryPolicy/PersistenceRetryPolicyService") {
  /** Safe-by-default policy for tests and the in-memory persistence layer. */
  static readonly Default: Layer.Layer<PersistenceRetryPolicyService> = Layer.succeed(
    PersistenceRetryPolicyService,
    DEFAULT_PERSISTENCE_RETRY_POLICY,
  );

  /** Provide an explicit policy (the live layer derives this from `ServerConfig`). */
  static readonly layer = (
    policy: PersistenceRetryPolicy,
  ): Layer.Layer<PersistenceRetryPolicyService> =>
    Layer.succeed(PersistenceRetryPolicyService, policy);
}

/**
 * Context-aware {@link retryOnBusy}: resolves the active
 * {@link PersistenceRetryPolicyService} from the environment — falling back to
 * {@link DEFAULT_PERSISTENCE_RETRY_POLICY} when it is not provided — and applies
 * the busy/locked retry to `effect`.
 *
 * Reading the policy via `serviceOption` deliberately keeps it *out* of the
 * effect's requirement (`R`) channel: a write site can adopt the retry without
 * forcing every layer that constructs it to provide the policy. The persistence
 * layer (`Layers/Sqlite.ts`) provides the service alongside the SQL client, so
 * in practice the configured policy is always used; the default is only a
 * safety net for ad-hoc layers that build a client without it.
 *
 * Wrap the *entire* `sql.withTransaction(...)` effect with this (before any
 * `Effect.mapError`/`Effect.catchTag` maps the raw `SqlError` away), so the
 * retry can still inspect `SqlError.reason`.
 */
export const withBusyRetry = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.serviceOption(PersistenceRetryPolicyService).pipe(
    Effect.flatMap((maybePolicy) =>
      retryOnBusy(Option.getOrElse(maybePolicy, () => DEFAULT_PERSISTENCE_RETRY_POLICY))(effect),
    ),
  );
