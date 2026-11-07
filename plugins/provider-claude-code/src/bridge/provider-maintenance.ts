import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ProviderHealthResult,
  type ProviderInstallationRunResult,
  type ProviderInstallationStatus,
  type ProviderUsage,
  type ProviderUsageResult,
  type ProviderUsageWindow,
  experimental_clampPercent as clampPercent,
  experimental_commandOutput as commandOutput,
  experimental_compareVersions as compareVersions,
  experimental_downloadedInstallerCommand as downloadedInstallerCommand,
  experimental_formatCommand as formatCommand,
  experimental_installationVerification as installationVerification,
  experimental_npmCommand as npmCommand,
  experimental_npmGlobalInstallSource as npmGlobalInstallSource,
  experimental_probeNpmGlobalPackage as probeNpmGlobalPackage,
  experimental_readCliVersion as readCliVersion,
  experimental_resolveExecutablePath as resolveExecutablePath,
  experimental_versionFrom as versionFrom,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  probeClaudeInitialization,
  probeClaudeUsage,
} from "./initialization-probe.js";

const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";
const CLAUDE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh";
const CLAUDE_POWERSHELL_INSTALL_SCRIPT_URL = "https://claude.ai/install.ps1";

const claudeAccountFileSchema = z.object({
  oauthAccount: z
    .object({ accountUuid: z.string().uuid().nullish() })
    .nullish(),
});

async function claudeExecutable(): Promise<string> {
  const explicit = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim();
  if (explicit) return explicit;
  return (await resolveExecutablePath("claude")) ?? "claude";
}

function claudeInstallerCommand() {
  return downloadedInstallerCommand(CLAUDE_INSTALL_SCRIPT_URL, {
    powershellUrl: CLAUDE_POWERSHELL_INSTALL_SCRIPT_URL,
  });
}

function claudeDistTags(value: string | null): {
  latest: string;
  stable: string | null;
} | null {
  if (value === null) return null;
  try {
    const distTagsSchema = z.object({
      latest: z.string().min(1),
      stable: z.string().min(1).optional(),
    });
    const parsed = z
      .union([
        distTagsSchema,
        z.tuple([distTagsSchema]).transform(([tags]) => tags),
      ])
      .safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const latest = versionFrom(parsed.data.latest);
    if (latest === null) return null;
    return {
      latest,
      stable:
        parsed.data.stable === undefined
          ? latest
          : versionFrom(parsed.data.stable),
    };
  } catch {
    return null;
  }
}

