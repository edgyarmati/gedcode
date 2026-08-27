#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off

import { spawnSync } from "node:child_process";

export interface AuditFinding {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly severity: string;
}

export type AuditReport = Readonly<Record<string, ReadonlyArray<AuditFinding>>>;

const buildOnlyExceptions: Readonly<Record<string, ReadonlySet<string>>> = {
  // Electron uses extract-zip only while its npm install script obtains the Electron binary. The
  // module is not bundled into GedCode's packaged application, and no fixed 2.x release exists.
  "extract-zip": new Set(["https://github.com/advisories/GHSA-jmr9-qjv8-65gv"]),
};

export interface ClassifiedAudit {
  readonly blocking: ReadonlyArray<{
    readonly packageName: string;
    readonly finding: AuditFinding;
  }>;
  readonly residual: ReadonlyArray<{
    readonly packageName: string;
    readonly finding: AuditFinding;
  }>;
}

export function classifyProductionAudit(report: AuditReport): ClassifiedAudit {
  const blocking: Array<{ readonly packageName: string; readonly finding: AuditFinding }> = [];
  const residual: Array<{ readonly packageName: string; readonly finding: AuditFinding }> = [];

  for (const [packageName, findings] of Object.entries(report)) {
    for (const finding of findings) {
      const severity = finding.severity.toLowerCase();
      const isHighSeverity = severity === "high" || severity === "critical";
      const isDocumentedBuildOnly = buildOnlyExceptions[packageName]?.has(finding.url) === true;
      (isHighSeverity && !isDocumentedBuildOnly ? blocking : residual).push({
        packageName,
        finding,
      });
    }
  }

  return { blocking, residual };
}

export function formatAuditFindings(label: string, findings: ClassifiedAudit["blocking"]): string {
  if (findings.length === 0) return `${label}: none`;
  return [
    `${label}:`,
    ...findings.map(
      ({ packageName, finding }) =>
        `- ${finding.severity.toUpperCase()} ${packageName}: ${finding.title} (${finding.url})`,
    ),
  ].join("\n");
}

export function parseAuditCommandResult(
  stdout: string,
  stderr: string,
  status: number | null,
): AuditReport {
  let report: AuditReport;
  try {
    report = JSON.parse(stdout || "{}") as AuditReport;
  } catch (cause) {
    throw new Error(`Could not parse bun audit JSON: ${String(cause)}\n${stdout}`, { cause });
  }

  if (status !== 0 && status !== 1) {
    throw new Error(`bun audit failed with status ${String(status)}: ${stderr.trim() || stdout}`);
  }
  if (status === 1 && Object.keys(report).length === 0) {
    throw new Error(`bun audit failed without an advisory report: ${stderr.trim() || stdout}`);
  }
  return report;
}

export function runProductionAudit(): ClassifiedAudit {
  const result = spawnSync("bun", ["audit", "--production", "--json"], { encoding: "utf8" });
  if (result.error) throw result.error;
  const report = parseAuditCommandResult(result.stdout, result.stderr, result.status);
  const classified = classifyProductionAudit(report);
  console.log(formatAuditFindings("Documented non-blocking audit findings", classified.residual));
  if (classified.blocking.length > 0) {
    throw new Error(
      `${formatAuditFindings("Release-blocking production dependency findings", classified.blocking)}\n` +
        "Resolve or explicitly classify these findings before publishing a release.",
    );
  }
  return classified;
}

if (import.meta.main) {
  runProductionAudit();
}
