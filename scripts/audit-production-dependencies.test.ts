// @effect-diagnostics nodeBuiltinImport:off

import { describe, expect, it } from "vitest";

import {
  classifyProductionAudit,
  formatAuditFindings,
  parseAuditCommandResult,
  type AuditReport,
} from "./audit-production-dependencies.ts";

const finding = (severity: string, url: string) => ({
  id: 1,
  url,
  severity,
  title: "Example advisory",
});

describe("production dependency audit policy", () => {
  it("blocks unresolved high and critical findings", () => {
    const report: AuditReport = {
      runtime: [finding("high", "https://github.com/advisories/GHSA-runtime")],
      dangerous: [finding("critical", "https://github.com/advisories/GHSA-critical")],
    };
    expect(classifyProductionAudit(report).blocking).toHaveLength(2);
  });

  it("reports medium and low findings without blocking a release", () => {
    const classified = classifyProductionAudit({
      dependency: [
        finding("moderate", "https://github.com/advisories/GHSA-moderate"),
        finding("low", "https://github.com/advisories/GHSA-low"),
      ],
    });
    expect(classified.blocking).toEqual([]);
    expect(classified.residual).toHaveLength(2);
  });

  it("allows only the documented extract-zip install-time advisory", () => {
    const classified = classifyProductionAudit({
      "extract-zip": [
        finding("high", "https://github.com/advisories/GHSA-jmr9-qjv8-65gv"),
        finding("high", "https://github.com/advisories/GHSA-new-extract-zip"),
      ],
    });
    expect(classified.residual).toHaveLength(1);
    expect(classified.blocking).toHaveLength(1);
  });

  it("allows only the documented dev-only path-to-regexp advisory", () => {
    const classified = classifyProductionAudit({
      "path-to-regexp": [
        finding("high", "https://github.com/advisories/GHSA-9wv6-86v2-598j"),
        finding("high", "https://github.com/advisories/GHSA-new-path-to-regexp"),
      ],
    });
    expect(classified.residual).toHaveLength(1);
    expect(classified.blocking).toHaveLength(1);
  });

  it("renders package, severity, title, and advisory URL", () => {
    const [entry] = classifyProductionAudit({
      dependency: [finding("moderate", "https://github.com/advisories/GHSA-moderate")],
    }).residual;
    expect(formatAuditFindings("Residual", entry ? [entry] : [])).toContain(
      "MODERATE dependency: Example advisory",
    );
  });

  it("fails closed when the audit command errors without a usable report", () => {
    expect(() => parseAuditCommandResult("", "registry unavailable", 2)).toThrow(
      "bun audit failed with status 2",
    );
    expect(() => parseAuditCommandResult("{}", "audit failed", 1)).toThrow(
      "failed without an advisory report",
    );
  });
});
