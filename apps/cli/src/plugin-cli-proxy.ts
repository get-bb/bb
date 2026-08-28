import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
import { Agent, type Dispatcher } from "undici";
import { cliFetch } from "./client.js";

export interface PluginCliContributionEntry {
  pluginId: string;
  name: string;
  summary: string;
  commands: Array<{ name: string; summary: string; usage: string }>;
}

const CONTRIBUTIONS_TIMEOUT_MS = 2000;

const CONTRIBUTIONS_TIMEOUT_MULTIPLIERS = [1, 2, 2] as const;
const CONTRIBUTIONS_RETRY_DELAYS_MS = [150, 500] as const;

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | {
      outcome: "unreachable";
      cause: unknown;
      attempts: number;
      lastTimeoutMs: number;
    }
  | { outcome: "invalid" };

interface UnreachableDiagnosis {
  blockedCode: "EPERM" | "EACCES" | undefined;
  timedOut: boolean;
  refused: boolean;
  retryable: boolean;
  messages: string[];
}

function diagnoseUnreachableServer(cause: unknown): UnreachableDiagnosis {
  let blockedCode: "EPERM" | "EACCES" | undefined;
  let timedOut = false;
  let retryableCode = false;
  const messages: string[] = [];
  const terminalCodes: Array<string | undefined> = [];
  const seen = new Set<object>();
  const pending: unknown[] = [cause];

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) {
      terminalCodes.push(undefined);
      continue;
    }
    if (seen.has(current)) {
      terminalCodes.push(undefined);
      continue;
    }
    seen.add(current);
    const record = current as {
      cause?: unknown;
      code?: unknown;
      errors?: unknown;
      name?: unknown;
      message?: unknown;
    };
    const code = typeof record.code === "string" ? record.code : undefined;
    if (code === "EPERM" || code === "EACCES") {
      blockedCode ??= code;
    }
    if (code !== undefined && RETRYABLE_CODES.has(code)) {
      retryableCode = true;
    }
    if (record.name === "TimeoutError" || record.name === "AbortError") {
      timedOut = true;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      messages.push(record.message);
    }

    const children: unknown[] = [];
    if (record.cause !== undefined && record.cause !== null) {
      children.push(record.cause);
    }
    if (Array.isArray(record.errors)) {
      children.push(...record.errors);
    }
    if (children.length === 0) {
      terminalCodes.push(code);
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  const refused =
    terminalCodes.length > 0 &&
    terminalCodes.every((code) => code === "ECONNREFUSED");

  return {
    blockedCode,
    timedOut,
    refused,
    retryable:
      blockedCode === undefined && !refused && (timedOut || retryableCode),
    messages,
  };
}

export function describeUnreachableServer(
  baseUrl: string,
  cause: unknown,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
  attempts = 1,
): string {
  const { blockedCode, timedOut, refused, retryable, messages } =
    diagnoseUnreachableServer(cause);

  if (blockedCode !== undefined) {
    return (
      `Cannot reach bb at ${baseUrl}: ${blockedCode} — the connection was blocked. ` +
      `bb may still be running; check sandbox or firewall rules for this shell.`
    );
  }
  if (refused) {
    return `bb is not running at ${baseUrl} — open the bb app, then re-run this command.`;
  }
  if (timedOut || retryable) {
    const tried =
      attempts > 1
        ? ` after ${attempts} attempts (last window ${timeoutMs}ms)`
        : ` within ${timeoutMs}ms`;
    return (
      `bb did not respond at ${baseUrl}${tried} — it may be busy or temporarily unreachable. ` +
      `No server response was received and your command did not run; re-run it.`
    );
  }
  return `Cannot reach bb at ${baseUrl}: ${
    messages.length > 0 ? messages.join(": ") : String(cause)
  }`;
}

