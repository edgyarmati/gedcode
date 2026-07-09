/**
 * Pure, SDK-agnostic normalization of provider rate-limit telemetry into the
 * backend-neutral {@link AccountRateLimitsUpdatedPayload} contract, plus a
 * classifier that recognizes quota/rate-limit exhaustion in opaque runtime
 * errors.
 *
 * This is the single source of quota-classification logic: both provider
 * adapters (Codex, Claude) and the downstream per-instance quota projection
 * consume these helpers so the "is this instance out of quota?" decision is
 * made one way, in one place.
 *
 * Inputs are described with local structural interfaces (only the fields we
 * read) rather than the provider SDK types, so the functions stay decoupled
 * from any SDK and are trivially unit-testable with plain objects.
 */
import type {
  AccountRateLimitsUpdatedPayload,
  RateLimitStatus,
  RateLimitWindowSnapshot,
  RuntimeErrorClass,
} from "@t3tools/contracts";

/**
 * Utilization (percent of a window consumed) at or above which a not-yet-blocked
 * instance is reported as `warning`. Below the exhaustion line, but close enough
 * that operators/PM should expect a pause soon.
 */
export const RATE_LIMIT_WARNING_PERCENT = 95;

/**
 * Epoch values below this are interpreted as seconds, at/above as milliseconds.
 * Any real reset time expressed in seconds is ~1.7e9; the same instant in
 * milliseconds is ~1.7e12. A millisecond timestamp only drops below 1e12 before
 * year 2001, which no reset time will ever be — so the threshold disambiguates
 * the unit without guessing.
 */
const EPOCH_MS_THRESHOLD = 1e12;

/**
 * Normalize a backend reset timestamp to epoch milliseconds, tolerating both
 * seconds and milliseconds inputs. Returns undefined for missing/invalid values.
 */
export function normalizeEpochToMs(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value < EPOCH_MS_THRESHOLD ? Math.round(value * 1000) : Math.round(value);
}

/** True when an instance should pause new work because its quota is spent. */
export function isExhaustedRateLimitStatus(status: RateLimitStatus): boolean {
  return status === "exhausted";
}

function buildWindow(input: {
  label?: string | undefined;
  usedPercent?: number | null | undefined;
  resetsAt?: number | null | undefined;
  windowDurationMins?: number | null | undefined;
}): RateLimitWindowSnapshot | undefined {
  const label = input.label?.trim();
  const usedPercent =
    input.usedPercent === null || input.usedPercent === undefined ? undefined : input.usedPercent;
  const resetAtEpochMs = normalizeEpochToMs(input.resetsAt);
  const windowDurationMins =
    input.windowDurationMins === null || input.windowDurationMins === undefined
      ? undefined
      : input.windowDurationMins;

  if (
    label === undefined &&
    usedPercent === undefined &&
    resetAtEpochMs === undefined &&
    windowDurationMins === undefined
  ) {
    return undefined;
  }

  return {
    ...(label !== undefined && label.length > 0 ? { label } : {}),
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(resetAtEpochMs !== undefined ? { resetAtEpochMs } : {}),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
  };
}

/**
 * Pick the single reset time most relevant to the binding constraint: the reset
 * of the most-utilized window (ties broken by the soonest reset), falling back
 * to the soonest reset across all windows. This is the value WP-Q6 would schedule
 * an auto-resume on.
 */
function bindingResetAtEpochMs(
  windows: ReadonlyArray<RateLimitWindowSnapshot>,
): number | undefined {
  let binding: { usedPercent: number; resetAtEpochMs: number } | undefined;
  let soonest: number | undefined;
  for (const window of windows) {
    if (window.resetAtEpochMs === undefined) {
      continue;
    }
    if (soonest === undefined || window.resetAtEpochMs < soonest) {
      soonest = window.resetAtEpochMs;
    }
    const usedPercent = window.usedPercent ?? 0;
    if (
      binding === undefined ||
      usedPercent > binding.usedPercent ||
      (usedPercent === binding.usedPercent && window.resetAtEpochMs < binding.resetAtEpochMs)
    ) {
      binding = { usedPercent, resetAtEpochMs: window.resetAtEpochMs };
    }
  }
  return binding?.resetAtEpochMs ?? soonest;
}

function statusFromMaxUsedPercent(maxUsedPercent: number | undefined): RateLimitStatus {
  if (maxUsedPercent === undefined) {
    return "unknown";
  }
  if (maxUsedPercent >= 100) {
    return "exhausted";
  }
  if (maxUsedPercent >= RATE_LIMIT_WARNING_PERCENT) {
    return "warning";
  }
  return "ok";
}

