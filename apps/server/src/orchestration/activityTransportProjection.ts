import type { OrchestrationEvent, OrchestrationThreadActivity } from "@t3tools/contracts";

export const ORCHESTRATION_ACTIVITY_TRANSPORT_PAYLOAD_LIMIT_BYTES = 32 * 1024;

const MAX_TEXT_PREVIEW_BYTES = 256;
const MAX_IDENTIFIER_FIELDS = 8;
const MAX_PATH_VALUES = 12;
const encoder = new TextEncoder();

const byteLength = (value: unknown): number =>
  encoder.encode(JSON.stringify(value) ?? "null").byteLength;

function truncateUtf8(value: string, limit: number): string {
  if (encoder.encode(value).byteLength <= limit) {
    return value;
  }
  let output = "";
  for (const character of value) {
    if (encoder.encode(output + character + "…").byteLength > limit) {
      break;
    }
    output += character;
  }
  return `${output}…`;
}

function copyScalar(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    target[key] = value;
  } else if (typeof value === "string") {
    target[key] = truncateUtf8(value, MAX_TEXT_PREVIEW_BYTES);
  }
}

function copyIdentifiers(source: Record<string, unknown>): Record<string, unknown> {
  const identifiers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (
      Object.keys(identifiers).length >= MAX_IDENTIFIER_FIELDS ||
      key.length > 128 ||
      !/(?:id|ids)$/iu.test(key)
    ) {
      continue;
    }
    if (typeof value === "string") {
      identifiers[key] = truncateUtf8(value, MAX_TEXT_PREVIEW_BYTES);
    } else if (Array.isArray(value)) {
      identifiers[key] = value
        .filter((entry): entry is string => typeof entry === "string")
        .slice(0, MAX_PATH_VALUES)
        .map((entry) => truncateUtf8(entry, MAX_TEXT_PREVIEW_BYTES));
    }
  }
  return identifiers;
}

function collectPathLikeValues(value: unknown, output: Array<string>): void {
  if (output.length >= MAX_PATH_VALUES || typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (output.length >= MAX_PATH_VALUES) {
      return;
    }
    if (typeof entry === "string" && /(?:path|file|cwd|directory|folder)/iu.test(key)) {
      output.push(truncateUtf8(entry, MAX_TEXT_PREVIEW_BYTES));
    } else if (Array.isArray(entry) && /(?:paths|files)/iu.test(key)) {
      for (const path of entry) {
        if (typeof path === "string" && output.length < MAX_PATH_VALUES) {
          output.push(truncateUtf8(path, MAX_TEXT_PREVIEW_BYTES));
        }
      }
    } else {
      collectPathLikeValues(entry, output);
    }
  }
}

function projectRawOutput(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return {
      summary: truncateUtf8(value, MAX_TEXT_PREVIEW_BYTES),
      truncated: encoder.encode(value).byteLength > MAX_TEXT_PREVIEW_BYTES,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ["totalFiles", "truncated", "status", "kind"]) {
    copyScalar(source, output, key);
  }
  const text =
    typeof source.content === "string"
      ? source.content
      : typeof source.stdout === "string"
        ? source.stdout
        : typeof source.output === "string"
          ? source.output
          : undefined;
  if (text !== undefined) {
    output.summary = truncateUtf8(text, MAX_TEXT_PREVIEW_BYTES);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function projectActivityPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {
      summary:
        typeof payload === "string"
          ? truncateUtf8(payload, MAX_TEXT_PREVIEW_BYTES)
          : String(payload),
    };
  }

  const source = payload as Record<string, unknown>;
  const preview: Record<string, unknown> = {};
  for (const key of [
    "status",
    "itemId",
    "itemType",
    "toolCallId",
    "toolName",
    "name",
    "title",
    "kind",
    "requestId",
    "requestType",
    "command",
    "path",
    "taskId",
    "providerInstanceId",
    "resetAt",
    "detail",
    "summary",
  ]) {
    copyScalar(source, preview, key);
  }
  Object.assign(preview, copyIdentifiers(source));

  if (typeof source.input === "object" && source.input !== null && !Array.isArray(source.input)) {
    const input = source.input as Record<string, unknown>;
    preview.input = {
      ...copyIdentifiers(input),
      ...(typeof input.taskId === "string"
        ? { taskId: truncateUtf8(input.taskId, MAX_TEXT_PREVIEW_BYTES) }
        : {}),
    };
  }

  if (typeof source.data === "object" && source.data !== null && !Array.isArray(source.data)) {
    const data = source.data as Record<string, unknown>;
    const projectedData: Record<string, unknown> = {
      ...copyIdentifiers(data),
    };
    for (const key of ["command", "toolCallId", "kind"]) {
      copyScalar(data, projectedData, key);
    }
    const paths: Array<string> = [];
    collectPathLikeValues(data, paths);
    if (paths.length > 0) {
      projectedData.paths = paths;
    }
    const rawOutput = projectRawOutput(data.rawOutput);
    if (rawOutput !== undefined) {
      projectedData.rawOutput = rawOutput;
    }
    preview.data = projectedData;
  }

  const rawOutput = projectRawOutput(source.rawOutput ?? source.output);
  if (rawOutput !== undefined) {
    preview.rawOutput = rawOutput;
  }
  return preview;
}

export function projectActivityForWebSocket(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const originalBytes = byteLength(activity.payload);
  if (originalBytes <= ORCHESTRATION_ACTIVITY_TRANSPORT_PAYLOAD_LIMIT_BYTES) {
    return activity;
  }

  const payload = projectActivityPayload(activity.payload);
  const retainedBytes = byteLength(payload);
  return {
    ...activity,
    payload,
    transportTruncation: {
      truncated: true,
      originalBytes,
      retainedBytes,
    },
  };
}

export function projectActivityEventForWebSocket(event: OrchestrationEvent): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }
  const activity = projectActivityForWebSocket(event.payload.activity);
  if (activity === event.payload.activity) {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      activity,
    },
  };
}
