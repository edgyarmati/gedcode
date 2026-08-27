export type DefaultLandingAuthStatus =
  | "authenticated"
  | "hosted-pairing"
  | "hosted-static"
  | "requires-auth";

export type DefaultLandingPath = "/chat" | "/orch" | "/pair";

export function resolveDefaultLanding(input: {
  readonly authGateStatus: DefaultLandingAuthStatus;
  readonly savedEnvironmentCount: number;
}): DefaultLandingPath {
  switch (input.authGateStatus) {
    case "authenticated":
      return "/orch";
    case "hosted-static":
      return input.savedEnvironmentCount === 0 ? "/chat" : "/orch";
    case "hosted-pairing":
    case "requires-auth":
      return "/pair";
  }
}
