import type {
  EnvironmentId,
  ModelSelection,
  OrchestratorPresetMigrationState,
  ProjectId,
  ServerConfig,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

import { readEnvironmentApi } from "../../environmentApi";
import { useEnvironmentApiAvailable } from "../../hooks/useEnvironmentApiAvailable";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { BackendModelPicker, backendLabel } from "./RoleBackendPicker";
import {
  buildPresetMigrationCompletion,
  CAPABILITY_PRESET_KEYS,
  emptyPresetDraft,
  isPresetMigrationDraftComplete,
  type CapabilityPresetKey,
  type MigrationGlobalDraft,
  type MigrationProjectDecision,
} from "./orchestratorPresetMigration.logic";

const PRESET_COPY: Record<CapabilityPresetKey, { label: string; description: string }> = {
  cheap: {
    label: "Cheap",
    description: "Fast, economical execution for routine and mechanical work.",
  },
  smart: {
    label: "Smart",
    description: "The balanced default for most implementation and verification work.",
  },
  genius: {
    label: "Genius",
    description: "Maximum reasoning for planning and unusually complex problems.",
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectedEntry(
  selection: ModelSelection | null,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  return selection ? entries.find((entry) => entry.instanceId === selection.instanceId) : undefined;
}

function LegacySelection({
  label,
  selection,
  entries,
}: {
  label: string;
  selection: ModelSelection | null | undefined;
  entries: ReadonlyArray<ProviderInstanceEntry>;
}) {
  if (!selection) return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">
        {backendLabel(selection, selectedEntry(selection, entries))}
      </span>
    </div>
  );
}

function PresetPickerCard({
  preset,
  selection,
  entries,
  allowUnset,
  onChange,
}: {
  preset: CapabilityPresetKey;
  selection: ModelSelection | null;
  entries: ReadonlyArray<ProviderInstanceEntry>;
  allowUnset: boolean;
  onChange: (selection: ModelSelection | null) => void;
}) {
  const entry = selectedEntry(selection, entries);
  const copy = PRESET_COPY[preset];
  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
          {entry ? (
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              showBadge={!entry.isDefault}
            />
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">
              {copy.label.slice(0, 1)}
            </span>
          )}
        </div>
        <div>
          <h3 className="font-semibold">{copy.label}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        </div>
      </div>
      <BackendModelPicker
        selection={selection}
        instanceEntries={entries}
        allowUnset={allowUnset}
        unsetLabel="Choose a harness"
        unsetOptionLabel="Inherit global preset"
        backendAriaLabel={`${copy.label} harness`}
        modelAriaLabel={`${copy.label} model`}
        onSelectionChange={onChange}
      />
    </section>
  );
}

export function OrchestratorPresetMigrationGate({
  environmentId,
  children,
}: {
  environmentId: EnvironmentId | null;
  children: ReactNode;
}) {
  const apiAvailable = useEnvironmentApiAvailable(environmentId ?? ("" as EnvironmentId));
  const [state, setState] = useState<OrchestratorPresetMigrationState | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setConfig(null);
    setLoadError(null);
    if (!environmentId || !apiAvailable) return () => void (cancelled = true);
    const api = readEnvironmentApi(environmentId);
    if (!api) return () => void (cancelled = true);
    void (async () => {
      try {
        const nextState = await api.orchestrator.getPresetMigration();
        if (cancelled) return;
        setState(nextState);
        if (nextState.status === "completed") return;
        const nextConfig = await api.server.getConfig();
        if (!cancelled) setConfig(nextConfig);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      }
    })();
    return () => void (cancelled = true);
  }, [apiAvailable, environmentId, reloadKey]);

  if (!environmentId) return <>{children}</>;
  if (state?.status === "completed") return <>{children}</>;

  if (loadError) {
    return (
      <MigrationSurface>
        <div className="mx-auto max-w-lg rounded-xl border border-destructive/40 bg-card p-6 text-center">
          <h1 className="text-xl font-semibold">Preset setup could not be loaded</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-5" onClick={() => setReloadKey((value) => value + 1)}>
            Try again
          </Button>
        </div>
      </MigrationSurface>
    );
  }

  if (!state || !config) {
    return (
      <MigrationSurface>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="animate-spin" /> Loading required preset setup…
        </div>
      </MigrationSurface>
    );
  }

  return (
    <PresetMigrationWizard
      environmentId={environmentId}
      state={state}
      config={config}
      onCompleted={setState}
    />
  );
}

function MigrationSurface({ children }: { children: ReactNode }) {
  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full items-center justify-center px-5 py-10">{children}</div>
    </main>
  );
}

