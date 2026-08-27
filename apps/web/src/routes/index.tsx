import { createFileRoute, redirect } from "@tanstack/react-router";

import { listSavedEnvironmentRecords } from "../environments/runtime";
import { resolveDefaultLanding } from "../navigation/defaultLanding.logic";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    throw redirect({
      to: resolveDefaultLanding({
        authGateStatus: context.authGateState.status,
        savedEnvironmentCount:
          context.authGateState.status === "hosted-static"
            ? listSavedEnvironmentRecords().length
            : 0,
      }),
      replace: true,
    });
  },
});
