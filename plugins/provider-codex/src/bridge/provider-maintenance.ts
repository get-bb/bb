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
const CODEX_MINIMUM_SUPPORTED_VERSION = "0.136.0";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CHATGPT_AUTH_CLAIM_PATH = "https://api.openai.com/auth";
const COMMAND_TIMEOUT_MS = 5_000;
const USAGE_FETCH_TIMEOUT_MS = 15_000;
const INSTALLATION_CHECK_TIMEOUT_MS = 15_000;
const CODEX_NPM_PACKAGE = "@openai/codex";
const ALLOWED_CLOUDFLARE_COOKIE_NAMES = new Set([
  "__cf_bm",
  "__cflb",
  "__cfruid",
  "__cfseq",
  "__cfwaitingroom",
  "_cfuvid",
  "cf_clearance",
  "cf_ob_info",
  "cf_use_ob",
]);
const cloudflareCookiesByName = new Map<string, string>();

type JsonRecord = Record<string, unknown>;

interface CodexChatGptCredentials {
  type: "chatgpt";
  accessToken: string;
  accountId: string;
  accountEmail: string | null;
  expired: boolean;
  isFedrampAccount: boolean;
}

interface CodexApiKeyCredentials {
  type: "apiKey";
}

type CodexCredentials = CodexChatGptCredentials | CodexApiKeyCredentials;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decodeJwtPayload(token: string): JsonRecord | null {
  const encoded = token.split(".")[1];
  if (!encoded) return null;
  try {
    return asRecord(JSON.parse(Buffer.from(encoded, "base64url").toString()));
  } catch {
    return null;
  }
}

function chatGptClaims(token: string): JsonRecord | null {
  return asRecord(decodeJwtPayload(token)?.[CHATGPT_AUTH_CLAIM_PATH]);
}

function accountEmail(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const profile = asRecord(payload?.["https://api.openai.com/profile"]);
  return nonEmptyString(payload?.email) ?? nonEmptyString(profile?.email);
}

function tokenExpired(token: string): boolean {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && Date.now() >= exp * 1000;
}

function storeCloudflareCookies(headers: Headers): void {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return;
  for (const cookie of setCookie.split(/,(?=\s*[^;,=\s]+=[^;,]*)/u)) {
    const [nameValue] = cookie.trim().split(";", 1);
    const [rawName] = nameValue?.split("=", 1) ?? [];
    const name = rawName?.trim();
    if (
      !name ||
      (!ALLOWED_CLOUDFLARE_COOKIE_NAMES.has(name) &&
        !name.startsWith("cf_chl_"))
    ) {
      continue;
    }
    cloudflareCookiesByName.set(name, nameValue.trim());
  }
}

async function fetchCodexUsage(headers: Headers): Promise<Response> {
  const doFetch = async () => {
    const requestHeaders = new Headers(headers);
    if (cloudflareCookiesByName.size > 0) {
      requestHeaders.set(
        "Cookie",
        [...cloudflareCookiesByName.values()].join("; "),
      );
    }
    const response = await fetch(CODEX_USAGE_URL, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
    });
    storeCloudflareCookies(response.headers);
    return response;
  };
  const response = await doFetch();
  return response.status === 403 &&
    response.headers.get("cf-mitigated")?.toLowerCase() === "challenge"
    ? doFetch()
    : response;
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

