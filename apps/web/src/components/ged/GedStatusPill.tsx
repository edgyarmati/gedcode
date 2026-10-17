import type { EnvironmentId } from "@t3tools/contracts";

import { gedSetupStatus } from "../../state/ged";
import { useFilesystemReadAccess } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { requestGedSetup } from "./GedSetupDialog";

/**
 * Shows beside the project name whether the project uses Ged, and opens setup
 * from there. Renders nothing until the answer is known, so it never claims a
 * state it has not checked.
 */
export function GedStatusPill({
  environmentId,
  cwd,
  projectName,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
}) {
  const access = useFilesystemReadAccess(environmentId);
  const status = useEnvironmentQuery(
    access.canReadFiles ? gedSetupStatus({ environmentId, input: { cwd } }) : null,
  );
  if (status.data === null) return null;
  const setUp = status.data.present.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => requestGedSetup({ environmentId, cwd, projectName })}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-muted-foreground text-xs transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {setUp ? (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-success" />
            Ged
          </>
        ) : (
          <>
            <span className="size-1.5 shrink-0 rounded-full border border-muted-foreground/60" />
            Set up Ged
          </>
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {setUp ? `${projectName} uses Ged` : `Add Ged's starter files to ${projectName}`}
      </TooltipPopup>
    </Tooltip>
  );
}
