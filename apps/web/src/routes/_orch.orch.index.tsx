import { createFileRoute } from "@tanstack/react-router";

import { OrchestratorHomeRoute } from "../components/orchestrator/OrchestratorRoutes";

export const Route = createFileRoute("/_orch/orch/")({
  component: OrchestratorHomeRoute,
});
