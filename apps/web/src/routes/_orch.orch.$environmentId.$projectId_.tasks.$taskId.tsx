import { createFileRoute } from "@tanstack/react-router";

import { OrchestratorTaskRoute } from "../components/orchestrator/OrchestratorRoutes";

export const Route = createFileRoute("/_orch/orch/$environmentId/$projectId_/tasks/$taskId")({
  component: () => {
    const params = Route.useParams();
    return (
      <OrchestratorTaskRoute
        environmentId={params.environmentId}
        projectId={params.projectId}
        taskId={params.taskId}
      />
    );
  },
});
