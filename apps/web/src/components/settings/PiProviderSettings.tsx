"use client";

import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LinkIcon,
  RefreshCwIcon,
  UnplugIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PiOAuthLoginStartResult,
  PiOAuthLoginStatus,
  PiProviderCatalogEntry,
  PiProviderId,
  ServerSettings,
} from "@t3tools/contracts";

import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
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
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./settingsLayout";
import {
  buildPiProviderApiKeyPatch,
  buildPiProviderEnabledPatch,
  buildPiProviderOAuthDisconnectedPatch,
} from "./PiProviderSettings.logic";

const KIND_LABEL: Record<PiProviderCatalogEntry["kind"], string> = {
  apiKey: "API key",
  oauth: "OAuth",
  ambient: "Ambient",
};

function formatExpiresAt(value: number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function describeProviderState(entry: PiProviderCatalogEntry): string {
  const configured = entry.configured ? "Configured" : "Not configured";
  const enabled = entry.enabled ? "enabled for picker" : "disabled for picker";
  return `${configured}, ${enabled}`;
}

function providerEnvironmentHint(entry: PiProviderCatalogEntry): string | null {
  if (entry.envKeys && entry.envKeys.length > 0) {
    return entry.envKeys.length === 1
      ? `Detected environment variable: ${entry.envKeys[0]}`
      : `Detected environment variables: ${entry.envKeys.join(", ")}`;
  }
  if (entry.kind === "ambient" && !entry.configured) {
    return "Uses ambient AWS/GCP credentials - configure them in the server environment.";
  }
  return null;
}

function ApiKeyControls(props: {
  readonly entry: PiProviderCatalogEntry;
  readonly hasRedactedApiKey: boolean;
  readonly onSave: (provider: PiProviderId, value: string) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [props.entry.id, props.hasRedactedApiKey]);

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="grid gap-1.5">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            props.hasRedactedApiKey ? "Stored secret - enter a new value to replace" : "API key"
          }
          aria-label={`${props.entry.displayName} API key`}
        />
        <span className="text-xs text-muted-foreground">
          Sensitive values are stored by the server and are not returned to the app after saving.
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          props.onSave(props.entry.id, draft);
          setDraft("");
        }}
        disabled={draft.trim().length === 0 && !props.hasRedactedApiKey}
      >
        <KeyRoundIcon className="size-3.5" />
        Save key
      </Button>
    </div>
  );
}

