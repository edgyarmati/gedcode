import { createFileRoute } from "@tanstack/react-router";

import { OrchestratorProjectRoute } from "../components/orchestrator/OrchestratorRoutes";

export const Route = createFileRoute("/_orch/orch/$environmentId/$projectId")({
  component: () => {
    const params = Route.useParams();
    return (
      <OrchestratorProjectRoute environmentId={params.environmentId} projectId={params.projectId} />
    );
  },
});
