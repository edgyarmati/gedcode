import {
  type PiProviderCatalogEntry,
  type PiProviderCatalogKind,
  PiProviderId,
  type PiProviderConfig,
  type PiProviderCatalogResult,
  type PiProviderModelsResult,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  findEnvKeys,
  getEnvApiKey,
  getModels,
  getProviders,
  type KnownProvider,
} from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";

const AMBIENT_PROVIDERS = new Set<string>(["amazon-bedrock", "google-vertex"]);

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "amazon-bedrock": "Amazon Bedrock",
  "ant-ling": "Ant Ling",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  cerebras: "Cerebras",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  "google-vertex": "Google Vertex AI",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi Coding",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax China",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI China",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  together: "Together",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  xiaomi: "Xiaomi",
  "xiaomi-token-plan-ams": "Xiaomi Token Plan AMS",
  "xiaomi-token-plan-cn": "Xiaomi Token Plan China",
  "xiaomi-token-plan-sgp": "Xiaomi Token Plan Singapore",
  zai: "Z.ai",
  "zai-coding-cn": "Z.ai Coding China",
};

function humanizeProviderId(provider: string): string {
  return (
    DISPLAY_NAMES[provider] ??
    provider
      .split("-")
      .map((part) => (part ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : part))
      .join(" ")
  );
}

function getOAuthProviderIds(): Set<string> {
  return new Set(getOAuthProviders().map((provider) => provider.id));
}

export function getPiProviderKind(provider: string): PiProviderCatalogKind {
  if (getOAuthProviderIds().has(provider)) {
    return "oauth";
  }
  if (AMBIENT_PROVIDERS.has(provider)) {
    return "ambient";
  }
  return "apiKey";
}

function isPiProviderConfigured(input: {
  readonly provider: string;
  readonly kind: PiProviderCatalogKind;
  readonly settings: ServerSettings;
}): boolean {
  const config = (input.settings.piProviders as Record<string, PiProviderConfig | undefined>)[
    input.provider
  ];
  if (input.kind === "oauth") {
    return config?.oauth?.connected === true;
  }
  if (input.kind === "ambient") {
    return getEnvApiKey(input.provider) === "<authenticated>";
  }
  return (config?.apiKey?.value.length ?? 0) > 0 || config?.apiKey?.valueRedacted === true;
}

export function listPiProviderCatalog(settings: ServerSettings): PiProviderCatalogResult {
  const providers: PiProviderCatalogEntry[] = getProviders().map((provider) => {
    const kind = getPiProviderKind(provider);
    const envKeys = findEnvKeys(provider);
    const config = (settings.piProviders as Record<string, PiProviderConfig | undefined>)[provider];
    const entry = {
      id: PiProviderId.make(provider),
      displayName: humanizeProviderId(provider),
      kind,
      configured: isPiProviderConfigured({ provider, kind, settings }),
      enabled: config?.enabled ?? false,
    };
    return (
      envKeys && envKeys.length > 0 ? Object.assign(entry, { envKeys }) : entry
    ) satisfies PiProviderCatalogEntry;
  });

  return { providers };
}

export function listPiProviderModels(provider: string): PiProviderModelsResult {
  return {
    models: getModels(provider as KnownProvider).map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
    })),
  };
}