function PiOAuthLoginDialog(props: {
  readonly entry: PiProviderCatalogEntry | null;
  readonly onClose: () => void;
  readonly onConnected: () => void;
}) {
  const [startResult, setStartResult] = useState<PiOAuthLoginStartResult | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<PiOAuthLoginStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const open = props.entry !== null;

  useEffect(() => {
    if (!props.entry) {
      setStartResult(null);
      setCode("");
      setStatus(null);
      setError(null);
      setIsStarting(false);
      setIsCompleting(false);
      return;
    }

    let cancelled = false;
    setStartResult(null);
    setCode("");
    setStatus(null);
    setError(null);
    setIsStarting(true);
    void getPrimaryEnvironmentConnection()
      .client.server.startPiOAuthLogin({ provider: props.entry.id })
      .then((result) => {
        if (!cancelled) setStartResult(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setIsStarting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [props.entry]);

  const cancelLogin = useCallback(async () => {
    const sessionId = startResult?.sessionId;
    if (sessionId && status?.connected !== true) {
      try {
        await getPrimaryEnvironmentConnection().client.server.cancelPiOAuthLogin({ sessionId });
      } catch (caught) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not cancel pi OAuth login",
            description: caught instanceof Error ? caught.message : String(caught),
          }),
        );
      }
    }
    props.onClose();
  }, [props, startResult?.sessionId, status?.connected]);

  const completeLogin = useCallback(async () => {
    if (!startResult) return;
    setIsCompleting(true);
    setError(null);
    try {
      const nextStatus = await getPrimaryEnvironmentConnection().client.server.completePiOAuthLogin(
        {
          sessionId: startResult.sessionId,
          code,
        },
      );
      setStatus(nextStatus);
      props.onConnected();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsCompleting(false);
    }
  }, [code, props, startResult]);

  const expiresAt = formatExpiresAt(status?.expiresAt);
  const deviceCode = startResult?.deviceCode;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && void cancelLogin()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {props.entry?.displayName ?? "provider"}</DialogTitle>
          <DialogDescription>
            Complete the provider authorization flow, then paste the code here.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {isStarting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Starting login…
            </div>
          ) : null}
          {startResult?.authUrl ? (
            <a
              href={startResult.authUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <span className="truncate">{startResult.authUrl}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0" />
            </a>
          ) : null}
          {startResult?.instructions ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {startResult.instructions}
            </p>
          ) : null}
          {deviceCode ? (
            <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">User code</span>
                <p className="font-mono text-base text-foreground">{deviceCode.userCode}</p>
              </div>
              <a
                href={deviceCode.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline"
              >
                <span className="truncate">{deviceCode.verificationUri}</span>
                <ExternalLinkIcon className="size-3.5 shrink-0" />
              </a>
            </div>
          ) : null}
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-foreground">Authorization code</span>
            <Input
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              autoComplete="one-time-code"
              spellCheck={false}
              disabled={!startResult || status?.connected === true}
            />
          </label>
          {status?.connected ? (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              <CheckCircle2Icon className="size-4" />
              Connected{expiresAt ? ` until ${expiresAt}` : ""}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isCompleting}
            onClick={() => void cancelLogin()}
          >
            {status?.connected ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={() => void completeLogin()}
            disabled={!startResult || code.trim().length === 0 || isCompleting || status?.connected}
          >
            {isCompleting ? <Spinner className="size-3.5" /> : null}
            Complete
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PiProviderRow(props: {
  readonly entry: PiProviderCatalogEntry;
  readonly settingsPiProviders: ServerSettings["piProviders"];
  readonly catalog: ReadonlyArray<PiProviderCatalogEntry>;
  readonly onToggleEnabled: (provider: PiProviderId, enabled: boolean) => void;
  readonly onSaveApiKey: (provider: PiProviderId, value: string) => void;
  readonly onConnect: (entry: PiProviderCatalogEntry) => void;
  readonly onDisconnect: (provider: PiProviderId) => void;
}) {
  const current = props.settingsPiProviders[props.entry.id];
  const enabled = current?.enabled ?? props.entry.enabled;
  const connected = current?.oauth?.connected === true;
  const expiresAt = formatExpiresAt(current?.oauth?.expiresAt);
  const hasRedactedApiKey = current?.apiKey?.valueRedacted === true;
  const displayedEntry = { ...props.entry, enabled };
  const hint = providerEnvironmentHint(displayedEntry);

  return (
    <div className="grid gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {props.entry.displayName}
          </h3>
          <span className="rounded-sm border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {KIND_LABEL[props.entry.kind]}
          </span>
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[11px]",
              props.entry.configured
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {props.entry.configured ? "Configured" : "Not configured"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{describeProviderState(displayedEntry)}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {props.entry.kind === "apiKey" ? (
          <ApiKeyControls
            entry={props.entry}
            hasRedactedApiKey={hasRedactedApiKey}
            onSave={props.onSaveApiKey}
          />
        ) : null}
        {props.entry.kind === "oauth" && connected ? (
          <p className="text-xs text-muted-foreground">
            Connected{expiresAt ? ` until ${expiresAt}` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <Switch
                checked={enabled}
                onCheckedChange={(checked) =>
                  props.onToggleEnabled(props.entry.id, Boolean(checked))
                }
                aria-label={`Enable ${props.entry.displayName} for PM picker`}
              />
            }
          />
          <TooltipPopup side="top">Available in the PM model provider picker</TooltipPopup>
        </Tooltip>
        {props.entry.kind === "oauth" ? (
          connected ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.onDisconnect(props.entry.id)}
            >
              <UnplugIcon className="size-3.5" />
              Disconnect
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => props.onConnect(props.entry)}>
              <LinkIcon className="size-3.5" />
              Connect
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

export function PiProviderSettingsSection() {
  const settings = useSettings((value) => ({ piProviders: value.piProviders }));
  const { updateSettings } = useUpdateSettings();
  const [catalog, setCatalog] = useState<ReadonlyArray<PiProviderCatalogEntry>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthEntry, setOAuthEntry] = useState<PiProviderCatalogEntry | null>(null);

  const loadCatalog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getPrimaryEnvironmentConnection().client.server.listPiProviderCatalog();
      setCatalog(result.providers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog, settings.piProviders]);

  const groupedCatalog = useMemo(
    () =>
      catalog.toSorted((left, right) => {
        const kindOrder = left.kind.localeCompare(right.kind);
        return kindOrder === 0 ? left.displayName.localeCompare(right.displayName) : kindOrder;
      }),
    [catalog],
  );

  const handleToggleEnabled = useCallback(
    (provider: PiProviderId, enabled: boolean) => {
      updateSettings(
        buildPiProviderEnabledPatch({
          settings,
          catalog,
          provider,
          enabled,
        }),
      );
    },
    [catalog, settings, updateSettings],
  );

  const handleSaveApiKey = useCallback(
    (provider: PiProviderId, value: string) => {
      updateSettings(
        buildPiProviderApiKeyPatch({
          settings,
          catalog,
          provider,
          value,
        }),
      );
    },
    [catalog, settings, updateSettings],
  );

  const handleDisconnectOAuth = useCallback(
    (provider: PiProviderId) => {
      updateSettings(
        buildPiProviderOAuthDisconnectedPatch({
          settings,
          catalog,
          provider,
        }),
      );
    },
    [catalog, settings, updateSettings],
  );

  return (
    <SettingsSection
      title="PM model providers (pi)"
      headerAction={
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="h-5 gap-1 rounded-sm px-1 text-[11px] font-normal text-muted-foreground/60 hover:text-muted-foreground"
          onClick={() => void loadCatalog()}
          disabled={isLoading}
        >
          <RefreshCwIcon className={cn("size-3", isLoading ? "animate-spin" : null)} />
          Refresh
        </Button>
      }
    >
      <div className="rounded-md border border-border/70 bg-background">
        {groupedCatalog.map((entry) => (
          <PiProviderRow
            key={entry.id}
            entry={entry}
            settingsPiProviders={settings.piProviders}
            catalog={catalog}
            onToggleEnabled={handleToggleEnabled}
            onSaveApiKey={handleSaveApiKey}
            onConnect={setOAuthEntry}
            onDisconnect={handleDisconnectOAuth}
          />
        ))}
        {groupedCatalog.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {isLoading ? "Loading pi providers…" : "No pi providers reported by this backend."}
          </div>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <PiOAuthLoginDialog
        entry={oauthEntry}
        onClose={() => setOAuthEntry(null)}
        onConnected={() => void loadCatalog()}
      />
    </SettingsSection>
  );
}
