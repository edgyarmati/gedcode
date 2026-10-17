import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GedSetupPreviewResult } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { gedSetupApply, gedSetupPreview, gedSetupStatus } from "../../state/ged";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";

/**
 * Previews the starter `.ged/` files a project lacks and adds them on
 * confirmation. Opened from Project settings and the command palette through
 * `requestGedSetup`; `GedSetupDialogHost` is mounted once at the root.
 */

export interface GedSetupTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
}

const useTarget = create<{ target: GedSetupTarget | null }>(() => ({ target: null }));

export function requestGedSetup(target: GedSetupTarget): void {
  useTarget.setState({ target });
}

function close() {
  useTarget.setState({ target: null });
}

export function GedSetupDialogHost() {
  const target = useTarget((state) => state.target);
  useEffect(() => () => close(), []);
  return target ? (
    <GedSetupDialog key={`${target.environmentId}:${target.cwd}`} target={target} />
  ) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

type PreviewState =
  | { readonly _tag: "loading" }
  | { readonly _tag: "ready"; readonly plan: GedSetupPreviewResult }
  | { readonly _tag: "failed"; readonly message: string };

function GedSetupDialog({ target }: { readonly target: GedSetupTarget }) {
  const preview = useAtomCommand(gedSetupPreview, { reportFailure: false });
  const apply = useAtomCommand(gedSetupApply, { reportFailure: false });
  const canApply = useAtomValue(gedSetupApply.permissionAtom(target.environmentId));
  const refreshStatus = useAtomRefresh(
    gedSetupStatus({ environmentId: target.environmentId, input: { cwd: target.cwd } }),
  );
  const [state, setState] = useState<PreviewState>({ _tag: "loading" });
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void preview({ environmentId: target.environmentId, input: { cwd: target.cwd } }).then(
      (result) => {
        if (cancelled || isAtomCommandInterrupted(result)) return;
        setState(
          result._tag === "Success"
            ? { _tag: "ready", plan: result.value }
            : { _tag: "failed", message: errorMessage(squashAtomCommandFailure(result)) },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [preview, target.cwd, target.environmentId]);

  const missing = state._tag === "ready" ? state.plan.missing : [];

  const runApply = async () => {
    setApplying(true);
    const result = await apply({ environmentId: target.environmentId, input: { cwd: target.cwd } });
    setApplying(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setState({ _tag: "failed", message: errorMessage(squashAtomCommandFailure(result)) });
      return;
    }
    toastManager.add({
      type: "success",
      title: `Ged is set up in ${target.projectName}`,
      description:
        result.value.written.length === 1
          ? "Added 1 starter file."
          : `Added ${result.value.written.length} starter files.`,
    });
    refreshStatus();
    close();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set up Ged</DialogTitle>
          <DialogDescription>
            Adds the starter <code>.ged/</code> files {target.projectName} lacks: project memory,
            standards, a plan index, and the land gate. Existing files are never changed.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {state._tag === "loading" ? (
            <p className="text-muted-foreground text-sm">Checking the project…</p>
          ) : state._tag === "failed" ? (
            <p className="text-destructive text-sm">{state.message}</p>
          ) : missing.length === 0 ? (
            <p className="text-sm">Ged is already set up here. Nothing to add.</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>These files will be added:</p>
              <ul className="flex flex-col gap-0.5 font-mono text-xs">
                {missing.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {state.plan.present.length > 0 ? (
                <p className="text-muted-foreground">
                  {state.plan.present.length} already present and left as they are.
                </p>
              ) : null}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {missing.length === 0 ? "Close" : "Cancel"}
          </Button>
          {missing.length > 0 ? (
            <Button type="button" disabled={applying || !canApply} onClick={() => void runApply()}>
              {applying ? "Setting up…" : "Set up Ged"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
