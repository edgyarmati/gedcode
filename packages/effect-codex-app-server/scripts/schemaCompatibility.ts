// Keep this narrow overlay while the rest of the protocol stays on its pinned
// upstream ref. Regeneration must not restore the pre-0.149.1 account-plan enum.
export const schemaCompatibilityImport = 'import { CodexPlanType } from "../planType.ts";';

export function applySchemaCompatibility(name: string, code: string): string {
  if (!name.endsWith("__PlanType")) return code;
  return `export type ${name} = typeof CodexPlanType.Type;\nexport const ${name} = CodexPlanType;`;
}
