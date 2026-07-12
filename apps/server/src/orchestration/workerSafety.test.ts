import { describe, expect, it } from "vitest";

import {
  isSensitiveWorkerEnvironmentName,
  makeWorkerProviderEnvironment,
  resolveWorkerStageRuntimeMode,
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

describe("worker runtime mode", () => {
  it("always starts orchestrator workers with full access", () => {
    expect(resolveWorkerStageRuntimeMode()).toBe("full-access");
  });
});
