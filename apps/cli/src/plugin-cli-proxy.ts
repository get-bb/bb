import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
import { Agent, type Dispatcher } from "undici";
import { z } from "zod";
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

const pluginCliContributionSchema = z.object({
  pluginId: z.string(),
  name: z.string(),
  summary: z.string(),
  commands: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      usage: z.string(),
    }),
  ),
});
const pluginContributionsResponseSchema = z
  .object({ cliCommands: z.array(z.unknown()).optional() })
  .nullable();
const pluginListResponseSchema = z
  .object({ plugins: z.array(z.unknown()).optional() })
  .nullable();
const pluginListEntrySchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  status: z.unknown().optional(),
  statusDetail: z.unknown().optional(),
});
const pluginCliResultSchema = z
  .object({
    exitCode: z.number().optional(),
    stdout: z.unknown().optional(),
    stderr: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .nullable();

interface CauseRecord {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
  name?: unknown;
  message?: unknown;
}

function isCauseRecord(cause: unknown): cause is CauseRecord {
  return cause !== null && Object(cause) === cause && !Array.isArray(cause);
}

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
    if (!isCauseRecord(current)) {
      terminalCodes.push(undefined);
      continue;
    }
    if (seen.has(current)) {
      terminalCodes.push(undefined);
      continue;
    }
    seen.add(current);
    const record = current;
    const codeResult = z.string().safeParse(record.code);
    const code = codeResult.success ? codeResult.data : undefined;
    if (code === "EPERM" || code === "EACCES") {
      blockedCode ??= code;
    }
    if (code !== undefined && RETRYABLE_CODES.has(code)) {
      retryableCode = true;
    }
    if (record.name === "TimeoutError" || record.name === "AbortError") {
      timedOut = true;
    }
    const messageResult = z.string().safeParse(record.message);
    if (messageResult.success && messageResult.data.length > 0) {
      messages.push(messageResult.data);
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
      let parsed: z.infer<typeof pluginContributionsResponseSchema>;
      try {
        parsed = pluginContributionsResponseSchema.parse(await response.json());
      } catch (error) {
        if (!diagnoseUnreachableServer(error).retryable) {
          return { outcome: "invalid" };
        }
        throw error;
      }
      const cliCommands = parsed?.cliCommands;
      if (cliCommands === undefined) return { outcome: "invalid" };
      return {
        outcome: "ok",
        contributions: cliCommands.flatMap((entry) => {
          const contribution = pluginCliContributionSchema.safeParse(entry);
          return contribution.success ? [contribution.data] : [];
        }),
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
    const parsed = pluginListResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data?.plugins === undefined) return null;
    const entries = parsed.data.plugins.flatMap((entry) => {
      const plugin = pluginListEntrySchema.safeParse(entry);
      return plugin.success ? [plugin.data] : [];
    });
    const match = entries.find(
      (entry) =>
        entry.id === name &&
        (entry.enabled === false || entry.status === "disabled"),
    );
    return match === undefined
      ? null
      : {
          id: match.id,
          enabled: match.enabled,
          status: (() => {
            const result = z.string().safeParse(match.status);
            return result.success ? result.data : null;
          })(),
          statusDetail: (() => {
            const result = z.string().safeParse(match.statusDetail);
            return result.success ? result.data : null;
          })(),
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

interface PluginCliRequestBody {
  argv: string[];
  cwd: string;
  threadId?: string;
  projectId?: string;
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
      body: JSON.stringify(
        (() => {
          const requestBody: PluginCliRequestBody = {
            argv,
            cwd: process.cwd(),
          };
          if (threadId) requestBody.threadId = threadId;
          if (projectId) requestBody.projectId = projectId;
          return requestBody;
        })(),
      ),
      dispatcher: getPluginCliDispatcher(),
    },
  );
  const parsedResult = pluginCliResultSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (
    !parsedResult.success ||
    parsedResult.data === null ||
    parsedResult.data.exitCode === undefined
  ) {
    await writePluginCliOutput(
      streams.stderr,
      (() => {
        const result = z
          .string()
          .safeParse(parsedResult.success ? parsedResult.data?.error : null);
        return result.success
          ? result.data
          : `Unexpected response from the plugin CLI endpoint (HTTP ${response.status})`;
      })(),
    );
    return 1;
  }
  const stdoutResult = z.string().safeParse(parsedResult.data.stdout);
  if (stdoutResult.success && stdoutResult.data.length > 0) {
    await writePluginCliOutput(streams.stdout, stdoutResult.data);
  }
  const stderrResult = z.string().safeParse(parsedResult.data.stderr);
  if (stderrResult.success && stderrResult.data.length > 0) {
    await writePluginCliOutput(streams.stderr, stderrResult.data);
  }
  return parsedResult.data.exitCode;
}
