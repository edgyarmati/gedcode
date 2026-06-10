import { GED_SUBAGENT_ROLES, type GedSubagentRole } from "@t3tools/contracts";

export interface GedRoleDisplayMeta {
  readonly role: GedSubagentRole;
  readonly label: string;
  readonly description: string;
  readonly runtimeStatus: "active" | "configuration-only";
}

const ROLE_META: Record<GedSubagentRole, Omit<GedRoleDisplayMeta, "role">> = {
  "ged-explorer": {
    label: "Explorer",
    description: "Harness-native codebase discovery before local source inspection.",
    runtimeStatus: "active",
  },
  "ged-planner": {
    label: "Planner",
    description: "Harness-native planning review before SPEC/TASKS/TESTS are finalized.",
    runtimeStatus: "active",
  },
  "ged-plan-reviewer": {
    label: "Plan reviewer",
    description: "Reviews accepted plans for risk before implementation.",
    runtimeStatus: "configuration-only",
  },
  "ged-verifier": {
    label: "Verifier",
    description: "Harness-native clean-context verification before commit.",
    runtimeStatus: "active",
  },
  "ged-worker": {
    label: "Worker",
    description: "Bounded implementation worker configuration for upcoming runtime slices.",
    runtimeStatus: "configuration-only",
  },
};

export const GED_ROLE_DISPLAY: ReadonlyArray<GedRoleDisplayMeta> = GED_SUBAGENT_ROLES.map(
  (role) => ({
    role,
    label: ROLE_META[role].label,
    description: ROLE_META[role].description,
    runtimeStatus: ROLE_META[role].runtimeStatus,
  }),
);

export const GED_ROLE_DISPLAY_BY_ROLE: Readonly<Record<GedSubagentRole, GedRoleDisplayMeta>> =
  Object.fromEntries(GED_ROLE_DISPLAY.map((meta) => [meta.role, meta])) as Record<
    GedSubagentRole,
    GedRoleDisplayMeta
  >;
