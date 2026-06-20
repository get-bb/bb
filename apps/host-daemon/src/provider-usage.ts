import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  getChatGptCloudflareCookieHeader,
  storeChatGptCloudflareCookies,
} from "./chatgpt-cloudflare-cookies.js";
import { readCodexAuthCredentials } from "./codex-auth.js";
import { ExpectedCommandDispatchError } from "./command-dispatch-support.js";

const USAGE_FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function epochSecondsToIso(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function normalizeIsoTimestamp(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// ---------------------------------------------------------------------------
// Codex (ChatGPT subscription) usage
// ---------------------------------------------------------------------------

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const codexUsageWindowSchema = z.object({
  used_percent: z.number(),
  reset_at: z.number().nullish(),
  limit_window_seconds: z.number().nullish(),
});

const codexUsageResponseSchema = z.object({
  plan_type: z.string().nullish(),
  rate_limit: z
    .object({
      primary_window: codexUsageWindowSchema.nullish(),
      secondary_window: codexUsageWindowSchema.nullish(),
    })
    .nullish(),
});

const CODEX_PLAN_LABELS: Record<string, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
  business: "Business",
  education: "Education",
  edu: "Education",
  enterprise: "Enterprise",
};

function codexPlanLabel(planType: string | null | undefined): string | null {
  if (!planType) {
    return null;
  }
  return (
    CODEX_PLAN_LABELS[planType] ??
    planType.charAt(0).toUpperCase() + planType.slice(1)
  );
}

function codexWindow(
  window: z.infer<typeof codexUsageWindowSchema> | null | undefined,
  label: string,
): ProviderUsageWindow | null {
  if (!window) {
    return null;
  }
  return {
    label,
    usedPercent: clampPercent(window.used_percent),
    resetsAt: epochSecondsToIso(window.reset_at),
  };
}

async function fetchChatGptUsage(headers: Headers): Promise<Response> {
  const doFetch = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    const cookie = getChatGptCloudflareCookieHeader(CODEX_USAGE_URL);
    if (cookie) {
      requestHeaders.set("Cookie", cookie);
    }
    const response = await fetch(CODEX_USAGE_URL, {
      method: "GET",
      headers: requestHeaders,
      signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
    });
    storeChatGptCloudflareCookies(CODEX_USAGE_URL, response.headers);
    return response;
  };

  const response = await doFetch();
  if (
    response.status === 403 &&
    response.headers.get("cf-mitigated")?.toLowerCase() === "challenge"
  ) {
    // Cloudflare handed us a fresh clearance cookie; retry once with it.
    return doFetch();
  }
  return response;
}

function normalizeCodexUsage(raw: unknown): ProviderUsage {
  const parsed = codexUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Codex usage response was malformed." };
  }

  const windows = [
    codexWindow(parsed.data.rate_limit?.primary_window, "Current session"),
    codexWindow(parsed.data.rate_limit?.secondary_window, "Weekly limit"),
  ].filter((window): window is ProviderUsageWindow => window !== null);

  return {
    status: "ok",
    planLabel: codexPlanLabel(parsed.data.plan_type),
    windows,
  };
}

async function fetchCodexUsage(): Promise<ProviderUsage> {
  let credentials;
  try {
    credentials = await readCodexAuthCredentials();
  } catch (error) {
    // Missing file (never logged in) and invalid/empty credentials (logged out,
    // or tokens cleared) both mean "sign in to Codex" rather than a hard error.
    if (
      error instanceof ExpectedCommandDispatchError &&
      (error.code === "codex_auth_missing" ||
        error.code === "codex_auth_invalid")
    ) {
      return { status: "unauthenticated" };
    }
    return { status: "error", message: errorMessage(error) };
  }

  if (credentials.type === "apiKey") {
    return {
      status: "error",
      message:
        "Codex is authenticated with an API key, which has no subscription usage limits.",
    };
  }

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  headers.set("chatgpt-account-id", credentials.accountId);
  headers.set("originator", "bb");
  headers.set("User-Agent", "bb-host-daemon");
  headers.set("Accept", "application/json");
  if (credentials.isFedrampAccount) {
    headers.set("X-OpenAI-Fedramp", "true");
  }

  const response = await fetchChatGptUsage(headers);
  if (response.status === 401) {
    return { status: "expired" };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `Codex usage request failed (HTTP ${response.status}).`,
    };
  }

  return normalizeCodexUsage(await response.json());
}

// ---------------------------------------------------------------------------
// Claude Code (Anthropic OAuth) usage
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_USER_AGENT = "claude-code/2.1.0";

const claudeCredentialsSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    expiresAt: z.number().nullish(),
    subscriptionType: z.string().nullish(),
    rateLimitTier: z.string().nullish(),
  }),
});
type ClaudeCredentials = z.infer<
  typeof claudeCredentialsSchema
>["claudeAiOauth"];

const claudeUsageWindowSchema = z.object({
  utilization: z.number().nullish(),
  resets_at: z.string().nullish(),
});

const claudeUsageResponseSchema = z
  .object({
    five_hour: claudeUsageWindowSchema.nullish(),
    seven_day: claudeUsageWindowSchema.nullish(),
  })
  .passthrough();

async function readClaudeKeychainCredentials(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const argumentSets = [
    [
      "find-generic-password",
      "-s",
      CLAUDE_KEYCHAIN_SERVICE,
      "-a",
      os.userInfo().username,
      "-w",
    ],
    ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
  ];
  for (const args of argumentSets) {
    try {
      const { stdout } = await execFileAsync("security", args, {
        timeout: 10_000,
      });
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    } catch {
      // Try the next lookup, then fall back to the credentials file.
    }
  }
  return null;
}

async function readClaudeFileCredentials(): Promise<string | null> {
  try {
    return await fs.readFile(
      path.join(os.homedir(), ".claude", ".credentials.json"),
      "utf8",
    );
  } catch {
    return null;
  }
}

async function readClaudeCredentials(): Promise<ClaudeCredentials | null> {
  const raw =
    (await readClaudeKeychainCredentials()) ??
    (await readClaudeFileCredentials());
  if (!raw) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = claudeCredentialsSchema.safeParse(json);
  return parsed.success ? parsed.data.claudeAiOauth : null;
}

function claudePlanLabel(credentials: ClaudeCredentials): string | null {
  const tier = credentials.rateLimitTier ?? "";
  const maxMatch = tier.match(/max_(\d+)x/u);
  if (maxMatch) {
    return `Max (${maxMatch[1]}x)`;
  }
  const subscription = credentials.subscriptionType;
  if (subscription) {
    return subscription.charAt(0).toUpperCase() + subscription.slice(1);
  }
  return null;
}

function claudeWindow(
  window: z.infer<typeof claudeUsageWindowSchema> | null | undefined,
  label: string,
): ProviderUsageWindow | null {
  if (!window || window.utilization == null) {
    return null;
  }
  return {
    label,
    usedPercent: clampPercent(window.utilization),
    resetsAt: normalizeIsoTimestamp(window.resets_at),
  };
}

function normalizeClaudeUsage(
  raw: unknown,
  credentials: ClaudeCredentials,
): ProviderUsage {
  const parsed = claudeUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Claude usage response was malformed." };
  }

  const windows = [
    claudeWindow(parsed.data.five_hour, "Current session"),
    claudeWindow(parsed.data.seven_day, "Weekly limit"),
  ].filter((window): window is ProviderUsageWindow => window !== null);

  return {
    status: "ok",
    planLabel: claudePlanLabel(credentials),
    windows,
  };
}

async function fetchClaudeUsage(): Promise<ProviderUsage> {
  const credentials = await readClaudeCredentials();
  if (!credentials) {
    return { status: "unauthenticated" };
  }
  if (credentials.expiresAt != null && Date.now() >= credentials.expiresAt) {
    // The Claude CLI owns these tokens and refreshes them on its own next run;
    // refreshing here risks rotating its refresh token out from under it.
    return { status: "expired" };
  }

  const response = await fetch(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "User-Agent": CLAUDE_USER_AGENT,
    },
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  });

  if (response.status === 401) {
    return { status: "expired" };
  }
  if (response.status === 429) {
    return {
      status: "error",
      message: "Claude usage is rate limited right now. Try again shortly.",
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      message: `Claude usage request failed (HTTP ${response.status}).`,
    };
  }

  return normalizeClaudeUsage(await response.json(), credentials);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Reads live usage/rate-limit snapshots for the local Codex and Claude Code
 * subscriptions. Each provider resolves independently so one failing never
 * blanks the other. Tokens are read from the providers' own credential stores
 * and used as-is — we never refresh another tool's tokens.
 */
export async function getProviderUsage(): Promise<ProviderUsageResponse> {
  const [codex, claudeCode] = await Promise.all([
    fetchCodexUsage().catch(
      (error): ProviderUsage => ({
        status: "error",
        message: errorMessage(error),
      }),
    ),
    fetchClaudeUsage().catch(
      (error): ProviderUsage => ({
        status: "error",
        message: errorMessage(error),
      }),
    ),
  ]);
  return { codex, claudeCode };
}

export const __testing = {
  normalizeCodexUsage,
  normalizeClaudeUsage,
  codexPlanLabel,
  claudePlanLabel,
};
