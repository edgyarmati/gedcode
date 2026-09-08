import { createHash } from "node:crypto";

import type { OrchestrationCommand } from "@t3tools/contracts";

import { OrchestrationCommandFingerprint } from "../persistence/Services/OrchestrationCommandReceipts.ts";

const canonicalJson = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => (entry === undefined ? "null" : canonicalJson(entry)))
      .join(",")}]`;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .toSorted()
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`Unsupported command fingerprint value: ${typeof value}`);
  }
};

/** Receipt identity and arrival time are dispatch metadata, not caller intent. */
const semanticCommandContent = (command: OrchestrationCommand): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(command).filter(([key]) => key !== "commandId" && key !== "createdAt"),
  );

export const fingerprintOrchestrationCommand = (
  command: OrchestrationCommand,
): OrchestrationCommandFingerprint =>
  OrchestrationCommandFingerprint.make(
    `sha256:${createHash("sha256")
      .update(canonicalJson(semanticCommandContent(command)), "utf8")
      .digest("hex")}`,
  );