export function PresetMigrationWizard({
  environmentId,
  state,
  config,
  onCompleted,
}: {
  environmentId: EnvironmentId;
  state: OrchestratorPresetMigrationState;
  config: ServerConfig;
  onCompleted: (state: OrchestratorPresetMigrationState) => void;
}) {
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(deriveProviderInstanceEntries(config.providers)).filter(
        (entry) => entry.enabled && entry.installed && entry.isAvailable && entry.models.length > 0,
      ),
    [config.providers],
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [global, setGlobal] = useState<MigrationGlobalDraft>(emptyPresetDraft);
  const [projects, setProjects] = useState<Map<ProjectId, MigrationProjectDecision>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const globalsComplete = CAPABILITY_PRESET_KEYS.every((key) => global[key] !== null);
  const allComplete = isPresetMigrationDraftComplete({ state, global, projects });

  const updateGlobal = useCallback((key: CapabilityPresetKey, selection: ModelSelection | null) => {
    setGlobal((current) => ({ ...current, [key]: selection }));
  }, []);
  const setProjectDecision = useCallback(
    (projectId: ProjectId, decision: MigrationProjectDecision) => {
      setProjects((current) => new Map(current).set(projectId, decision));
    },
    [],
  );

  const finish = useCallback(async () => {
    const input = buildPresetMigrationCompletion({ state, global, projects });
    if (!input) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSubmitError("The environment disconnected. Reconnect it and try again.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.orchestrator.completePresetMigration(input);
      if (result.status !== "completed") throw new Error("The server did not complete setup.");
      onCompleted(result);
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [environmentId, global, onCompleted, projects, state]);

  return (
    <MigrationSurface>
      <div className="w-full max-w-4xl">
        <header className="mb-7">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Required setup · Step {step} of 2
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Choose how the Orchestrator delegates work
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Workers now use three capability presets. Map each preset explicitly before using the
            Orchestrator; no legacy model is assigned automatically.
          </p>
        </header>

        {entries.length === 0 ? (
          <section className="rounded-xl border bg-card p-6">
            <h2 className="font-semibold">No available harnesses with models</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enable and connect at least one provider before completing this required setup.
            </p>
            <Button className="mt-4" variant="outline" render={<Link to="/settings/providers" />}>
              Open provider settings
            </Button>
          </section>
        ) : step === 1 ? (
          <>
            {state.legacyGlobalSelection ? (
              <div className="mb-4 rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
                <LegacySelection
                  label="Previous global worker default"
                  selection={state.legacyGlobalSelection}
                  entries={entries}
                />
              </div>
            ) : null}
            <div className="grid gap-4">
              {CAPABILITY_PRESET_KEYS.map((preset) => (
                <PresetPickerCard
                  key={preset}
                  preset={preset}
                  selection={global[preset]}
                  entries={entries}
                  allowUnset={false}
                  onChange={(selection) => updateGlobal(preset, selection)}
                />
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <Button disabled={!globalsComplete} onClick={() => setStep(2)}>
                Review projects <ArrowRightIcon />
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-4">
              {state.projects.length === 0 ? (
                <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                  There are no existing Orchestrator projects to map. New projects will inherit the
                  global presets.
                </section>
              ) : null}
              {state.projects.map((project) => {
                const decision = projects.get(project.projectId);
                return (
                  <section key={project.projectId} className="rounded-xl border bg-card p-5">
                    <h2 className="font-semibold">{project.title}</h2>
                    {Object.keys(project.roleModelSelections).length > 0 ? (
                      <div className="mt-3 grid gap-1 rounded-lg border bg-muted/20 px-3 py-2">
                        <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                          Previous role selections
                        </p>
                        <LegacySelection
                          label="Plan"
                          selection={project.roleModelSelections.plan}
                          entries={entries}
                        />
                        <LegacySelection
                          label="Work"
                          selection={project.roleModelSelections.work}
                          entries={entries}
                        />
                        <LegacySelection
                          label="Verify"
                          selection={project.roleModelSelections.verify}
                          entries={entries}
                        />
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${decision?.kind === "inherit" ? "border-primary bg-primary/8" : "hover:bg-muted/40"}`}
                        onClick={() => setProjectDecision(project.projectId, { kind: "inherit" })}
                      >
                        <span className="font-medium">Inherit global presets</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Use Cheap, Smart, and Genius exactly as configured above.
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${decision?.kind === "customize" ? "border-primary bg-primary/8" : "hover:bg-muted/40"}`}
                        onClick={() =>
                          setProjectDecision(project.projectId, {
                            kind: "customize",
                            presets:
                              decision?.kind === "customize"
                                ? decision.presets
                                : emptyPresetDraft(),
                          })
                        }
                      >
                        <span className="font-medium">Customize this project</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Override one or more presets; unset presets still inherit globally.
                        </span>
                      </button>
                    </div>
                    {decision?.kind === "customize" ? (
                      <div className="mt-4 grid gap-3 border-t pt-4">
                        {CAPABILITY_PRESET_KEYS.map((preset) => (
                          <PresetPickerCard
                            key={preset}
                            preset={preset}
                            selection={decision.presets[preset]}
                            entries={entries}
                            allowUnset
                            onChange={(selection) =>
                              setProjectDecision(project.projectId, {
                                kind: "customize",
                                presets: { ...decision.presets, [preset]: selection },
                              })
                            }
                          />
                        ))}
                        {CAPABILITY_PRESET_KEYS.every(
                          (preset) => decision.presets[preset] === null,
                        ) ? (
                          <p className="text-xs text-destructive">
                            Choose at least one override, or select “Inherit global presets”.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
            {submitError ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-between gap-3">
              <Button variant="outline" disabled={submitting} onClick={() => setStep(1)}>
                <ArrowLeftIcon /> Back
              </Button>
              <Button disabled={!allComplete || submitting} onClick={() => void finish()}>
                {submitting ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}
                Finish required setup
              </Button>
            </div>
          </>
        )}
      </div>
    </MigrationSurface>
  );
}
