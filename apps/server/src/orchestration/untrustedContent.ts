/**
 * untrustedContent - shared scrub + bound primitive for PM re-entry content.
 *
 * Worker output (assistant text and captured diffs) and free-form human/client
 * fields are interpolated into PM prompts. Before any such content reaches the
 * PM, it MUST pass through this single scrub + length-bound implementation so
 * there is exactly one place that defines secret redaction and the size cap.
 *
 * This module is pure (no IO). Both `StageResultBuilder` and `PmRuntime` import
 * the helpers here rather than duplicating the regex/cap.
 *
 * @module untrustedContent
 */

/**
 * Maximum number of characters of untrusted content that may reach the PM
 * prompt per bounded field. Applied per-field (assistant text, diff text) and,
 * for the assembled stage-result envelope, once more to the whole serialized
 * message (see `StageResultBuilder.serializeStageResultToMessage`).
 */
export const MAX_PM_REENTRY_CONTENT_CHARS = 12_000;

/**
 * Marker appended when `boundUntrustedContent` truncates over-long content.
 */
export const TRUNCATION_MARKER = "\n[truncated]";

/**
 * Redact obvious secrets by key name. Matches keys whose name contains
 * `api[_-]?key`, `token`, `secret`, or `password` and replaces the value with
 * `[REDACTED]`. This is intentionally name-based: broader DSN scrubbing (e.g.
 * `DATABASE_URL`) is out of scope and would require a deliberate change here so
 * every call site stays in sync.
 */
export const scrubSecrets = (text: string): string =>
  text.replace(
    /\b([a-z0-9_]*(?:api[_-]?key|token|secret|password)[a-z0-9_]*)\b\s*[:=]\s*["']?[^\s"']+["']?/gi,
    "$1=[REDACTED]",
  );

/**
 * Scrub secrets then cap length at `MAX_PM_REENTRY_CONTENT_CHARS`, appending the
 * truncation marker when the scrubbed content exceeds the cap.
 */
export const boundUntrustedContent = (text: string): string => {
  const scrubbed = scrubSecrets(text);
  if (scrubbed.length <= MAX_PM_REENTRY_CONTENT_CHARS) {
    return scrubbed;
  }
  return `${scrubbed.slice(0, MAX_PM_REENTRY_CONTENT_CHARS)}${TRUNCATION_MARKER}`;
};
