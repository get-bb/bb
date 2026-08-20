import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type {
  ExperimentalProviderHealthResult,
  ExperimentalProviderInstallationRunResult,
  ExperimentalProviderInstallationStatus,
  ExperimentalProviderUsage,
  ExperimentalProviderUsageResult,
  ExperimentalProviderUsageWindow,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 5_000;
const USAGE_FETCH_TIMEOUT_MS = 15_000;
const CURSOR_PROVIDER_ID = "acp-cursor";
const CURSOR_DASHBOARD_URL =
  "https://api2.cursor.sh/aiserver.v1.DashboardService";
const CURSOR_KEYCHAIN_ACCOUNT = "cursor-user";
const CURSOR_ACCESS_TOKEN_SERVICE = "cursor-access-token";
const CURSOR_INSTALL_SCRIPT_URL = "https://cursor.com/install";

async function executablePath(command: string): Promise<string | null> {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(lookup, [command], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    return (
      stdout
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

async function installedVersion(command: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, ["--version"], {
      timeout: COMMAND_TIMEOUT_MS,
    });
    return (
      `${stdout}\n${stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0] ??
      null
    );
  } catch {
    return null;
  }
}

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

function healthResult(args: {
  providerId: string;
  status: "ready" | "not_installed" | "unauthenticated" | "unknown";
  accountEmail?: string | null;
  installedVersion?: string | null;
  statusMessage?: string | null;
}): ExperimentalProviderHealthResult {
  const cursor = args.providerId === CURSOR_PROVIDER_ID;
  return {
    supported: true,
    health: {
      status: args.status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: args.accountEmail ?? null,
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: cursor,
      canUpdate: cursor && args.status !== "not_installed",
      loginCommand: cursor ? "cursor-agent login" : null,
    },
  };
}

export async function getAcpProviderHealth(args: {
  providerId: string;
  command: string | null;
}): Promise<ExperimentalProviderHealthResult> {
  if (args.command === null) {
    return healthResult({
      providerId: args.providerId,
      status: "unknown",
      statusMessage: "The ACP provider has no launch command.",
    });
  }
  if ((await executablePath(args.command)) === null) {
    return healthResult({
      providerId: args.providerId,
      status: "not_installed",
    });
  }
  const version = await installedVersion(args.command);
  if (args.providerId !== CURSOR_PROVIDER_ID) {
    return healthResult({
      providerId: args.providerId,
      status: "ready",
      installedVersion: version,
    });
  }
  try {
    const accessToken = await readAccessToken();
    return healthResult({
      providerId: args.providerId,
      status: accessToken === null ? "unauthenticated" : "ready",
      accountEmail: accessToken === null ? null : readAccountEmail(),
      installedVersion: version,
    });
  } catch (error) {
    return healthResult({
      providerId: args.providerId,
      status: "unknown",
      installedVersion: version,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function cursorInstallerCommand(): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  const script = [
    'tmp=$(mktemp "${TMPDIR:-/tmp}/provider-installation.XXXXXX")',
    "trap 'rm -f \"$tmp\"' EXIT",
    `curl -fsSL ${CURSOR_INSTALL_SCRIPT_URL} -o "$tmp"`,
    'bash "$tmp"',
  ].join(" && ");
  return { command: "sh", args: ["-c", script], displayCommand: script };
}

export async function getAcpProviderInstallationStatus(args: {
  providerId: string;
  command: string | null;
}): Promise<ExperimentalProviderInstallationStatus> {
  const executableName = args.command ?? "cursor-agent";
  const resolvedExecutable =
    args.command === null ? null : await executablePath(args.command);
  const installed = resolvedExecutable !== null;
  const currentVersion =
    installed && args.command !== null
      ? await installedVersion(args.command)
      : null;
  const installAction =
    args.providerId === CURSOR_PROVIDER_ID && !installed
      ? {
          kind: "install" as const,
          label: "Install" as const,
          command: cursorInstallerCommand().displayCommand,
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
  providerId: string;
  command: string | null;
  action: "install" | "update";
}): Promise<ExperimentalProviderInstallationRunResult> {
  const status = await getAcpProviderInstallationStatus(args);
  return buildAcpProviderInstallationRun(status, args);
}

function buildAcpProviderInstallationRun(
  status: ExperimentalProviderInstallationStatus,
  args: { providerId: string; action: "install" | "update" },
): ExperimentalProviderInstallationRunResult {
  if (status.installAction?.kind !== args.action) {
    return {
      available: false,
      message: `${args.providerId} ${args.action} is not available on this host.`,
    };
  }
  return {
    available: true,
    command: cursorInstallerCommand(),
    verification: { kind: "installed" },
  };
}

const cursorNonNegativeIntegerSchema = z
  .union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/u).transform(Number),
  ])
  .refine(Number.isSafeInteger);

const cursorUsageResponseSchema = z
  .object({
    billingCycleEnd: cursorNonNegativeIntegerSchema.nullish(),
    planUsage: z
      .object({ totalPercentUsed: z.number().nonnegative().default(0) })
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

function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

function normalizeUsage(
  rawUsage: unknown,
  rawPlan: unknown,
  accountEmail: string | null = null,
): ExperimentalProviderUsage {
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
  const windows: ExperimentalProviderUsageWindow[] = [];
  if (usage.data.planUsage?.totalPercentUsed != null) {
    windows.push({
      label: "Plan usage",
      usedPercent: clampPercent(usage.data.planUsage.totalPercentUsed),
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
  providerId: string;
  command: string | null;
}): Promise<ExperimentalProviderUsageResult> {
  if (args.providerId !== CURSOR_PROVIDER_ID) return { supported: false };
  if (args.command === null || (await executablePath(args.command)) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
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

export const __testing = {
  buildProviderInstallationRun: buildAcpProviderInstallationRun,
  normalizeUsage,
};
