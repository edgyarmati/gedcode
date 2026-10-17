import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Ged setup for a project: preview the starter `.ged/` files it lacks, then add
 * them on confirmation. Web-only, because this fork does not build the mobile
 * app.
 */
export const gedSetupPreview = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:ged:setup-preview",
  tag: WS_METHODS.gedSetupPreview,
});

export const gedSetupApply = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:ged:setup-apply",
  tag: WS_METHODS.gedSetupApply,
  concurrency: {
    mode: "serial",
    key: ({ environmentId, input }) => JSON.stringify([environmentId, input.cwd]),
  },
});

/**
 * Whether a project is set up for Ged, for the thread header. The same preview
 * the setup dialog runs, kept warm so switching threads does not re-ask.
 */
export const gedSetupStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:ged:setup-status",
  tag: WS_METHODS.gedSetupPreview,
  staleTimeMs: 60_000,
  idleTtlMs: 300_000,
});
