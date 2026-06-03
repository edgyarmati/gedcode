import type { GedSubagentRole, ModelSelection } from "@t3tools/contracts";

export type GedRoleModelSelectionMap = Readonly<Record<string, ModelSelection>>;

export interface ResolveGedMainThreadModelSelectionInput {
  readonly existingThreadModelSelection?: ModelSelection | null | undefined;
  readonly projectDefaultModelSelection?: ModelSelection | null | undefined;
  readonly globalMainModelSelection?: ModelSelection | null | undefined;
  readonly fallbackModelSelection: ModelSelection;
}

export interface ResolveGedRoleModelSelectionInput {
  readonly role: GedSubagentRole;
  readonly projectRoleModelSelections?: GedRoleModelSelectionMap | null | undefined;
  readonly globalRoleModelSelections?: GedRoleModelSelectionMap | null | undefined;
  readonly parentThreadModelSelection?: ModelSelection | null | undefined;
  readonly projectDefaultModelSelection?: ModelSelection | null | undefined;
  readonly globalMainModelSelection?: ModelSelection | null | undefined;
  readonly fallbackModelSelection: ModelSelection;
}

export const resolveGedMainThreadModelSelection = (
  input: ResolveGedMainThreadModelSelectionInput,
): ModelSelection =>
  input.existingThreadModelSelection ??
  input.projectDefaultModelSelection ??
  input.globalMainModelSelection ??
  input.fallbackModelSelection;

export const resolveGedRoleModelSelection = (
  input: ResolveGedRoleModelSelectionInput,
): ModelSelection =>
  input.projectRoleModelSelections?.[input.role] ??
  input.globalRoleModelSelections?.[input.role] ??
  input.parentThreadModelSelection ??
  input.projectDefaultModelSelection ??
  input.globalMainModelSelection ??
  input.fallbackModelSelection;

export const setGedRoleModelSelection = (
  selections: GedRoleModelSelectionMap | null | undefined,
  role: GedSubagentRole,
  modelSelection: ModelSelection,
): Record<string, ModelSelection> => ({ ...selections, [role]: modelSelection });

export const clearGedRoleModelSelection = (
  selections: GedRoleModelSelectionMap | null | undefined,
  role: GedSubagentRole,
): Record<string, ModelSelection> => {
  const next = { ...selections };
  delete next[role];
  return next;
};
