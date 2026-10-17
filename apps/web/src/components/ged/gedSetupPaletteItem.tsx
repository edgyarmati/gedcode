import { NotebookPenIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../CommandPalette.logic";
import { type GedSetupTarget, requestGedSetup } from "./GedSetupDialog";

/** The command palette's "Set up Ged" action for the current project. */
export function gedSetupPaletteItem(target: GedSetupTarget): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:ged-setup",
    searchTerms: ["ged", "set up", "setup", "memory", "workflow", "land gate"],
    title: (
      <>
        Set up Ged in <span className="font-semibold">{target.projectName}</span>
      </>
    ),
    icon: <NotebookPenIcon className={ITEM_ICON_CLASS} />,
    run: async () => requestGedSetup(target),
  };
}
