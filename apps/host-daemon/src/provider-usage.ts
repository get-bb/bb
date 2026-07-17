import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
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
import { isProviderCliInstalled } from "./provider-cli-health.js";

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

function epochMillisecondsToIso(
  milliseconds: number | null | undefined,
): string | null {
  if (milliseconds == null || !Number.isFinite(milliseconds)) {
    return null;
  }
  return new Date(milliseconds).toISOString();
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

function normalizeCodexUsage(
  raw: unknown,
  accountEmail: string | null = null,
): ProviderUsage {
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
    accountEmail,
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

  return normalizeCodexUsage(await response.json(), credentials.accountEmail);
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

const claudeAccountSchema = z.object({
  oauthAccount: z
    .object({ emailAddress: z.string().email().nullish() })
    .nullish(),
});

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

async function readClaudeAccountEmail(): Promise<string | null> {
  try {
    const raw = await fs.readFile(
      path.join(os.homedir(), ".claude.json"),
      "utf8",
    );
    const parsed = claudeAccountSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? (parsed.data.oauthAccount?.emailAddress ?? null)
      : null;
  } catch {
    return null;
  }
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
  accountEmail: string | null = null,
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
    accountEmail,
    planLabel: claudePlanLabel(credentials),
    windows,
  };
}

async function fetchClaudeUsage(): Promise<ProviderUsage> {
  const [credentials, accountEmail] = await Promise.all([
    readClaudeCredentials(),
    readClaudeAccountEmail(),
  ]);
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

  return normalizeClaudeUsage(await response.json(), credentials, accountEmail);
}

// ---------------------------------------------------------------------------
// Cursor (Cursor subscription)
// ---------------------------------------------------------------------------

const CURSOR_DASHBOARD_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService";
const CURSOR_KEYCHAIN_ACCOUNT = "cursor-user";
const CURSOR_ACCESS_TOKEN_SERVICE = "cursor-access-token";

const cursorNonNegativeIntegerSchema = z
  .union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/u).transform(Number),
  ])
  .refine(Number.isSafeInteger);

const cursorPlanUsageSchema = z.object({
  // Connect's JSON encoding omits scalar zero values.
  totalPercentUsed: z.number().nonnegative().default(0),
});

const cursorSpendLimitUsageSchema = z.object({
  overallLimit: cursorNonNegativeIntegerSchema.nullish(),
  overallUsed: cursorNonNegativeIntegerSchema.nullish(),
  individualLimit: cursorNonNegativeIntegerSchema.nullish(),
  individualUsed: cursorNonNegativeIntegerSchema.nullish(),
  pooledLimit: cursorNonNegativeIntegerSchema.nullish(),
  pooledUsed: cursorNonNegativeIntegerSchema.nullish(),
});

const cursorCurrentPeriodUsageSchema = z
  .object({
    billingCycleEnd: cursorNonNegativeIntegerSchema.nullish(),
    planUsage: cursorPlanUsageSchema.nullish(),
    spendLimitUsage: cursorSpendLimitUsageSchema.nullish(),
  })
  .passthrough();

const cursorPlanInfoSchema = z
  .object({
    planInfo: z
      .object({
        planName: z.string().min(1),
      })
      .nullish(),
  })
  .passthrough();

const cursorFileCredentialsSchema = z.object({
  accessToken: z.string().min(1).nullish(),
});

const cursorCachedEmailSchema = z.string().email();

function cursorAuthFilePath(): string {
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "auth.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), ".cursor", "auth.json");
  }
  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "cursor", "auth.json");
}

