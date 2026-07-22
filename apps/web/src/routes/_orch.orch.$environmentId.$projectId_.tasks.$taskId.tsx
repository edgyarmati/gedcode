import { createFileRoute } from "@tanstack/react-router";

import { OrchestratorTaskRoute } from "../components/orchestrator/OrchestratorRoutes";
import { parseTaskStageSearch } from "../components/orchestrator/OrchestratorRoutes.logic";

export const Route = createFileRoute("/_orch/orch/$environmentId/$projectId_/tasks/$taskId")({
  validateSearch: parseTaskStageSearch,
  component: () => {
    const params = Route.useParams();
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <OrchestratorTaskRoute
        environmentId={params.environmentId}
        projectId={params.projectId}
        taskId={params.taskId}
        requestedStageThreadId={search.stage}
        onSelectStageThread={(stage) =>
          void navigate({
            replace: true,
            search: (previous) => (stage === undefined ? {} : { ...previous, stage }),
          })
        }
      />
    );
  },
});
