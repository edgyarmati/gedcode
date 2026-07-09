import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "./routeTree.gen";

vi.mock("./components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));

type TestRoute = {
  children?: TestRoute[];
  options?: {
    id?: string;
  };
};

describe("orchestrator route tree", () => {
  it("keeps task detail routes as siblings of the project route", () => {
    const root = routeTree as unknown as TestRoute;
    const orchRoute = root.children?.find((route) => route.options?.id === "/_orch");
    const projectRoute = orchRoute?.children?.find(
      (route) => route.options?.id === "/orch/$environmentId/$projectId",
    );
    const taskRoute = orchRoute?.children?.find(
      (route) => route.options?.id === "/orch/$environmentId/$projectId_/tasks/$taskId",
    );

    expect(projectRoute).toBeDefined();
    expect(taskRoute).toBeDefined();
    expect(projectRoute?.children ?? []).not.toContain(taskRoute);
  });
});