function claudeDoctor(value: string | null): {
  installMethod: "native" | "npm-global" | "package-manager" | "unknown" | null;
  updateChannel: "latest" | "stable" | null;
} {
  const running =
    value === null ? null : /^Running:\s+([^\s(]+)/mu.exec(value)?.[1];
  const channel =
    value === null
      ? null
      : /^Auto-update channel:\s+(latest|stable)\s*$/mu.exec(value)?.[1];
  return {
    installMethod:
      running === "native" || running === "npm-global"
        ? running
        : running !== null && running !== undefined
          ? ["homebrew", "winget", "apt", "dnf", "apk"].includes(running)
            ? "package-manager"
            : "unknown"
          : null,
    updateChannel:
      channel === "latest" || channel === "stable" ? channel : null,
  };
}

function isDefaultNativeClaudePath(executablePath: string | null): boolean {
  if (executablePath === null) return false;
  const normalized = executablePath.replace(/\\/gu, "/");
  return (
    normalized.endsWith("/.local/bin/claude") ||
    (process.platform === "win32" &&
      normalized.endsWith("/.local/bin/claude.exe"))
  );
}

export async function getClaudeProviderInstallationStatus(
  checkUpdates = true,
): Promise<ProviderInstallationStatus> {
  const command = await claudeExecutable();
  const [
    resolvedExecutable,
    versionOutput,
    tagsOutput,
    npmGlobal,
    doctorOutput,
  ] = await Promise.all([
    resolveExecutablePath(command),
    commandOutput(command, ["--version"]),
    checkUpdates
      ? commandOutput(npmCommand(), [
          "view",
          CLAUDE_NPM_PACKAGE,
          "dist-tags",
          "--json",
        ])
      : null,
    checkUpdates
      ? probeNpmGlobalPackage(CLAUDE_NPM_PACKAGE)
      : { npmBin: null, npmGlobalPackageVersion: null },
    checkUpdates ? commandOutput(command, ["doctor"]) : null,
  ]);
  const installed = resolvedExecutable !== null || versionOutput !== null;
  const currentVersion = versionFrom(versionOutput);
  const doctor = claudeDoctor(doctorOutput);
  const tags = claudeDistTags(tagsOutput);
  const latestVersion =
    doctor.updateChannel === null || tags === null
      ? null
      : tags[doctor.updateChannel];
  const definitelyNeedsUnknownChannelUpdate =
    installed &&
    currentVersion !== null &&
    tags?.stable !== null &&
    tags?.stable !== undefined &&
    compareVersions(tags.latest, currentVersion) > 0 &&
    compareVersions(tags.stable, currentVersion) > 0;
  const needsUpdate =
    installed && currentVersion !== null && latestVersion !== null
      ? compareVersions(latestVersion, currentVersion) > 0
      : definitelyNeedsUnknownChannelUpdate;
  const installSource = npmGlobalInstallSource({
    installed,
    executablePath: resolvedExecutable,
    npmBin: npmGlobal.npmBin,
  });
  const nativeFallback =
    doctor.installMethod === null &&
    installSource === "external" &&
    isDefaultNativeClaudePath(resolvedExecutable);
  const canRunUpdate =
    doctor.installMethod === "native" ||
    nativeFallback ||
    (installSource === "npmGlobal" &&
      (doctor.installMethod === null || doctor.installMethod === "npm-global"));
  const actionKind = !installed
    ? "install"
    : needsUpdate && canRunUpdate
      ? "update"
      : null;
  const displayCommand =
    actionKind === "install"
      ? claudeInstallerCommand().displayCommand
      : formatCommand(command, ["update"]);
  return {
    executableName: command,
    executablePath: resolvedExecutable,
    installed,
    installSource,
    currentVersion,
    latestVersion,
    minimumSupportedVersion: null,
    npmPackageName: CLAUDE_NPM_PACKAGE,
    npmGlobalPackageVersion: npmGlobal.npmGlobalPackageVersion,
    installAction:
      actionKind === null
        ? null
        : {
            kind: actionKind,
            label: actionKind === "install" ? "Install" : "Update",
            command: displayCommand,
          },
    needsUpdate,
    versionUnsupported: false,
  };
}

export async function getClaudeProviderInstallationRun(
  action: "install" | "update",
): Promise<ProviderInstallationRunResult> {
  const status = await getClaudeProviderInstallationStatus();
  return buildClaudeProviderInstallationRun(status, action);
}

function buildClaudeProviderInstallationRun(
  status: ProviderInstallationStatus,
  action: "install" | "update",
): ProviderInstallationRunResult {
  const command = status.executableName;
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Claude Code ${action} is no longer available on this host.`,
    };
  }
  const execution =
    action === "install"
      ? claudeInstallerCommand()
      : {
          command,
          args: ["update"],
          displayCommand: formatCommand(command, ["update"]),
        };
  return {
    available: true,
    command: execution,
    verification: installationVerification(status, action),
  };
}

function probeArgs() {
  return { env: process.env, cwd: process.cwd() };
}

async function readAccountUuid(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const parsed = claudeAccountFileSchema.safeParse(
      JSON.parse(
        await fs.readFile(
          path.join(env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json"),
          "utf8",
        ),
      ),
    );
    return parsed.success
      ? (parsed.data.oauthAccount?.accountUuid ?? null)
      : null;
  } catch {
    return null;
  }
}

function isSignedIn(account: AccountInfo): boolean {
  return (
    (account.apiProvider ?? "firstParty") !== "firstParty" ||
    account.tokenSource !== "none" ||
    (account.apiKeySource !== undefined && account.apiKeySource !== "none")
  );
}

function claudePlan(
  account: AccountInfo,
): { id: string; label: string } | null {
  const name = account.subscriptionType?.replace(/^claude\s+/iu, "").trim();
  return name
    ? {
        id: name.toLowerCase(),
        label: name.charAt(0).toUpperCase() + name.slice(1),
      }
    : null;
}

function accountFields(account: AccountInfo) {
  return {
    accountEmail: account.email ?? null,
    planLabel: claudePlan(account)?.label ?? null,
  };
}

function healthResult(
  status: "ready" | "not_installed" | "unauthenticated" | "expired" | "unknown",
  args: {
    accountEmail?: string | null;
    planLabel?: string | null;
    installedVersion?: string | null;
    statusMessage?: string | null;
  } = {},
): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status,
      statusMessage: args.statusMessage ?? null,
      accountEmail: args.accountEmail ?? null,
      planLabel: args.planLabel ?? null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: null,
      canInstall: true,
      canUpdate: status !== "not_installed",
      loginCommand: "claude auth login",
    },
  };
}

export async function getClaudeProviderHealth(): Promise<ProviderHealthResult> {
  const command = await claudeExecutable();
  if ((await resolveExecutablePath(command)) === null) {
    return healthResult("not_installed");
  }
  const version = await readCliVersion(command);
  try {
    const { account } = await probeClaudeInitialization(probeArgs());
    return isSignedIn(account)
      ? healthResult("ready", {
          ...accountFields(account),
          installedVersion: version,
        })
      : healthResult("unauthenticated", { installedVersion: version });
  } catch (error) {
    return healthResult("unknown", {
      installedVersion: version,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

const claudeUsageWindowSchema = z.object({
  utilization: z.number().nullish(),
  resets_at: z.string().nullish(),
});

const claudeScopedUsageLimitSchema = z
  .object({
    kind: z.string(),
    scope: z
      .object({
        model: z
          .object({ display_name: z.string().trim().min(1).nullish() })
          .nullish(),
        surface: z.null().optional(),
      })
      .nullish(),
    percent: z.number().nullish(),
    resets_at: z.string().nullish(),
  })
  .passthrough();

const claudeUsageResponseSchema = z
  .object({
    five_hour: claudeUsageWindowSchema.nullish(),
    seven_day: claudeUsageWindowSchema.nullish(),
    limits: z
      .array(claudeScopedUsageLimitSchema.nullable().catch(null))
      .nullish()
      .catch([]),
  })
  .passthrough();

function resetIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function usageWindow(
  value: z.infer<typeof claudeUsageWindowSchema> | null | undefined,
  label: string,
  kind: "five-hour" | "weekly",
): ProviderUsageWindow | null {
  if (!value || value.utilization == null) return null;
  return {
    label,
    kind,
    usedPercent: clampPercent(value.utilization),
    resetsAt: resetIso(value.resets_at),
  };
}

function scopedWindows(
  limits:
    | (z.infer<typeof claudeScopedUsageLimitSchema> | null)[]
    | null
    | undefined,
): ProviderUsageWindow[] {
  const windows: ProviderUsageWindow[] = [];
  const seen = new Set<string>();
  for (const limit of limits ?? []) {
    const label = limit?.scope?.model?.display_name;
    if (
      limit == null ||
      limit.kind !== "weekly_scoped" ||
      label == null ||
      limit.percent == null ||
      seen.has(label.toLowerCase())
    ) {
      continue;
    }
    seen.add(label.toLowerCase());
    windows.push({
      kind: "weekly",
      model: label.toLowerCase(),
      label,
      usedPercent: clampPercent(limit.percent),
      resetsAt: resetIso(limit.resets_at),
    });
  }
  return windows;
}

function normalizeUsage(raw: unknown, account: AccountInfo): ProviderUsage {
  const parsed = claudeUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Claude usage response was malformed.",
      ...accountFields(account),
    };
  }
  const windows = [
    usageWindow(parsed.data.five_hour, "Current session", "five-hour"),
    usageWindow(parsed.data.seven_day, "Weekly limit", "weekly"),
    ...scopedWindows(parsed.data.limits),
  ].filter((window): window is ProviderUsageWindow => window !== null);
  const plan = claudePlan(account);
  return {
    status: "ok",
    accountEmail: account.email ?? null,
    planLabel: plan?.label ?? null,
    plan: plan ? { id: plan.id, multiplier: null } : null,
    windows,
  };
}

export async function getClaudeProviderUsage(): Promise<ProviderUsageResult> {
  const command = await claudeExecutable();
  if ((await resolveExecutablePath(command)) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  const args = probeArgs();
  let probe: Awaited<ReturnType<typeof probeClaudeUsage>>;
  try {
    probe = await probeClaudeUsage(args);
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        accountEmail: null,
        planLabel: null,
      },
    };
  }
  const { account, usage } = probe;
  if (!isSignedIn(account) || !usage.rate_limits_available) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  if (usage.rate_limits === null) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: "Claude Code could not read this account's plan usage.",
        ...accountFields(account),
      },
    };
  }
  const accountUuid = await readAccountUuid(args.env);
  return {
    supported: true,
    usage: {
      ...normalizeUsage(usage.rate_limits, account),
      accountKey: accountUuid ? `anthropic:account:${accountUuid}` : null,
    },
  };
}

export const __testing = {
  buildProviderInstallationRun: buildClaudeProviderInstallationRun,
  normalizeUsage,
};