async function readCursorKeychainAccessToken(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "security",
      [
        "find-generic-password",
        "-s",
        CURSOR_ACCESS_TOKEN_SERVICE,
        "-a",
        CURSOR_KEYCHAIN_ACCOUNT,
        "-w",
      ],
      { timeout: 10_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readCursorFileAccessToken(): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(cursorAuthFilePath(), "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = cursorFileCredentialsSchema.safeParse(json);
  return parsed.success ? (parsed.data.accessToken ?? null) : null;
}

async function readCursorAccessToken(): Promise<string | null> {
  return (
    (await readCursorKeychainAccessToken()) ??
    (await readCursorFileAccessToken())
  );
}

function cursorStateDatabasePath(): string {
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  const configHome =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(
    configHome,
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

function readCursorAccountEmailFromDatabase(
  databasePath: string,
): string | null {
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, {
      fileMustExist: true,
      readonly: true,
    });
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("cursorAuth/cachedEmail");
    const parsed = z.object({ value: z.string() }).safeParse(row);
    if (!parsed.success) {
      return null;
    }
    const email = cursorCachedEmailSchema.safeParse(parsed.data.value);
    return email.success ? email.data : null;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

function readCursorAccountEmail(): string | null {
  return readCursorAccountEmailFromDatabase(cursorStateDatabasePath());
}

interface CursorSpendUsageWindowArgs {
  label: string;
  used: number | null | undefined;
  limit: number | null | undefined;
  resetsAt: string | null;
}

function cursorSpendUsageWindow(
  args: CursorSpendUsageWindowArgs,
): ProviderUsageWindow | null {
  if (args.used == null || args.limit == null || args.limit <= 0) {
    return null;
  }
  return {
    label: args.label,
    usedPercent: clampPercent((args.used / args.limit) * 100),
    resetsAt: args.resetsAt,
    cost: {
      usedUsdCents: args.used,
      limitUsdCents: args.limit,
    },
  };
}

function cursorPlanUsageWindow(
  usedPercent: number | null | undefined,
  resetsAt: string | null,
): ProviderUsageWindow | null {
  if (usedPercent == null) {
    return null;
  }
  return {
    label: "Plan usage",
    usedPercent: clampPercent(usedPercent),
    resetsAt,
  };
}

function normalizeCursorUsage(
  rawUsage: unknown,
  rawPlan: unknown,
  accountEmail: string | null = null,
): ProviderUsage {
  const usage = cursorCurrentPeriodUsageSchema.safeParse(rawUsage);
  if (!usage.success) {
    return { status: "error", message: "Cursor usage response was malformed." };
  }
  const plan = cursorPlanInfoSchema.safeParse(rawPlan);
  const resetsAt = epochMillisecondsToIso(usage.data.billingCycleEnd);
  const spendLimit = usage.data.spendLimitUsage;
  const spendLimitPair =
    spendLimit?.overallLimit != null
      ? { limit: spendLimit.overallLimit, used: spendLimit.overallUsed ?? 0 }
      : spendLimit?.individualLimit != null
        ? {
            limit: spendLimit.individualLimit,
            used: spendLimit.individualUsed ?? 0,
          }
        : spendLimit?.pooledLimit != null
          ? { limit: spendLimit.pooledLimit, used: spendLimit.pooledUsed ?? 0 }
          : null;
  const windows = [
    cursorPlanUsageWindow(usage.data.planUsage?.totalPercentUsed, resetsAt),
    cursorSpendUsageWindow({
      label: "On-demand spend",
      used: spendLimitPair?.used,
      limit: spendLimitPair?.limit,
      resetsAt,
    }),
  ].filter((window): window is ProviderUsageWindow => window !== null);

  return {
    status: "ok",
    accountEmail,
    planLabel: plan.success ? (plan.data.planInfo?.planName ?? null) : null,
    windows,
  };
}

type CursorDashboardMethod = "GetCurrentPeriodUsage" | "GetPlanInfo";

function fetchCursorDashboard(
  method: CursorDashboardMethod,
  accessToken: string,
): Promise<Response> {
  // Cursor has no personal-usage CLI command or public individual API. These
  // authenticated Connect RPCs are the same dashboard methods shipped in the
  // Cursor CLI, so keep their response parsing isolated at this boundary.
  return fetch(`${CURSOR_DASHBOARD_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-type": "cli",
      "x-cursor-client-version": "cli-bb-host-daemon",
    },
    body: "{}",
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  });
}

async function fetchCursorUsage(): Promise<ProviderUsage> {
  if (!(await isProviderCliInstalled("cursor"))) {
    return { status: "not_installed" };
  }

  const accessToken = await readCursorAccessToken();
  if (!accessToken) {
    return { status: "unauthenticated" };
  }

  const [usageResponse, planResponse] = await Promise.all([
    fetchCursorDashboard("GetCurrentPeriodUsage", accessToken),
    fetchCursorDashboard("GetPlanInfo", accessToken),
  ]);
  if (usageResponse.status === 401 || planResponse.status === 401) {
    return { status: "expired" };
  }
  if (!usageResponse.ok) {
    return {
      status: "error",
      message: `Cursor usage request failed (HTTP ${usageResponse.status}).`,
    };
  }

  const rawPlan: unknown = planResponse.ok ? await planResponse.json() : {};
  return normalizeCursorUsage(
    await usageResponse.json(),
    rawPlan,
    readCursorAccountEmail(),
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Reads live usage/rate-limit snapshots for local Codex, Claude Code, and
 * Cursor subscriptions. Each provider resolves independently so one failing
 * never blanks the others. Tokens are read from the providers' own credential
 * stores and used as-is — we never refresh another tool's tokens.
 */
export async function getProviderUsage(): Promise<ProviderUsageResponse> {
  const [codex, claudeCode, cursor] = await Promise.all([
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
    fetchCursorUsage().catch(
      (error): ProviderUsage => ({
        status: "error",
        message: errorMessage(error),
      }),
    ),
  ]);
  return { codex, claudeCode, cursor };
}

export const __testing = {
  normalizeCodexUsage,
  normalizeClaudeUsage,
  normalizeCursorUsage,
  codexPlanLabel,
  claudePlanLabel,
  readCursorAccountEmailFromDatabase,
};
