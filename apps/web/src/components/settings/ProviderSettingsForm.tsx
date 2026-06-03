"use client";

import { useMemo, type ReactNode } from "react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type {
  CodexGedSubagentPreset,
  CodexGedSubagentPresetRole,
  ProviderSettingsFormAnnotation,
  ProviderSettingsFormControl,
  ProviderSettingsFormSchemaAnnotation,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  CODEX_GED_SUBAGENT_PRESET_ROLES,
  CODEX_GED_SUBAGENT_REASONING_LEVELS,
  DEFAULT_CODEX_GED_SUBAGENT_PRESET,
} from "@t3tools/contracts";
import { normalizeCodexGedSubagentPreset } from "@t3tools/shared/gedSubagentPreset";

import { cn } from "../../lib/utils";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import type { ProviderClientDefinition } from "./providerDriverMeta";

export interface ProviderSettingsFieldModel {
  readonly key: string;
  readonly control: ProviderSettingsFormControl;
  readonly label: string;
  readonly description?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly clearWhenEmpty: "omit" | "persist";
  readonly defaultBooleanValue?: boolean | undefined;
}

function titleizeFieldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function readFieldAnnotations(
  fieldSchema: ProviderClientDefinition["settingsSchema"]["fields"][string],
) {
  return Schema.resolveAnnotationsKey(fieldSchema) ?? Schema.resolveAnnotations(fieldSchema);
}

function readFieldAnnotationString(
  fieldSchema: ProviderClientDefinition["settingsSchema"]["fields"][string],
  key: "title" | "description",
): string | undefined {
  const annotations = readFieldAnnotations(fieldSchema);
  const value = annotations?.[key];
  return typeof value === "string" ? value : undefined;
}

function readProviderSettingsFormAnnotation(
  fieldSchema: ProviderClientDefinition["settingsSchema"]["fields"][string],
): ProviderSettingsFormAnnotation {
  const annotation = readFieldAnnotations(fieldSchema)?.providerSettingsForm;
  return annotation ?? {};
}

function readProviderSettingsFormSchemaAnnotation(
  definition: ProviderClientDefinition,
): ProviderSettingsFormSchemaAnnotation {
  return Schema.resolveAnnotations(definition.settingsSchema)?.providerSettingsFormSchema ?? {};
}

function readFieldBooleanDefault(
  fieldSchema: ProviderClientDefinition["settingsSchema"]["fields"][string],
): boolean | undefined {
  const decodeDefault = Schema.decodeUnknownOption(fieldSchema as Schema.Decoder<unknown>);
  const decoded = decodeDefault(undefined);
  return Option.isSome(decoded) && typeof decoded.value === "boolean" ? decoded.value : undefined;
}

export function deriveProviderSettingsFields(
  definition: ProviderClientDefinition,
): ReadonlyArray<ProviderSettingsFieldModel> {
  const schemaAnnotation = readProviderSettingsFormSchemaAnnotation(definition);
  const orderedKeys = new Map(
    (schemaAnnotation.order ?? []).map((key, index) => [key, index] as const),
  );
  const orderFallbackOffset = orderedKeys.size;

  return Object.keys(definition.settingsSchema.fields)
    .map((key, index) => ({ key, index }))
    .toSorted((left, right) => {
      return (
        (orderedKeys.get(left.key) ?? orderFallbackOffset + left.index) -
        (orderedKeys.get(right.key) ?? orderFallbackOffset + right.index)
      );
    })
    .flatMap(({ key }) => {
      const fieldSchema = definition.settingsSchema.fields[key]!;
      const formAnnotation = readProviderSettingsFormAnnotation(fieldSchema);
      if (formAnnotation.hidden) return [];

      const annotatedTitle = readFieldAnnotationString(fieldSchema, "title");
      const annotatedDescription = readFieldAnnotationString(fieldSchema, "description");
      return [
        {
          key,
          control: formAnnotation.control ?? "text",
          label: annotatedTitle ?? titleizeFieldKey(key),
          ...(annotatedDescription !== undefined ? { description: annotatedDescription } : {}),
          ...(formAnnotation.placeholder !== undefined
            ? { placeholder: formAnnotation.placeholder }
            : {}),
          clearWhenEmpty: formAnnotation.clearWhenEmpty ?? "omit",
          ...(formAnnotation.control === "switch"
            ? { defaultBooleanValue: readFieldBooleanDefault(fieldSchema) }
            : {}),
        } satisfies ProviderSettingsFieldModel,
      ];
    });
}

