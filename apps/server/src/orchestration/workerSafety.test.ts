import { describe, expect, it } from "vitest";

import {
  clampWorkerRuntimeMode,
  isSensitiveWorkerEnvironmentName,
  makeWorkerProviderEnvironment,
} from "./workerSafety.ts";

describe("worker safety environment", () => {
  it("strips secret-like environment names and keeps only allowlisted basics", () => {
    const env = makeWorkerProviderEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LC_ALL: "C",
      API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      CUSTOM_SECRET: "secret",
      NORMAL_APP_FLAG: "1",
      EMPTY_ALLOWED: undefined,
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      LC_ALL: "C",
    });
  });

  it("treats KEY, TOKEN, and SECRET suffixes as sensitive", () => {
    expect(isSensitiveWorkerEnvironmentName("KEY")).toBe(true);
    expect(isSensitiveWorkerEnvironmentName("OPENAI_API_KEY")).toBe(true);
    expect(isSensitiveWorkerEnvironmentName("GITHUB_TOKEN")).toBe(true);
    expect(isSensitiveWorkerEnvironmentName("CUSTOM_SECRET")).toBe(true);
    expect(isSensitiveWorkerEnvironmentName("MONKEY")).toBe(false);
  });
});

describe("worker runtime-mode clamp", () => {
  it("lowers full-access to auto-accept-edits when the opt-in is off", () => {
    expect(
      clampWorkerRuntimeMode({ requested: "full-access", allowFullAccessWorkers: false }),
    ).toBe("auto-accept-edits");
  });

  it("keeps full-access when a human opted in", () => {
    expect(clampWorkerRuntimeMode({ requested: "full-access", allowFullAccessWorkers: true })).toBe(
      "full-access",
    );
  });

  it("passes modes at or below the ceiling through unchanged regardless of the opt-in", () => {
    for (const allowFullAccessWorkers of [false, true]) {
      expect(
        clampWorkerRuntimeMode({ requested: "approval-required", allowFullAccessWorkers }),
      ).toBe("approval-required");
      expect(
        clampWorkerRuntimeMode({ requested: "auto-accept-edits", allowFullAccessWorkers }),
      ).toBe("auto-accept-edits");
    }
  });
});
