import { EnvironmentId } from "@t3tools/contracts";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { OrchestratorPresetMigrationGate } from "../components/orchestrator/OrchestratorPresetMigrationGate";
import { getPrimaryKnownEnvironment } from "../environments/primary";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";

function OrchestratorRouteLayout() {
  const setOrchestratorMode = useUiStateStore((state) => state.setOrchestratorMode);
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeEnvironmentId = pathname.match(/^\/orch\/([^/]+)/u)?.[1];
  const environmentId = routeEnvironmentId
    ? EnvironmentId.make(decodeURIComponent(routeEnvironmentId))
    : (activeEnvironmentId ?? getPrimaryKnownEnvironment()?.environmentId ?? null);

  useEffect(() => {
    setOrchestratorMode(true);
  }, [setOrchestratorMode]);

  return (
    <OrchestratorPresetMigrationGate environmentId={environmentId}>
      <Outlet />
    </OrchestratorPresetMigrationGate>
  );
}

export const Route = createFileRoute("/_orch")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: OrchestratorRouteLayout,
});
