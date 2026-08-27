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

function collectRouteIds(route: TestRoute): ReadonlySet<string> {
  const routeIds = new Set<string>();
  const visit = (candidate: TestRoute) => {
    if (candidate.options?.id) {
      routeIds.add(candidate.options.id);
    }
    for (const child of candidate.children ?? []) {
      visit(child);
    }
  };
  visit(route);
  return routeIds;
}

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

  it("keeps the default landing and every app deep-link surface addressable", () => {
    const routeIds = collectRouteIds(routeTree as unknown as TestRoute);

    expect([...routeIds]).toEqual(
      expect.arrayContaining([
        "/",
        "/chat",
        "/$environmentId/$threadId",
        "/draft/$draftId",
        "/orch/",
        "/pair",
        "/settings",
      ]),
    );
  });
});