async function readCredentials(): Promise<CodexCredentials | null> {
  let parsed: JsonRecord;
  try {
    parsed =
      asRecord(
        JSON.parse(
          await fs.readFile(path.join(codexHome(), "auth.json"), "utf8"),
        ),
      ) ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const authMode = nonEmptyString(parsed.auth_mode);
  if (
    authMode === "apikey" ||
    authMode === "apiKey" ||
    (authMode === null && nonEmptyString(parsed.OPENAI_API_KEY) !== null)
  ) {
    return nonEmptyString(parsed.OPENAI_API_KEY) === null
      ? null
      : { type: "apiKey" };
  }
  const tokens = asRecord(parsed.tokens);
  const accessToken = nonEmptyString(tokens?.access_token);
  if (!tokens || !accessToken) return null;
  const claims = chatGptClaims(accessToken);
  const idToken = nonEmptyString(tokens.id_token);
  const idTokenClaims =
    idToken === null ? asRecord(tokens.id_token) : chatGptClaims(idToken);
  const accountId =
    nonEmptyString(tokens.account_id) ??
    nonEmptyString(claims?.chatgpt_account_id) ??
    nonEmptyString(idTokenClaims?.chatgpt_account_id);
  if (!accountId) return null;
  return {
    type: "chatgpt",
    accessToken,
    accountId,
    accountEmail:
      accountEmail(accessToken) ?? (idToken ? accountEmail(idToken) : null),
    expired: tokenExpired(accessToken),
    isFedrampAccount:
      claims?.chatgpt_account_is_fedramp === true ||
      idTokenClaims?.chatgpt_account_is_fedramp === true,
  };
}

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
    const { stdout, stderr } = await execFileAsync("codex", ["--version"], {
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

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u);
    return match === null
      ? { core: [0, 0, 0], prerelease: null }
      : {
          core: [Number(match[1]), Number(match[2]), Number(match[3])],
          prerelease: match[4] ?? null,
        };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (delta !== 0) return delta;
  }
  if (a.prerelease === null && b.prerelease !== null) return 1;
  if (a.prerelease !== null && b.prerelease === null) return -1;
  if (a.prerelease !== null && b.prerelease !== null) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
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
      ? (parsed.data.dependencies[CODEX_NPM_PACKAGE]?.version ?? null)
      : null;
  } catch {
    return null;
  }
}

function pathIsInside(child: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export async function getCodexProviderInstallationStatus(): Promise<ExperimentalProviderInstallationStatus> {
  const npm = npmCommand();
  const [
    resolvedExecutable,
    versionOutput,
    latestOutput,
    prefixOutput,
    listOutput,
  ] = await Promise.all([
    executablePath("codex"),
    commandOutput("codex", ["--version"]),
    commandOutput(npm, ["view", CODEX_NPM_PACKAGE, "version"]),
    commandOutput(npm, ["prefix", "-g"]),
    commandOutput(npm, [
      "list",
      "-g",
      CODEX_NPM_PACKAGE,
      "--depth=0",
      "--json",
    ]),
  ]);
  const installed = resolvedExecutable !== null || versionOutput !== null;
  const currentVersion = versionFrom(versionOutput);
  const latestVersion = versionFrom(latestOutput);
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
  const needsUpdate =
    installed &&
    currentVersion !== null &&
    latestVersion !== null &&
    compareVersions(latestVersion, currentVersion) > 0;
  const versionUnsupported =
    installed &&
    currentVersion !== null &&
    compareVersions(currentVersion, CODEX_MINIMUM_SUPPORTED_VERSION) < 0;
  const actionKind = !installed
    ? "install"
    : needsUpdate || versionUnsupported
      ? "update"
      : null;
  const actionArgs =
    actionKind === "install"
      ? ["install", "-g", `${CODEX_NPM_PACKAGE}@latest`]
      : ["update"];
  const actionCommand = actionKind === "install" ? npm : "codex";

  return {
    executableName: "codex",
    executablePath: resolvedExecutable,
    installed,
    installSource,
    currentVersion,
    latestVersion,
    minimumSupportedVersion: CODEX_MINIMUM_SUPPORTED_VERSION,
    npmPackageName: CODEX_NPM_PACKAGE,
    npmGlobalPackageVersion: npmGlobalPackageVersion(listOutput),
    installAction:
      actionKind === null
        ? null
        : {
            kind: actionKind,
            label: actionKind === "install" ? "Install" : "Update",
            command: formatCommand(actionCommand, actionArgs),
          },
    needsUpdate,
    versionUnsupported,
  };
}

export async function getCodexProviderInstallationRun(
  action: "install" | "update",
): Promise<ExperimentalProviderInstallationRunResult> {
  const status = await getCodexProviderInstallationStatus();
  return buildCodexProviderInstallationRun(status, action);
}

function buildCodexProviderInstallationRun(
  status: ExperimentalProviderInstallationStatus,
  action: "install" | "update",
): ExperimentalProviderInstallationRunResult {
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message: `Codex ${action} is no longer available on this host.`,
    };
  }
  const command = action === "install" ? npmCommand() : "codex";
  const args =
    action === "install"
      ? ["install", "-g", `${CODEX_NPM_PACKAGE}@latest`]
      : ["update"];
  return {
    available: true,
    command: { command, args, displayCommand: formatCommand(command, args) },
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

function healthResult(
  status:
    | "ready"
    | "not_installed"
    | "unauthenticated"
    | "expired"
    | "unsupported_version"
    | "unknown",
  args: {
    accountEmail?: string | null;
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
      planLabel: null,
      installedVersion: args.installedVersion ?? null,
      minimumSupportedVersion: CODEX_MINIMUM_SUPPORTED_VERSION,
      canInstall: true,
      canUpdate: status !== "not_installed",
      loginCommand: "codex login",
    },
  };
}

