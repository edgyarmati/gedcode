import type {
  OrchestratorDismissProjectContextOnboardingInput,
  OrchestratorDismissProjectContextOnboardingResult,
  OrchestratorGetProjectContextOnboardingInput,
  OrchestratorGetProjectContextOnboardingResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ProjectContextOnboardingCoordinatorShape {
  /** Fresh, content-free context scan suitable for a Chat or Orchestrator prompt. */
  readonly get: (
    input: OrchestratorGetProjectContextOnboardingInput,
  ) => Effect.Effect<OrchestratorGetProjectContextOnboardingResult, Error>;
  /** Dismiss exactly the scan the caller saw; stale fingerprints fail closed. */
  readonly dismiss: (
    input: OrchestratorDismissProjectContextOnboardingInput,
  ) => Effect.Effect<OrchestratorDismissProjectContextOnboardingResult, Error>;
}

export class ProjectContextOnboardingCoordinator extends Context.Service<
  ProjectContextOnboardingCoordinator,
  ProjectContextOnboardingCoordinatorShape
>()("gedcode/orchestration/Services/ProjectContextOnboardingCoordinator") {}
