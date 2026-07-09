import { createFileRoute } from "@tanstack/react-router";

import { OrchestratorDefaultsSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsOrchestratorRoute() {
  return <OrchestratorDefaultsSettingsPanel />;
}

export const Route = createFileRoute("/settings/orchestrator")({
  component: SettingsOrchestratorRoute,
});
