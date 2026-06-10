import { matchers, routes, type Transform, type VercelConfig } from "@vercel/config/v1";

const DEFAULT_HOSTED_APP_URL = "https://app.t3.codes";
const DEFAULT_LATEST_ORIGIN = "https://latest.app.t3.codes";
const DEFAULT_NIGHTLY_ORIGIN = "https://nightly.app.t3.codes";

function trimmedEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function originHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function defaultRouterHost(): string {
  const host = originHost(DEFAULT_HOSTED_APP_URL);
  if (host === null) {
    throw new Error("Default hosted app URL is invalid.");
  }
  return host;
}

function configuredHostedAppUrl(): string {
  const value = trimmedEnv("VITE_HOSTED_APP_URL");
  if (!value) {
    return DEFAULT_HOSTED_APP_URL;
  }
  if (originHost(value) === null) {
    throw new Error("VITE_HOSTED_APP_URL must be an absolute URL.");
  }
  return value;
}

function configuredOrigin(name: string, fallback: string): string {
  const value = trimmedEnv(name) || fallback;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

const HOSTED_APP_URL = configuredHostedAppUrl();
const ROUTER_HOST =
  trimmedEnv("HOSTED_WEB_ROUTER_HOST") || originHost(HOSTED_APP_URL) || defaultRouterHost();
const HOSTED_WEB_CHANNEL_COOKIE = trimmedEnv("HOSTED_WEB_CHANNEL_COOKIE") || "t3code_web_channel";
const LATEST_ORIGIN = configuredOrigin("HOSTED_WEB_LATEST_ORIGIN", DEFAULT_LATEST_ORIGIN);
const NIGHTLY_ORIGIN = configuredOrigin("HOSTED_WEB_NIGHTLY_ORIGIN", DEFAULT_NIGHTLY_ORIGIN);
if (originHost(LATEST_ORIGIN) === ROUTER_HOST || originHost(NIGHTLY_ORIGIN) === ROUTER_HOST) {
  throw new Error("Hosted web channel origins must not point at the router host.");
}
const CLEAN_CHANNEL_QUERY_TRANSFORMS = [
  {
    type: "request.query",
    op: "delete",
    target: { key: "channel" },
  },
] satisfies Transform[];

function channelCookie(channel: "latest" | "nightly"): string {
  return [
    `${HOSTED_WEB_CHANNEL_COOKIE}=${channel}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export const config: VercelConfig = {
  buildCommand:
    'turbo build --filter @t3tools/web && bun ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "bun add -g turbo && bun install --filter '@t3tools/contracts' --filter '@t3tools/client-runtime' --filter '@t3tools/scripts' --filter '@t3tools/web'",
  routes: [
    {
      src: "/__t3code/channel",
      has: [matchers.query("channel", "nightly")],
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("nightly"),
      },
      status: 302,
    },
    {
      src: "/__t3code/channel",
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("latest"),
      },
      status: 302,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST), matchers.cookie(HOSTED_WEB_CHANNEL_COOKIE, "nightly")],
      dest: `${NIGHTLY_ORIGIN}/$1`,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST)],
      dest: `${LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
