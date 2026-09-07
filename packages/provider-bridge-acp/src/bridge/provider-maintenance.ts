import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type {
  ProviderHealthResult,
  ProviderInstallationRunResult,
  ProviderInstallationStatus,
  ProviderUsage,
  ProviderUsageResult,
  ProviderUsageWindow,
} from "@bb/provider-bridge-protocol";
import {
  clampPercent,
  downloadedInstallerCommand,
  readCliVersion,
  resolveExecutablePath,
} from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const USAGE_FETCH_TIMEOUT_MS = 15_000;
const CURSOR_DASHBOARD_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService";
const CURSOR_KEYCHAIN_ACCOUNT = "cursor-user";
const CURSOR_ACCESS_TOKEN_SERVICE = "cursor-access-token";
const CURSOR_INSTALL_SCRIPT_URL = "https://cursor.com/install";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const GROK_BILLING_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const GROK_SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings";

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

async function readKeychainAccessToken(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
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

const cursorFileCredentialsSchema = z.object({
  accessToken: z.string().min(1).nullish(),
});

async function readAccessToken(): Promise<string | null> {
  const keychain = await readKeychainAccessToken();
  if (keychain) return keychain;
  try {
    const parsed = cursorFileCredentialsSchema.safeParse(
      JSON.parse(await fs.readFile(cursorAuthFilePath(), "utf8")),
    );
    return parsed.success ? (parsed.data.accessToken ?? null) : null;
  } catch {
    return null;
  }
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

function readAccountEmail(): string | null {
  const databasePath = cursorStateDatabasePath();
  if (!existsSync(databasePath)) return null;
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA query_only = true");
    const row = database
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get("cursorAuth/cachedEmail");
    const parsed = z.object({ value: z.string().email() }).safeParse(row);
    return parsed.success ? parsed.data.value : null;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

export interface AcpMaintenanceDialect {
  loginCommand?: string;
  installer?(): { command: string; args: string[]; displayCommand: string };
  readAccount?(): Promise<{ email: string | null } | null>;
  readUsage?(): Promise<ProviderUsageResult>;
}

function healthResult(args: {
  maintenance: AcpMaintenanceDialect | undefined;
  status: "ready" | "not_installed" | "unauthenticated" | "unknown";
  accountEmail?: string | null;
  installedVersion?: string | null;
  statusMessage?: string | null;
}): ProviderHealthResult {
  const installable = args.maintenance?.installer !== undefined;
  return {
    supported: true,
    health: {
      status: args.status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: args.accountEmail ?? null,
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: installable,
      canUpdate: installable && args.status !== "not_installed",
      loginCommand: args.maintenance?.loginCommand ?? null,
    },
  };
}

export async function getAcpProviderHealth(args: {
  maintenance: AcpMaintenanceDialect | undefined;
  command: string | null;
}): Promise<ProviderHealthResult> {
  const maintenance = args.maintenance;
  if (args.command === null) {
    return healthResult({
      maintenance,
      status: "unknown",
      statusMessage: "The ACP provider has no launch command.",
    });
  }
  if ((await resolveExecutablePath(args.command)) === null) {
    return healthResult({ maintenance, status: "not_installed" });
  }
  const version = await readCliVersion(args.command);
  if (maintenance?.readAccount === undefined) {
    return healthResult({
      maintenance,
      status: "ready",
      installedVersion: version,
    });
  }
  try {
    const account = await maintenance.readAccount();
    return healthResult({
      maintenance,
      status: account === null ? "unauthenticated" : "ready",
      accountEmail: account?.email ?? null,
      installedVersion: version,
    });
  } catch (error) {
    return healthResult({
      maintenance,
      status: "unknown",
      installedVersion: version,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getAcpProviderInstallationStatus(args: {
  maintenance: AcpMaintenanceDialect | undefined;
  command: string | null;
}): Promise<ProviderInstallationStatus> {
  const executableName = args.command ?? "";
  const resolvedExecutable =
    args.command === null ? null : await resolveExecutablePath(args.command);
  const installed = resolvedExecutable !== null;
  const currentVersion =
    installed && args.command !== null
      ? await readCliVersion(args.command)
      : null;
  const installAction =
    args.maintenance?.installer !== undefined && !installed
      ? {
          kind: "install" as const,
          label: "Install" as const,
          command: args.maintenance.installer().displayCommand,
        }
      : null;
  return {
    executableName,
    executablePath: resolvedExecutable,
    installed,
    installSource: installed ? "external" : "notInstalled",
    currentVersion,
    latestVersion: null,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction,
    needsUpdate: false,
    versionUnsupported: false,
  };
}

export async function getAcpProviderInstallationRun(args: {
  maintenance: AcpMaintenanceDialect | undefined;
  command: string | null;
  action: "install" | "update";
}): Promise<ProviderInstallationRunResult> {
  const status = await getAcpProviderInstallationStatus(args);
  return buildAcpProviderInstallationRun(status, args);
}

function buildAcpProviderInstallationRun(
  status: ProviderInstallationStatus,
  args: {
    maintenance: AcpMaintenanceDialect | undefined;
    command: string | null;
    action: "install" | "update";
  },
): ProviderInstallationRunResult {
  if (
    status.installAction?.kind !== args.action ||
    args.maintenance?.installer === undefined
  ) {
    return {
      available: false,
      message: `${args.command ?? "This ACP agent"} ${args.action} is not available on this host.`,
    };
  }
  return {
    available: true,
    command: args.maintenance.installer(),
    verification: { kind: "installed" },
  };
}

const cursorNonNegativeIntegerSchema = z
  .union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/u).transform(Number),
  ])
  .refine(Number.isSafeInteger);

const cursorPercentSchema = z
  .union([
    z.number().nonnegative(),
    z
      .string()
      .regex(/^\d+(\.\d+)?$/u)
      .transform(Number),
  ])
  .refine(Number.isFinite);

const cursorUsageResponseSchema = z
  .object({
    billingCycleEnd: cursorNonNegativeIntegerSchema.nullish(),
    planUsage: z
      .object({
        autoPercentUsed: cursorPercentSchema.nullish(),
        apiPercentUsed: cursorPercentSchema.nullish(),
        totalPercentUsed: cursorPercentSchema.nullish(),
        totalSpend: cursorNonNegativeIntegerSchema.nullish(),
        includedSpend: cursorNonNegativeIntegerSchema.nullish(),
        bonusSpend: cursorNonNegativeIntegerSchema.nullish(),
        limit: cursorNonNegativeIntegerSchema.nullish(),
      })
      .nullish(),
    spendLimitUsage: z
      .object({
        overallLimit: cursorNonNegativeIntegerSchema.nullish(),
        overallUsed: cursorNonNegativeIntegerSchema.nullish(),
        individualLimit: cursorNonNegativeIntegerSchema.nullish(),
        individualUsed: cursorNonNegativeIntegerSchema.nullish(),
        pooledLimit: cursorNonNegativeIntegerSchema.nullish(),
        pooledUsed: cursorNonNegativeIntegerSchema.nullish(),
      })
      .nullish(),
  })
  .passthrough();

const cursorPlanResponseSchema = z
  .object({
    planInfo: z.object({ planName: z.string().min(1) }).nullish(),
  })
  .passthrough();

function normalizeUsage(
  rawUsage: unknown,
  rawPlan: unknown,
  accountEmail: string | null = null,
): ProviderUsage {
  const usage = cursorUsageResponseSchema.safeParse(rawUsage);
  if (!usage.success) {
    return {
      status: "error",
      message: "Cursor usage response was malformed.",
      planLabel: null,
      accountEmail,
    };
  }
  const plan = cursorPlanResponseSchema.safeParse(rawPlan);
  const resetsAt =
    usage.data.billingCycleEnd == null
      ? null
      : new Date(usage.data.billingCycleEnd).toISOString();
  const windows: ProviderUsageWindow[] = [];
  const planUsage = usage.data.planUsage;
  const hasModelBuckets =
    planUsage?.autoPercentUsed != null || planUsage?.apiPercentUsed != null;
  if (planUsage?.autoPercentUsed != null) {
    windows.push({
      label: "Included models",
      usedPercent: clampPercent(planUsage.autoPercentUsed),
      resetsAt,
    });
  }
  if (planUsage?.apiPercentUsed != null) {
    windows.push({
      label: "Other models",
      usedPercent: clampPercent(planUsage.apiPercentUsed),
      resetsAt,
    });
  }
  if (!hasModelBuckets && planUsage != null) {
    windows.push({
      label: "Plan usage",
      usedPercent: clampPercent(planUsage.totalPercentUsed ?? 0),
      resetsAt,
    });
  }
  if (hasModelBuckets && planUsage?.totalPercentUsed != null) {
    windows.push({
      label: "Total usage",
      usedPercent: clampPercent(planUsage.totalPercentUsed),
      resetsAt,
    });
  }
  const spend = usage.data.spendLimitUsage;
  const pair =
    spend?.overallLimit != null
      ? { limit: spend.overallLimit, used: spend.overallUsed ?? 0 }
      : spend?.individualLimit != null
        ? { limit: spend.individualLimit, used: spend.individualUsed ?? 0 }
        : spend?.pooledLimit != null
          ? { limit: spend.pooledLimit, used: spend.pooledUsed ?? 0 }
          : null;
  if (pair && pair.limit > 0) {
    windows.push({
      label: "On-demand spend",
      usedPercent: clampPercent((pair.used / pair.limit) * 100),
      resetsAt,
      cost: { usedUsdCents: pair.used, limitUsdCents: pair.limit },
    });
  }
  const bonusSpend = planUsage?.bonusSpend ?? 0;
  const totalSpend = planUsage?.totalSpend ?? 0;
  if (bonusSpend > 0 && totalSpend > 0) {
    windows.push({
      label: "Bonus spend",
      usedPercent: clampPercent((bonusSpend / totalSpend) * 100),
      resetsAt,
      cost: { usedUsdCents: bonusSpend, limitUsdCents: totalSpend },
    });
  }
  return {
    status: "ok",
    accountEmail,
    planLabel: plan.success ? (plan.data.planInfo?.planName ?? null) : null,
    windows,
  };
}

function fetchDashboard(
  method: string,
  accessToken: string,
): Promise<Response> {
  return fetch(`${CURSOR_DASHBOARD_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-type": "cli",
      "x-cursor-client-version": "cli-bb-provider-acp",
    },
    body: "{}",
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  });
}

export async function getAcpProviderUsage(args: {
  maintenance: AcpMaintenanceDialect | undefined;
  command: string | null;
}): Promise<ProviderUsageResult> {
  if (args.maintenance?.readUsage === undefined) return { supported: false };
  if (
    args.command === null ||
    (await resolveExecutablePath(args.command)) === null
  ) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  return args.maintenance.readUsage();
}

export const CURSOR_ACP_MAINTENANCE: AcpMaintenanceDialect = {
  loginCommand: "cursor-agent login",
  installer: () => downloadedInstallerCommand(CURSOR_INSTALL_SCRIPT_URL),
  readAccount: async () => {
    const accessToken = await readAccessToken();
    return accessToken === null ? null : { email: readAccountEmail() };
  },
  readUsage: readCursorUsage,
};

async function readCursorUsage(): Promise<ProviderUsageResult> {
  const accessToken = await readAccessToken();
  if (!accessToken) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  try {
    const [usageResponse, planResponse] = await Promise.all([
      fetchDashboard("GetCurrentPeriodUsage", accessToken),
      fetchDashboard("GetPlanInfo", accessToken),
    ]);
    if (usageResponse.status === 401 || planResponse.status === 401) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!usageResponse.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message: `Cursor usage request failed (HTTP ${usageResponse.status}).`,
          planLabel: null,
          accountEmail: readAccountEmail(),
        },
      };
    }
    return {
      supported: true,
      usage: normalizeUsage(
        await usageResponse.json(),
        planResponse.ok ? await planResponse.json() : {},
        readAccountEmail(),
      ),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        planLabel: null,
        accountEmail: readAccountEmail(),
      },
    };
  }
}

async function readOpenCodeUsageKey(): Promise<string> {
  try {
    const text = await fs.readFile(
      path.join(os.homedir(), ".bb", "opencode-usage.env"),
      "utf8",
    );
    const line = text
      .split(/\r?\n/u)
      .find((entry) => /^OPENCODE_API_KEY=/u.test(entry));
    if (line === undefined) return "";
    const raw = line.slice(line.indexOf("=") + 1).trim();
    if (
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'")))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  } catch {
    return "";
  }
}

function normalizeOpenCodeUsage(data: unknown): ProviderUsage {
  if (
    data === null ||
    typeof data !== "object" ||
    (data as { usage?: unknown }).usage === null ||
    typeof (data as { usage?: unknown }).usage !== "object"
  ) {
    return {
      status: "error",
      message: "OpenCode Go usage response was malformed.",
      planLabel: "Go · shared",
      accountEmail: null,
    };
  }
  const usage = (data as { usage: Record<string, unknown> }).usage;
  const labels = [
    ["rolling", "Rolling (5h)"],
    ["weekly", "Weekly"],
    ["monthly", "Monthly"],
  ] as const;
  const windows = labels.flatMap(([key, label]) => {
    const value = usage[key];
    if (value === null || typeof value !== "object") return [];
    const rawPercent = Number((value as { percent?: unknown }).percent);
    return [
      {
        label,
        usedPercent: clampPercent(rawPercent),
        resetsAt:
          typeof (value as { resetsAt?: unknown }).resetsAt === "string"
            ? (value as { resetsAt: string }).resetsAt
            : null,
      },
    ];
  });
  return {
    status: "ok",
    accountEmail: null,
    planLabel: "Go · shared",
    windows,
  };
}

async function readOpenCodeUsage(): Promise<ProviderUsageResult> {
  const accessToken = await readOpenCodeUsageKey();
  if (accessToken === "") {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  try {
    const response = await fetch(OPENCODE_GO_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "bb-provider-acp/0.1.0",
      },
      signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!response.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message: `OpenCode Go usage request failed (HTTP ${response.status}).`,
          planLabel: "Go · shared",
          accountEmail: null,
        },
      };
    }
    return {
      supported: true,
      usage: normalizeOpenCodeUsage(await response.json()),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        planLabel: "Go · shared",
        accountEmail: null,
      },
    };
  }
}

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function grokUsagePercent(config: JsonRecord): number {
  const direct = finiteNumber(config.creditUsagePercent);
  if (direct !== null) return direct;
  const history = Array.isArray(config.history) ? config.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const percentage = finiteNumber(
      jsonRecord(history[index])?.creditUsagePercent,
    );
    if (percentage !== null) return percentage;
  }
  const includedUsed = finiteNumber(
    jsonRecord(config.includedUsed)?.val ?? config.includedUsed,
  );
  const monthlyLimit = finiteNumber(
    jsonRecord(config.monthlyLimit)?.val ?? config.monthlyLimit,
  );
  return includedUsed !== null && monthlyLimit !== null && monthlyLimit > 0
    ? (includedUsed / monthlyLimit) * 100
    : 0;
}

function grokPeriodLabel(type: unknown): string {
  if (typeof type !== "string") return "Usage limit";
  if (type.includes("WEEKLY")) return "Weekly limit";
  if (type.includes("MONTHLY")) return "Monthly limit";
  if (type.includes("DAILY")) return "Daily limit";
  return "Usage limit";
}

function normalizeGrokUsage(
  billingPayload: unknown,
  settingsPayload: unknown,
): ProviderUsage {
  const config = jsonRecord(jsonRecord(billingPayload)?.config);
  if (config === null) {
    return {
      status: "error",
      message: "Grok usage response was malformed.",
      planLabel: null,
      accountEmail: null,
    };
  }
  const period = jsonRecord(config.currentPeriod);
  const plan = jsonRecord(settingsPayload)?.subscription_tier_display;
  return {
    status: "ok",
    accountEmail: null,
    planLabel:
      typeof plan === "string" && plan.trim() !== "" ? plan : "Grok Build",
    windows: [
      {
        label: grokPeriodLabel(period?.type),
        usedPercent: clampPercent(grokUsagePercent(config)),
        resetsAt:
          typeof period?.end === "string"
            ? period.end
            : typeof config.billingPeriodEnd === "string"
              ? config.billingPeriodEnd
              : null,
      },
    ],
  };
}

async function readGrokBearerKey(): Promise<string | null> {
  const grokHome =
    process.env.GROK_HOME?.trim() || path.join(os.homedir(), ".grok");
  try {
    const root = jsonRecord(
      JSON.parse(await fs.readFile(path.join(grokHome, "auth.json"), "utf8")),
    );
    if (root === null) return null;
    for (const candidate of Object.values(root)) {
      const key = jsonRecord(candidate)?.key;
      if (typeof key === "string" && key.trim() !== "") return key;
    }
  } catch {
    return null;
  }
  return null;
}

async function readGrokUsage(): Promise<ProviderUsageResult> {
  const key = await readGrokBearerKey();
  if (key === null) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    "x-grok-client-mode": "billing",
    "User-Agent": "bb-provider-acp/0.1.0",
  };
  try {
    const [billing, settings] = await Promise.all([
      fetch(GROK_BILLING_URL, {
        headers,
        signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
      }),
      fetch(GROK_SETTINGS_URL, {
        headers,
        signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
      }),
    ]);
    if (
      billing.status === 401 ||
      billing.status === 403 ||
      settings.status === 401 ||
      settings.status === 403
    ) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!billing.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message: `Grok usage request failed (HTTP ${billing.status}).`,
          planLabel: null,
          accountEmail: null,
        },
      };
    }
    return {
      supported: true,
      usage: normalizeGrokUsage(
        await billing.json(),
        settings.ok ? await settings.json() : {},
      ),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        planLabel: null,
        accountEmail: null,
      },
    };
  }
}

export const OPENCODE_ACP_MAINTENANCE: AcpMaintenanceDialect = {
  loginCommand: "opencode auth login",
  readUsage: readOpenCodeUsage,
};

export const GROK_ACP_MAINTENANCE: AcpMaintenanceDialect = {
  loginCommand: "grok login",
  readUsage: readGrokUsage,
};

export const __testing = {
  buildProviderInstallationRun: buildAcpProviderInstallationRun,
  normalizeGrokUsage,
  normalizeOpenCodeUsage,
  normalizeUsage,
};
