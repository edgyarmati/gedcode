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
    description: "Reconnaissance child thread for codebase discovery and skill-fit checks.",
    runtimeStatus: "active",
  },
  "ged-planner": {
    label: "Planner",
    description: "Drafts SPEC/TASKS/TESTS plans for upcoming Ged runtime slices.",
    runtimeStatus: "configuration-only",
  },
  "ged-plan-reviewer": {
    label: "Plan reviewer",
    description: "Reviews accepted plans for risk before implementation.",
    runtimeStatus: "configuration-only",
  },
  "ged-verifier": {
    label: "Verifier",
    description: "Clean-context verification before commit.",
    runtimeStatus: "configuration-only",
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
