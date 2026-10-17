import type { EnvironmentId } from "@t3tools/contracts";

import { requestGedSetup } from "../ged/GedSetupDialog";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function GedSetupSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
}) {
  return (
    <SettingsSection title="Ged">
      <SettingsRow
        title="Set up Ged"
        description="Adds the starter .ged/ files this project lacks, so agents plan, verify and land work the Ged way here. Shows what it will add first and never changes existing files."
        control={
          <Button size="sm" variant="outline" type="button" onClick={() => requestGedSetup(props)}>
            Set up…
          </Button>
        }
      />
    </SettingsSection>
  );
}