function assemblePayload(
  status: RateLimitStatus,
  windows: ReadonlyArray<RateLimitWindowSnapshot>,
  raw: unknown,
): AccountRateLimitsUpdatedPayload {
  const resetAtEpochMs = status === "ok" ? undefined : bindingResetAtEpochMs(windows);
  return {
    status,
    ...(resetAtEpochMs !== undefined ? { resetAtEpochMs } : {}),
    ...(windows.length > 0 ? { windows } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };
}

// --- Codex (V2AccountRateLimitsUpdatedNotification.rateLimits) ----------------

interface CodexRateLimitWindowLike {
  readonly usedPercent?: number | null;
  readonly resetsAt?: number | null;
  readonly windowDurationMins?: number | null;
}

interface CodexSpendControlLimitLike {
  readonly remainingPercent?: number | null;
  readonly resetsAt?: number | null;
}

export interface CodexRateLimitSnapshotLike {
  readonly primary?: CodexRateLimitWindowLike | null;
  readonly secondary?: CodexRateLimitWindowLike | null;
  readonly individualLimit?: CodexSpendControlLimitLike | null;
  readonly rateLimitReachedType?: string | null;
}

export function mapCodexRateLimits(
  snapshot: CodexRateLimitSnapshotLike,
  raw: unknown,
): AccountRateLimitsUpdatedPayload {
  const windows: RateLimitWindowSnapshot[] = [];

  const primary = snapshot.primary
    ? buildWindow({ label: "primary", ...snapshot.primary })
    : undefined;
  if (primary) {
    windows.push(primary);
  }

  const secondary = snapshot.secondary
    ? buildWindow({ label: "secondary", ...snapshot.secondary })
    : undefined;
  if (secondary) {
    windows.push(secondary);
  }

  if (snapshot.individualLimit) {
    const remainingPercent = snapshot.individualLimit.remainingPercent;
    const individual = buildWindow({
      label: "individual",
      usedPercent:
        remainingPercent === null || remainingPercent === undefined
          ? undefined
          : 100 - remainingPercent,
      resetsAt: snapshot.individualLimit.resetsAt,
    });
    if (individual) {
      windows.push(individual);
    }
  }

  // A reached/depleted type is the authoritative exhaustion signal. Otherwise
  // derive from the highest window utilization.
  const reached =
    typeof snapshot.rateLimitReachedType === "string" &&
    snapshot.rateLimitReachedType.trim().length > 0;
  const usedPercents = windows
    .map((window) => window.usedPercent)
    .filter((value): value is number => value !== undefined);
  const maxUsedPercent = usedPercents.length > 0 ? Math.max(...usedPercents) : undefined;
  const status: RateLimitStatus = reached ? "exhausted" : statusFromMaxUsedPercent(maxUsedPercent);

  return assemblePayload(status, windows, raw);
}

// --- Claude (SDKRateLimitEvent.rate_limit_info) -------------------------------

type ClaudeRateLimitStatus = "allowed" | "allowed_warning" | "rejected" | (string & {});

export interface ClaudeRateLimitInfoLike {
  readonly status: ClaudeRateLimitStatus;
  readonly resetsAt?: number;
  readonly rateLimitType?: string;
  readonly utilization?: number;
  readonly overageStatus?: ClaudeRateLimitStatus;
  readonly overageResetsAt?: number;
  readonly isUsingOverage?: boolean;
}

function statusFromClaudeStatus(status: ClaudeRateLimitStatus): RateLimitStatus {
  switch (status) {
    case "allowed":
      return "ok";
    case "allowed_warning":
      return "warning";
    case "rejected":
      return "exhausted";
    default:
      return "unknown";
  }
}

export function mapClaudeRateLimits(
  info: ClaudeRateLimitInfoLike,
  raw: unknown,
): AccountRateLimitsUpdatedPayload {
  const windows: RateLimitWindowSnapshot[] = [];

  const primary = buildWindow({
    label: info.rateLimitType ?? "primary",
    usedPercent: info.utilization,
    resetsAt: info.resetsAt,
  });
  if (primary) {
    windows.push(primary);
  }

  const hasOverage =
    info.overageStatus !== undefined ||
    info.overageResetsAt !== undefined ||
    info.isUsingOverage === true;
  if (hasOverage) {
    const overage = buildWindow({ label: "overage", resetsAt: info.overageResetsAt });
    if (overage) {
      windows.push(overage);
    }
  }

  // The active constraint is the overage limit only while it is in use.
  const effectiveStatus =
    info.isUsingOverage === true && info.overageStatus !== undefined
      ? info.overageStatus
      : info.status;
  const status = statusFromClaudeStatus(effectiveStatus);

  return assemblePayload(status, windows, raw);
}

// --- Reactive failure classification -----------------------------------------

const RATE_LIMIT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /rate[\s_-]?limit/i,
  /\bquota\b/i,
  /usage limit/i,
  /too many requests/i,
  /\b429\b/,
  /resource[\s_]?exhausted/i,
  /insufficient[\s_]?quota/i,
];

/**
 * Best-effort classification of an opaque runtime error. Returns "rate_limit"
 * when the message matches a known quota/rate-limit pattern, otherwise the
 * provided fallback (default "provider_error"). Conservative by design — it only
 * ever upgrades a classification, never discards information.
 */
export function classifyRuntimeErrorClass(input: {
  message: string;
  fallback?: RuntimeErrorClass;
}): RuntimeErrorClass {
  const fallback = input.fallback ?? "provider_error";
  const message = input.message ?? "";
  for (const pattern of RATE_LIMIT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return "rate_limit";
    }
  }
  return fallback;
}