export function readProviderConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function readProviderConfigBoolean(
  config: unknown,
  key: string,
  defaultValue = false,
): boolean {
  if (config === null || typeof config !== "object") return defaultValue;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : defaultValue;
}

export function nextProviderConfigWithFieldValue(
  config: unknown,
  field: ProviderSettingsFieldModel,
  value: string | boolean | Record<string, unknown>,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};

  if (typeof value === "boolean") {
    const emptyBooleanValue = field.defaultBooleanValue ?? false;
    if (field.clearWhenEmpty === "omit" && value === emptyBooleanValue) {
      delete base[field.key];
    } else {
      base[field.key] = value;
    }
    return Object.keys(base).length > 0 ? base : undefined;
  }

  if (typeof value === "object") {
    base[field.key] = value;
    return Object.keys(base).length > 0 ? base : undefined;
  }

  const trimmed = value.trim();
  if (field.clearWhenEmpty === "omit" && trimmed.length === 0) {
    delete base[field.key];
  } else {
    base[field.key] = value;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

interface ProviderSettingsFormProps {
  readonly definition: ProviderClientDefinition;
  readonly value: unknown;
  readonly idPrefix: string;
  readonly variant: "card" | "dialog";
  readonly models?: ReadonlyArray<ServerProviderModel> | undefined;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

function FieldFrame(props: {
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly children: ReactNode;
}) {
  if (props.variant === "card") {
    return <div className="border-t border-border/60 px-4 py-3 sm:px-5">{props.children}</div>;
  }
  return <div className="grid gap-1.5">{props.children}</div>;
}

interface ProviderSettingsFieldRowProps {
  readonly field: ProviderSettingsFieldModel;
  readonly value: unknown;
  readonly idPrefix: string;
  readonly variant: ProviderSettingsFormProps["variant"];
  readonly models?: ReadonlyArray<ServerProviderModel> | undefined;
  readonly onChange: ProviderSettingsFormProps["onChange"];
}

function readCodexGedSubagentPresetConfig(config: unknown): CodexGedSubagentPreset {
  if (config === null || typeof config !== "object") {
    return normalizeCodexGedSubagentPreset(undefined);
  }
  const value = (config as Record<string, unknown>).gedSubagentPreset;
  return normalizeCodexGedSubagentPreset(
    value && typeof value === "object"
      ? (value as Partial<
          Record<
            CodexGedSubagentPresetRole,
            Partial<CodexGedSubagentPreset[CodexGedSubagentPresetRole]>
          >
        >)
      : undefined,
  );
}

function uniqueStrings(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function reasoningOptionsForModel(
  models: ReadonlyArray<ServerProviderModel> | undefined,
  modelSlug: string,
  currentReasoning: string,
): ReadonlyArray<string> {
  const descriptor = models
    ?.find((model) => model.slug === modelSlug)
    ?.capabilities?.optionDescriptors?.find(
      (option) => option.type === "select" && option.id === "reasoningEffort",
    );
  const descriptorValues =
    descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [];
  return uniqueStrings([
    ...descriptorValues,
    currentReasoning,
    ...CODEX_GED_SUBAGENT_REASONING_LEVELS,
  ]);
}

function CodexGedSubagentPresetPicker({
  field,
  value,
  idPrefix,
  variant,
  models,
  onChange,
}: ProviderSettingsFieldRowProps) {
  const preset = readCodexGedSubagentPresetConfig(value);
  const modelOptions = uniqueStrings([
    ...(models ?? []).map((model) => model.slug),
    ...CODEX_GED_SUBAGENT_PRESET_ROLES.map((role) => preset[role].model),
    ...CODEX_GED_SUBAGENT_PRESET_ROLES.map((role) => DEFAULT_CODEX_GED_SUBAGENT_PRESET[role].model),
  ]);

  const updateRole = (
    role: CodexGedSubagentPresetRole,
    next: Partial<CodexGedSubagentPreset[CodexGedSubagentPresetRole]>,
  ) => {
    const nextPreset = normalizeCodexGedSubagentPreset({
      ...preset,
      [role]: { ...preset[role], ...next },
    });
    onChange(nextProviderConfigWithFieldValue(value, field, nextPreset));
  };

  return (
    <FieldFrame variant={variant}>
      <div className="grid gap-2">
        <div>
          <span className="text-xs font-medium text-foreground">{field.label}</span>
          {field.description ? (
            <span
              className={cn(
                variant === "card"
                  ? "mt-1 block text-xs text-muted-foreground"
                  : "text-[11px] text-muted-foreground",
              )}
            >
              {field.description}
            </span>
          ) : null}
        </div>
        <div className="grid gap-2">
          {CODEX_GED_SUBAGENT_PRESET_ROLES.map((role) => {
            const rolePreset = preset[role];
            const reasoningOptions = reasoningOptionsForModel(
              models,
              rolePreset.model,
              rolePreset.reasoning,
            );
            return (
              <div
                key={role}
                className="grid gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2 sm:grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.4fr)_minmax(7rem,0.8fr)] sm:items-center"
              >
                <label
                  htmlFor={`${idPrefix}-${field.key}-${role}-model`}
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  {role}
                </label>
                <select
                  id={`${idPrefix}-${field.key}-${role}-model`}
                  className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={rolePreset.model}
                  onChange={(event) => updateRole(role, { model: event.target.value })}
                >
                  {modelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${role} reasoning`}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={rolePreset.reasoning}
                  onChange={(event) =>
                    updateRole(role, {
                      reasoning: event.target
                        .value as CodexGedSubagentPreset[CodexGedSubagentPresetRole]["reasoning"],
                    })
                  }
                >
                  {reasoningOptions.map((reasoning) => (
                    <option key={reasoning} value={reasoning}>
                      {reasoning}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </FieldFrame>
  );
}

function ProviderSettingsFieldRow({
  field,
  value,
  idPrefix,
  variant,
  models,
  onChange,
}: ProviderSettingsFieldRowProps) {
  const inputId = `${idPrefix}-${field.key}`;
  const descriptionClassName =
    variant === "card"
      ? "mt-1 block text-xs text-muted-foreground"
      : "text-[11px] text-muted-foreground";
  const label = <span className="text-xs font-medium text-foreground">{field.label}</span>;
  const description = field.description ? (
    <span className={descriptionClassName}>{field.description}</span>
  ) : null;

  if (field.control === "switch") {
    return (
      <FieldFrame variant={variant}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {label}
            {description}
          </div>
          <Switch
            checked={readProviderConfigBoolean(value, field.key, field.defaultBooleanValue)}
            onCheckedChange={(checked) =>
              onChange(nextProviderConfigWithFieldValue(value, field, Boolean(checked)))
            }
            aria-label={field.label}
          />
        </div>
      </FieldFrame>
    );
  }

  if (field.control === "textarea") {
    return (
      <FieldFrame variant={variant}>
        <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
          {label}
          <Textarea
            id={inputId}
            className={cn(variant === "card" && "mt-1.5")}
            value={readProviderConfigString(value, field.key)}
            onChange={(event) =>
              onChange(nextProviderConfigWithFieldValue(value, field, event.target.value))
            }
            placeholder={field.placeholder}
            spellCheck={false}
          />
          {description}
        </label>
      </FieldFrame>
    );
  }

  if (field.control === "codexGedSubagentPreset") {
    return (
      <CodexGedSubagentPresetPicker
        field={field}
        value={value}
        idPrefix={idPrefix}
        variant={variant}
        models={models}
        onChange={onChange}
      />
    );
  }

  const type = field.control === "password" ? "password" : undefined;
  return (
    <FieldFrame variant={variant}>
      <label htmlFor={inputId} className={cn(variant === "card" && "block")}>
        {label}
        {variant === "card" ? (
          <DraftInput
            id={inputId}
            className="mt-1.5"
            type={type}
            autoComplete={field.control === "password" ? "off" : undefined}
            value={readProviderConfigString(value, field.key)}
            onCommit={(next) => onChange(nextProviderConfigWithFieldValue(value, field, next))}
            placeholder={field.placeholder}
            spellCheck={false}
          />
        ) : (
          <Input
            id={inputId}
            className="bg-background"
            type={type}
            autoComplete={field.control === "password" ? "off" : undefined}
            value={readProviderConfigString(value, field.key)}
            onChange={(event) =>
              onChange(nextProviderConfigWithFieldValue(value, field, event.target.value))
            }
            placeholder={field.placeholder}
            spellCheck={false}
          />
        )}
        {description}
      </label>
    </FieldFrame>
  );
}

export function ProviderSettingsForm({
  definition,
  value,
  idPrefix,
  variant,
  models,
  onChange,
}: ProviderSettingsFormProps) {
  const fields = useMemo(() => deriveProviderSettingsFields(definition), [definition]);

  if (fields.length === 0) {
    return null;
  }

  return (
    <>
      {fields.map((field) => (
        <ProviderSettingsFieldRow
          key={field.key}
          field={field}
          value={value}
          idPrefix={idPrefix}
          variant={variant}
          models={models}
          onChange={onChange}
        />
      ))}
    </>
  );
}
