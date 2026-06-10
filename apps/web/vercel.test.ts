import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return (await import("./vercel")).config;
}

describe("web Vercel config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the existing T3 hosted router defaults", async () => {
    const config = await loadConfig();

    expect(config.routes).toContainEqual(
      expect.objectContaining({
        has: [expect.objectContaining({ type: "host", value: "app.t3.codes" })],
        dest: "https://latest.app.t3.codes/$1",
      }),
    );
    expect(config.routes).toContainEqual(
      expect.objectContaining({
        has: [
          expect.objectContaining({ type: "host", value: "app.t3.codes" }),
          expect.objectContaining({ type: "cookie", key: "t3code_web_channel", value: "nightly" }),
        ],
        dest: "https://nightly.app.t3.codes/$1",
      }),
    );
  });

  it("uses fork-owned hosted web origins from environment", async () => {
    vi.stubEnv("HOSTED_WEB_ROUTER_HOST", "app.gedcode.example");
    vi.stubEnv("HOSTED_WEB_CHANNEL_COOKIE", "gedcode_web_channel");
    vi.stubEnv("HOSTED_WEB_LATEST_ORIGIN", "https://latest.gedcode.example");
    vi.stubEnv("HOSTED_WEB_NIGHTLY_ORIGIN", "https://nightly.gedcode.example");

    const config = await loadConfig();

    expect(config.routes).toContainEqual(
      expect.objectContaining({
        has: [expect.objectContaining({ type: "host", value: "app.gedcode.example" })],
        dest: "https://latest.gedcode.example/$1",
      }),
    );
    expect(config.routes).toContainEqual(
      expect.objectContaining({
        has: [
          expect.objectContaining({ type: "host", value: "app.gedcode.example" }),
          expect.objectContaining({ type: "cookie", key: "gedcode_web_channel", value: "nightly" }),
        ],
        dest: "https://nightly.gedcode.example/$1",
      }),
    );
  });

  it("derives the router host from VITE_HOSTED_APP_URL when no explicit router host is set", async () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.gedcode.example");
    vi.stubEnv("HOSTED_WEB_LATEST_ORIGIN", "https://latest.gedcode.example");
    vi.stubEnv("HOSTED_WEB_NIGHTLY_ORIGIN", "https://nightly.gedcode.example");

    const config = await loadConfig();

    expect(config.routes).toContainEqual(
      expect.objectContaining({
        has: [expect.objectContaining({ type: "host", value: "app.gedcode.example" })],
        dest: "https://latest.gedcode.example/$1",
      }),
    );
  });

  it("rejects invalid hosted channel origins", async () => {
    vi.stubEnv("HOSTED_WEB_LATEST_ORIGIN", "latest.gedcode.example");

    await expect(loadConfig()).rejects.toThrow("HOSTED_WEB_LATEST_ORIGIN must be an absolute URL.");
  });

  it("rejects invalid hosted app URLs instead of falling back to the upstream router", async () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "app.gedcode.example");

    await expect(loadConfig()).rejects.toThrow("VITE_HOSTED_APP_URL must be an absolute URL.");
  });

  it("rejects channel origins that point back at the router host", async () => {
    vi.stubEnv("HOSTED_WEB_ROUTER_HOST", "app.gedcode.example");
    vi.stubEnv("HOSTED_WEB_LATEST_ORIGIN", "https://app.gedcode.example");

    await expect(loadConfig()).rejects.toThrow(
      "Hosted web channel origins must not point at the router host.",
    );
  });
});
