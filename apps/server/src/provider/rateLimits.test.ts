import { describe, expect, it } from "vitest";

import {
  classifyRuntimeErrorClass,
  isExhaustedRateLimitStatus,
  mapClaudeRateLimits,
  mapCodexRateLimits,
  normalizeEpochToMs,
} from "./rateLimits.ts";

describe("normalizeEpochToMs", () => {
  it("scales second-granularity epochs to milliseconds", () => {
    // 2026-06-21T00:00:00Z in seconds.
    expect(normalizeEpochToMs(1_781_308_800)).toBe(1_781_308_800_000);
  });

  it("passes millisecond-granularity epochs through unchanged", () => {
    expect(normalizeEpochToMs(1_781_308_800_000)).toBe(1_781_308_800_000);
  });

  it("returns undefined for missing or non-positive values", () => {
    expect(normalizeEpochToMs(undefined)).toBeUndefined();
    expect(normalizeEpochToMs(null)).toBeUndefined();
    expect(normalizeEpochToMs(0)).toBeUndefined();
    expect(normalizeEpochToMs(-5)).toBeUndefined();
    expect(normalizeEpochToMs(Number.NaN)).toBeUndefined();
  });
});

describe("mapCodexRateLimits", () => {
  it("reports exhausted when a rateLimitReachedType is present", () => {
    const raw = { rateLimitReachedType: "rate_limit_reached", primary: { usedPercent: 10 } };
    const result = mapCodexRateLimits(
      {
        rateLimitReachedType: "rate_limit_reached",
        primary: { usedPercent: 10, resetsAt: 1_781_308_800 },
      },
      raw,
    );
    expect(result.status).toBe("exhausted");
    expect(result.resetAtEpochMs).toBe(1_781_308_800_000);
    expect(result.windows).toEqual([
      { label: "primary", usedPercent: 10, resetAtEpochMs: 1_781_308_800_000 },
    ]);
    expect(result.raw).toBe(raw);
  });

  it("reports exhausted when a window is fully consumed", () => {
    const result = mapCodexRateLimits(
      { primary: { usedPercent: 100, resetsAt: 1_781_308_800 } },
      undefined,
    );
    expect(result.status).toBe("exhausted");
    expect(result.resetAtEpochMs).toBe(1_781_308_800_000);
  });

  it("reports warning near the limit", () => {
    const result = mapCodexRateLimits({ primary: { usedPercent: 97 } }, undefined);
    expect(result.status).toBe("warning");
  });

  it("reports ok with headroom and omits the top-level reset", () => {
    const result = mapCodexRateLimits(
      { primary: { usedPercent: 12, resetsAt: 1_781_308_800 } },
      undefined,
    );
    expect(result.status).toBe("ok");
    expect(result.resetAtEpochMs).toBeUndefined();
  });

  it("reports unknown when no utilization is provided", () => {
    const result = mapCodexRateLimits({}, undefined);
    expect(result.status).toBe("unknown");
    expect(result.windows).toBeUndefined();
  });

  it("derives individual-limit utilization from remainingPercent", () => {
    const result = mapCodexRateLimits(
      { individualLimit: { remainingPercent: 0, resetsAt: 1_781_308_800 } },
      undefined,
    );
    expect(result.status).toBe("exhausted");
    expect(result.windows).toEqual([
      { label: "individual", usedPercent: 100, resetAtEpochMs: 1_781_308_800_000 },
    ]);
  });

  it("binds the top-level reset to the most-utilized window", () => {
    const result = mapCodexRateLimits(
      {
        primary: { usedPercent: 100, resetsAt: 1_781_308_800 },
        secondary: { usedPercent: 40, resetsAt: 1_781_305_200 },
      },
      undefined,
    );
    expect(result.status).toBe("exhausted");
    // Binding window is `primary` (highest utilization), so its reset wins even
    // though `secondary` resets sooner.
    expect(result.resetAtEpochMs).toBe(1_781_308_800_000);
  });
});

describe("mapClaudeRateLimits", () => {
  it("maps rejected to exhausted and exposes the reset", () => {
    const result = mapClaudeRateLimits(
      { status: "rejected", resetsAt: 1_781_308_800, rateLimitType: "five_hour", utilization: 100 },
      undefined,
    );
    expect(result.status).toBe("exhausted");
    expect(result.resetAtEpochMs).toBe(1_781_308_800_000);
    expect(result.windows).toEqual([
      { label: "five_hour", usedPercent: 100, resetAtEpochMs: 1_781_308_800_000 },
    ]);
  });

  it("maps allowed_warning to warning", () => {
    const result = mapClaudeRateLimits({ status: "allowed_warning", utilization: 96 }, undefined);
    expect(result.status).toBe("warning");
  });

  it("maps allowed to ok", () => {
    const result = mapClaudeRateLimits({ status: "allowed", utilization: 20 }, undefined);
    expect(result.status).toBe("ok");
    expect(result.resetAtEpochMs).toBeUndefined();
  });

  it("uses the overage status and reset when overage is active", () => {
    const result = mapClaudeRateLimits(
      {
        status: "rejected",
        resetsAt: 1_781_305_200,
        isUsingOverage: true,
        overageStatus: "allowed",
        overageResetsAt: 1_781_312_400,
      },
      undefined,
    );
    expect(result.status).toBe("ok");
    expect(result.windows).toContainEqual({
      label: "overage",
      resetAtEpochMs: 1_781_312_400_000,
    });
  });
});

describe("classifyRuntimeErrorClass", () => {
  it.each([
    "Rate limit exceeded for this account",
    "You have hit your usage limit",
    "429 Too Many Requests",
    "quota exceeded — please try again later",
    "gRPC error: RESOURCE_EXHAUSTED",
    "insufficient_quota",
  ])("classifies %j as rate_limit", (message) => {
    expect(classifyRuntimeErrorClass({ message })).toBe("rate_limit");
  });

  it("falls back to provider_error for unrelated failures", () => {
    expect(classifyRuntimeErrorClass({ message: "Segmentation fault in provider" })).toBe(
      "provider_error",
    );
  });

  it("honors an explicit fallback when no pattern matches", () => {
    expect(
      classifyRuntimeErrorClass({ message: "connection reset", fallback: "transport_error" }),
    ).toBe("transport_error");
  });
});

describe("isExhaustedRateLimitStatus", () => {
  it("is true only for the exhausted status", () => {
    expect(isExhaustedRateLimitStatus("exhausted")).toBe(true);
    expect(isExhaustedRateLimitStatus("warning")).toBe(false);
    expect(isExhaustedRateLimitStatus("ok")).toBe(false);
    expect(isExhaustedRateLimitStatus("unknown")).toBe(false);
  });
});
