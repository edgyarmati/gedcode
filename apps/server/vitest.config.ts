import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under monorepo-wide parallel runs they can exceed the default budget.
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