interface FetchPluginCliContributionsOptions {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
  options: FetchPluginCliContributionsOptions = {},
): Promise<PluginCliContributionsResult> {
  const sleep = options.sleep ?? defaultSleep;
  for (
    let attempt = 0;
    attempt < CONTRIBUTIONS_TIMEOUT_MULTIPLIERS.length;
    attempt += 1
  ) {
    const window = timeoutMs * CONTRIBUTIONS_TIMEOUT_MULTIPLIERS[attempt]!;
    try {
      const response = await cliFetch(
        `${baseUrl}/api/v1/plugins/contributions`,
        {
          signal: AbortSignal.timeout(window),
        },
      );
      if (!response.ok) return { outcome: "invalid" };
      let parsed: { cliCommands?: unknown } | null;
      try {
        parsed = (await response.json()) as {
          cliCommands?: unknown;
        } | null;
      } catch (error) {
        if (!diagnoseUnreachableServer(error).retryable) {
          return { outcome: "invalid" };
        }
        throw error;
      }
      const cliCommands = parsed?.cliCommands;
      if (!Array.isArray(cliCommands)) return { outcome: "invalid" };
      return {
        outcome: "ok",
        contributions: cliCommands.filter(
          (entry): entry is PluginCliContributionEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { pluginId?: unknown }).pluginId === "string" &&
            typeof (entry as { name?: unknown }).name === "string",
        ),
      };
    } catch (error) {
      const isLastAttempt =
        attempt === CONTRIBUTIONS_TIMEOUT_MULTIPLIERS.length - 1;
      if (isLastAttempt || !diagnoseUnreachableServer(error).retryable) {
        return {
          outcome: "unreachable",
          cause: error,
          attempts: attempt + 1,
          lastTimeoutMs: window,
        };
      }
      await sleep(CONTRIBUTIONS_RETRY_DELAYS_MS[attempt]!);
    }
  }
  return { outcome: "invalid" };
}

export async function findDisabledPluginForCommand(
  baseUrl: string,
  name: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<{
  id: string;
  enabled: boolean;
  status: string | null;
  statusDetail: string | null;
} | null> {
  try {
    const response = await cliFetch(`${baseUrl}/api/v1/plugins`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { plugins?: unknown } | null;
    if (!Array.isArray(parsed?.plugins)) return null;
    const match = parsed.plugins.find(
      (
        entry,
      ): entry is {
        id: string;
        enabled: boolean;
        status?: unknown;
        statusDetail?: unknown;
      } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { id?: unknown }).id === name &&
        typeof (entry as { enabled?: unknown }).enabled === "boolean" &&
        ((entry as { enabled?: unknown }).enabled === false ||
          (entry as { status?: unknown }).status === "disabled"),
    );
    return match === undefined
      ? null
      : {
          id: match.id,
          enabled: match.enabled,
          status: typeof match.status === "string" ? match.status : null,
          statusDetail:
            typeof match.statusDetail === "string" ? match.statusDetail : null,
        };
  } catch {
    return null;
  }
}

export function findPluginCliCommand(
  contributions: readonly PluginCliContributionEntry[],
  name: string,
): PluginCliContributionEntry | undefined {
  return contributions.find((entry) => entry.name === name);
}

interface PluginCliOutputStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

interface PluginCliOutputStreams {
  stdout: PluginCliOutputStream;
  stderr: PluginCliOutputStream;
}

async function writePluginCliOutput(
  stream: PluginCliOutputStream,
  value: string,
): Promise<void> {
  if (value.length === 0) return;
  const output = value.endsWith("\n") ? value : `${value}\n`;
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.write(output, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

export const PLUGIN_CLI_HEADERS_TIMEOUT_MS = 65 * 60 * 1000;
let pluginCliDispatcher: Dispatcher | undefined;
function getPluginCliDispatcher(): Dispatcher {
  pluginCliDispatcher ??= new Agent({
    headersTimeout: PLUGIN_CLI_HEADERS_TIMEOUT_MS,
  });
  return pluginCliDispatcher;
}

export async function runPluginCliCommand(
  baseUrl: string,
  pluginId: string,
  argv: string[],
  streams: PluginCliOutputStreams = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const threadId = resolveContextThreadId();
  const projectId = resolveContextProjectId();
  const response = await cliFetch(
    `${baseUrl}/api/v1/plugins/${encodeURIComponent(pluginId)}/cli`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        argv,
        cwd: process.cwd(),
        ...(threadId ? { threadId } : {}),
        ...(projectId ? { projectId } : {}),
      }),
      dispatcher: getPluginCliDispatcher(),
    },
  );
  const result = (await response.json().catch(() => null)) as {
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    error?: unknown;
  } | null;
  if (result === null || typeof result.exitCode !== "number") {
    await writePluginCliOutput(
      streams.stderr,
      typeof result?.error === "string"
        ? result.error
        : `Unexpected response from the plugin CLI endpoint (HTTP ${response.status})`,
    );
    return 1;
  }
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    await writePluginCliOutput(streams.stdout, result.stdout);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    await writePluginCliOutput(streams.stderr, result.stderr);
  }
  return result.exitCode;
}
