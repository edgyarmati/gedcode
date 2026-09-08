import { expect, it } from "vitest";
import { applySchemaCompatibility } from "./schemaCompatibility.ts";

it("keeps generated PlanType definitions on the shared verified enum", () => {
  const name = "V2GetAccountResponse__PlanType";
  const code = 'export type V2GetAccountResponse__PlanType = "free";';
  const patched = applySchemaCompatibility(name, code);
  expect(patched).toBe(
    `export type ${name} = typeof CodexPlanType.Type;\nexport const ${name} = CodexPlanType;`,
  );
  expect(applySchemaCompatibility(name, patched)).toBe(patched);
});

it("does not alter unrelated generated schemas", () => {
  const code = "export const V2GetAccountResponse = Schema.Struct({});";
  expect(applySchemaCompatibility("V2GetAccountResponse", code)).toBe(code);
});
