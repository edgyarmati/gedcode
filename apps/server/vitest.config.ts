import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide parallel runs they can exceed the default 15s budget.
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  }),
);
