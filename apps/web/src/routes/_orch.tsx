import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { useUiStateStore } from "../uiStateStore";

function OrchestratorRouteLayout() {
  const setOrchestratorMode = useUiStateStore((state) => state.setOrchestratorMode);

  useEffect(() => {
    setOrchestratorMode(true);
  }, [setOrchestratorMode]);

  return <Outlet />;
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
