import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const INSTALLATION_CHECK_TIMEOUT_MS = 15_000;
const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";
const CLAUDE_INSTALL_SCRIPT_URL = "https://claude.ai/install.sh";

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

async function installedVersion(): Promise<string | null> {
  try {
    const command = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
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

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) =>
      /^[A-Za-z0-9_./:@+-]+$/u.test(part)
        ? part
        : `'${part.replace(/'/gu, "'\\''")}'`,
    )
    .join(" ");
}

async function commandOutput(
  command: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: INSTALLATION_CHECK_TIMEOUT_MS,
    });
    return `${stdout}\n${stderr}`.trim();
  } catch {
    return null;
  }
}

function firstLine(value: string | null): string | null {
  return (
    value
      ?.split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function versionFrom(value: string | null): string | null {
  return (
    value?.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/u)?.[1] ?? null
  );
}

function compareVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value.split("-", 1)[0]?.split(".").map(Number) ?? [];
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

function pathIsInside(child: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function npmGlobalPackageVersion(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = z
      .object({
        dependencies: z
          .record(z.string(), z.object({ version: z.string().min(1) }))
          .default({}),
      })
      .safeParse(JSON.parse(value));
    return parsed.success
      ? (parsed.data.dependencies[CLAUDE_NPM_PACKAGE]?.version ?? null)
      : null;
  } catch {
    return null;
  }
}

function claudeDistTags(value: string | null): {
  latest: string;
  stable: string | null;
} | null {
  if (value === null) return null;
  try {
    const parsed = z
      .object({
        latest: z.string().min(1),
        stable: z.string().min(1).optional(),
      })
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

function downloadedInstallerCommand(): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  const script = [
    'tmp=$(mktemp "${TMPDIR:-/tmp}/provider-installation.XXXXXX")',
    "trap 'rm -f \"$tmp\"' EXIT",
    `curl -fsSL ${CLAUDE_INSTALL_SCRIPT_URL} -o "$tmp"`,
    'bash "$tmp"',
  ].join(" && ");
  return { command: "sh", args: ["-c", script], displayCommand: script };
}

export async function getClaudeProviderInstallationStatus(): Promise<ExperimentalProviderInstallationStatus> {
  const command = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
  const npm = npmCommand();
  const [
    resolvedExecutable,
    versionOutput,
    tagsOutput,
    prefixOutput,
    listOutput,
    doctorOutput,
  ] = await Promise.all([
    executablePath(command),
    commandOutput(command, ["--version"]),
    commandOutput(npm, ["view", CLAUDE_NPM_PACKAGE, "dist-tags", "--json"]),
    commandOutput(npm, ["prefix", "-g"]),
    commandOutput(npm, [
      "list",
      "-g",
      CLAUDE_NPM_PACKAGE,
      "--depth=0",
      "--json",
    ]),
    commandOutput(command, ["doctor"]),
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
  const npmPrefix = firstLine(prefixOutput);
  const npmBin =
    npmPrefix === null
      ? null
      : process.platform === "win32"
        ? npmPrefix
        : path.join(npmPrefix, "bin");
  const installSource = !installed
    ? "notInstalled"
    : resolvedExecutable !== null &&
        npmBin !== null &&
        pathIsInside(resolvedExecutable, npmBin)
      ? "npmGlobal"
      : "external";
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
      ? downloadedInstallerCommand().displayCommand
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
    npmGlobalPackageVersion: npmGlobalPackageVersion(listOutput),
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
): Promise<ExperimentalProviderInstallationRunResult> {
  const status = await getClaudeProviderInstallationStatus();
  return buildClaudeProviderInstallationRun(status, action);
}

function buildClaudeProviderInstallationRun(
  status: ExperimentalProviderInstallationStatus,
  action: "install" | "update",
): ExperimentalProviderInstallationRunResult {
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Claude Code ${action} is no longer available on this host.`,
    };
  }
  const command = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
  const execution =
    action === "install"
      ? downloadedInstallerCommand()
      : {
          command,
          args: ["update"],
          displayCommand: formatCommand(command, ["update"]),
        };
  return {
    available: true,
    command: execution,
    verification:
      action === "install"
        ? { kind: "installed" }
        : status.latestVersion !== null
          ? { kind: "version_at_least", version: status.latestVersion }
          : {
              kind: "version_changed",
              previousVersion: status.currentVersion ?? "unknown",
            },
  };
}

async function readKeychainCredentials(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
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
      if (stdout.trim()) return stdout.trim();
    } catch {
      // Fall through to the next keychain form, then the credentials file.
    }
  }
  return null;
}

async function readCredentials(): Promise<ClaudeCredentials | null> {
  let raw = await readKeychainCredentials();
  if (raw === null) {
    try {
      raw = await fs.readFile(
        path.join(os.homedir(), ".claude", ".credentials.json"),
        "utf8",
      );
    } catch {
      return null;
    }
  }
  try {
    const parsed = claudeCredentialsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.claudeAiOauth : null;
  } catch {
    return null;
  }
}

async function readAccountEmail(): Promise<string | null> {
  try {
    const parsed = claudeAccountSchema.safeParse(
      JSON.parse(
        await fs.readFile(path.join(os.homedir(), ".claude.json"), "utf8"),
      ),
    );
    return parsed.success
      ? (parsed.data.oauthAccount?.emailAddress ?? null)
      : null;
  } catch {
    return null;
  }
}

function planLabel(credentials: ClaudeCredentials): string | null {
  const maxMatch = (credentials.rateLimitTier ?? "").match(/max_(\d+)x/u);
  if (maxMatch) return `Max (${maxMatch[1]}x)`;
  const subscription = credentials.subscriptionType;
  return subscription
    ? subscription.charAt(0).toUpperCase() + subscription.slice(1)
    : null;
}

function healthResult(
  status: "ready" | "not_installed" | "unauthenticated" | "expired" | "unknown",
  args: {
    accountEmail?: string | null;
    planLabel?: string | null;
    installedVersion?: string | null;
    statusMessage?: string | null;
  } = {},
): ExperimentalProviderHealthResult {
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
      loginCommand: "claude /login",
    },
  };
}

export async function getClaudeProviderHealth(): Promise<ExperimentalProviderHealthResult> {
  const command = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
  if ((await executablePath(command)) === null) {
    return healthResult("not_installed");
  }
  const version = await installedVersion();
  try {
    const [credentials, email] = await Promise.all([
      readCredentials(),
      readAccountEmail(),
    ]);
    if (!credentials) {
      return healthResult("unauthenticated", { installedVersion: version });
    }
    const known = {
      accountEmail: email,
      planLabel: planLabel(credentials),
      installedVersion: version,
    };
    return credentials.expiresAt != null && Date.now() >= credentials.expiresAt
      ? healthResult("expired", known)
      : healthResult("ready", known);
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

function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

function resetIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function usageWindow(
  value: z.infer<typeof claudeUsageWindowSchema> | null | undefined,
  label: string,
): ExperimentalProviderUsageWindow | null {
  if (!value || value.utilization == null) return null;
  return {
    label,
    usedPercent: clampPercent(value.utilization),
    resetsAt: resetIso(value.resets_at),
  };
}

function scopedWindows(
  limits:
    | (z.infer<typeof claudeScopedUsageLimitSchema> | null)[]
    | null
    | undefined,
): ExperimentalProviderUsageWindow[] {
  const windows: ExperimentalProviderUsageWindow[] = [];
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
      label,
      usedPercent: clampPercent(limit.percent),
      resetsAt: resetIso(limit.resets_at),
    });
  }
  return windows;
}

function normalizeUsage(
  raw: unknown,
  credentials: ClaudeCredentials,
  email: string | null,
): ExperimentalProviderUsage {
  const parsed = claudeUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Claude usage response was malformed.",
      planLabel: planLabel(credentials),
      accountEmail: email,
    };
  }
  const windows = [
    usageWindow(parsed.data.five_hour, "Current session"),
    usageWindow(parsed.data.seven_day, "Weekly limit"),
    ...scopedWindows(parsed.data.limits),
  ].filter(
    (window): window is ExperimentalProviderUsageWindow => window !== null,
  );
  return {
    status: "ok",
    accountEmail: email,
    planLabel: planLabel(credentials),
    windows,
  };
}

export async function getClaudeProviderUsage(): Promise<ExperimentalProviderUsageResult> {
  const command = process.env.BB_CLAUDE_CODE_EXECUTABLE?.trim() || "claude";
  if ((await executablePath(command)) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  const [credentials, email] = await Promise.all([
    readCredentials(),
    readAccountEmail(),
  ]);
  if (!credentials) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  if (credentials.expiresAt != null && Date.now() >= credentials.expiresAt) {
    return { supported: true, usage: { status: "expired" } };
  }
  const known = { planLabel: planLabel(credentials), accountEmail: email };
  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.0",
      },
      signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!response.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message:
            response.status === 429
              ? "Claude usage is rate limited right now. Try again shortly."
              : `Claude usage request failed (HTTP ${response.status}).`,
          ...known,
        },
      };
    }
    return {
      supported: true,
      usage: normalizeUsage(await response.json(), credentials, email),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        ...known,
      },
    };
  }
}

export const __testing = {
  buildProviderInstallationRun: buildClaudeProviderInstallationRun,
  normalizeUsage,
  planLabel,
};