export async function getCodexProviderHealth(): Promise<ExperimentalProviderHealthResult> {
  if ((await executablePath("codex")) === null) {
    return healthResult("not_installed");
  }
  const version = await installedVersion();
  if (
    version !== null &&
    compareVersions(version, CODEX_MINIMUM_SUPPORTED_VERSION) < 0
  ) {
    return healthResult("unsupported_version", { installedVersion: version });
  }
  try {
    const credentials = await readCredentials();
    if (credentials === null) {
      return healthResult("unauthenticated", { installedVersion: version });
    }
    if (credentials.type === "chatgpt" && credentials.expired) {
      return healthResult("expired", {
        accountEmail: credentials.accountEmail,
        installedVersion: version,
      });
    }
    return healthResult("ready", {
      accountEmail:
        credentials.type === "chatgpt" ? credentials.accountEmail : null,
      installedVersion: version,
    });
  } catch (error) {
    return healthResult("unknown", {
      installedVersion: version,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

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

function clampPercent(value: number): number {
  return Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(value) ? value : 0)),
  );
}

function usageWindow(
  value: z.infer<typeof codexUsageWindowSchema> | null | undefined,
  fallbackLabel: string,
): ExperimentalProviderUsageWindow | null {
  if (!value) return null;
  return {
    label:
      value.limit_window_seconds === 604_800 ? "Weekly limit" : fallbackLabel,
    usedPercent: clampPercent(value.used_percent),
    resetsAt:
      value.reset_at == null || !Number.isFinite(value.reset_at)
        ? null
        : new Date(value.reset_at * 1000).toISOString(),
  };
}

function planLabel(plan: string | null | undefined): string | null {
  if (!plan) return null;
  const labels: Record<string, string> = {
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
  return labels[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

function normalizeUsage(
  raw: unknown,
  email: string | null,
): ExperimentalProviderUsage {
  const parsed = codexUsageResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Codex usage response was malformed.",
      planLabel: null,
      accountEmail: email,
    };
  }
  const windows = [
    usageWindow(parsed.data.rate_limit?.primary_window, "Current session"),
    usageWindow(parsed.data.rate_limit?.secondary_window, "Weekly limit"),
  ].filter(
    (window): window is ExperimentalProviderUsageWindow => window !== null,
  );
  return {
    status: "ok",
    accountEmail: email,
    planLabel: planLabel(parsed.data.plan_type),
    windows,
  };
}

export async function getCodexProviderUsage(): Promise<ExperimentalProviderUsageResult> {
  if ((await executablePath("codex")) === null) {
    return { supported: true, usage: { status: "not_installed" } };
  }
  let credentials: CodexCredentials | null;
  try {
    credentials = await readCredentials();
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
  if (credentials === null) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  if (credentials.type === "apiKey") {
    return {
      supported: true,
      usage: {
        status: "error",
        message:
          "Codex is authenticated with an API key, which has no subscription usage limits.",
        planLabel: null,
        accountEmail: null,
      },
    };
  }
  if (credentials.expired) {
    return { supported: true, usage: { status: "expired" } };
  }
  try {
    const headers = new Headers({
      Authorization: `Bearer ${credentials.accessToken}`,
      "chatgpt-account-id": credentials.accountId,
      originator: "bb",
      "User-Agent": "bb-provider-codex",
      Accept: "application/json",
    });
    if (credentials.isFedrampAccount) headers.set("X-OpenAI-Fedramp", "true");
    const response = await fetchCodexUsage(headers);
    if (response.status === 401) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!response.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          message: `Codex usage request failed (HTTP ${response.status}).`,
          planLabel: null,
          accountEmail: credentials.accountEmail,
        },
      };
    }
    return {
      supported: true,
      usage: normalizeUsage(await response.json(), credentials.accountEmail),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        planLabel: null,
        accountEmail: credentials.accountEmail,
      },
    };
  }
}

export const __testing = {
  buildProviderInstallationRun: buildCodexProviderInstallationRun,
  compareVersions,
  normalizeUsage,
  planLabel,
};
