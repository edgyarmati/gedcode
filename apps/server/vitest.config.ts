import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under monorepo-wide parallel runs they can starve each other badly enough
      // to hit it.live wall-clock budgets even though the same files pass alone.
      fileParallelism: false,
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  }),
);
