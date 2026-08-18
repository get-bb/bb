import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
import type { Dispatcher } from "undici";
import { cliFetch } from "./client.js";

/**
 * Plugin-contributed `bb` subcommands (server design §4.4). The CLI fetches
 * metadata from GET /api/v1/plugins/contributions and proxies invocations to
 * POST /api/v1/plugins/:id/cli — plugin code only ever runs server-side.
 */
export interface PluginCliContributionEntry {
  pluginId: string;
  name: string;
  summary: string;
  commands: Array<{ name: string; summary: string; usage: string }>;
}

const CONTRIBUTIONS_TIMEOUT_MS = 2000;

/**
 * The probe is retried on transient causes that may mean the server exists but
 * did not answer in time — a busy event loop, a dropped keep-alive socket. The
 * server's contributions latency is sharply bimodal (single-digit ms at rest,
 * hundreds of ms to seconds while it is under load), so a single 2s attempt
 * turns an ordinary stall into a hard failure and the user's command never
 * runs. Escalating the window rather than repeating it gives a server stalled
 * mid-GC room to finish instead of re-hitting the same block.
 *
 * Not retried: ECONNREFUSED (nothing is listening — bb really is down, and
 * waiting only delays a correct answer) and EPERM/EACCES (a sandbox or
 * firewall is blocking this shell — no amount of waiting changes that).
 */
const CONTRIBUTIONS_TIMEOUT_MULTIPLIERS = [1, 2, 2] as const;
const CONTRIBUTIONS_RETRY_DELAYS_MS = [150, 500] as const;

/** Transport-level codes that mean "retry", not "give up". */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Result of asking the server for plugin CLI contributions. "unreachable"
 * (fetch threw: server down, blocked, timeout) is distinguished from
 * "invalid" (an old server without the route, or a malformed payload) so
 * unknown-command handling can tell the user to start bb instead of printing
 * a misleading "unknown command" for a plugin command that would exist if bb
 * were up. The thrown error is kept: EPERM (blocked shell) and a timeout mean
 * something very different from ECONNREFUSED (nothing listening). `attempts`
 * records how many probes were spent so the message can say so.
 */
export type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | {
      outcome: "unreachable";
      cause: unknown;
      attempts: number;
      lastTimeoutMs: number;
    }
  | { outcome: "invalid" };

/** What a failed probe tells us about the server, independent of wording. */
export interface UnreachableDiagnosis {
  blockedCode: "EPERM" | "EACCES" | undefined;
  timedOut: boolean;
  refused: boolean;
  retryable: boolean;
  messages: string[];
}

/**
 * Walk the cause chain of a failed fetch — Node wraps the real errno in
 * `TypeError: fetch failed`, and a multi-address connect wraps several in an
 * AggregateError — and report every signal it carries. Kept separate from the
 * wording so the retry decision and the message cannot drift apart.
 */
export function diagnoseUnreachableServer(
  cause: unknown,
): UnreachableDiagnosis {
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
    // A blocked connection is never retryable even if it also timed out:
    // the sandbox rule that rejected it will reject the next probe too.
    retryable:
      blockedCode === undefined && !refused && (timedOut || retryableCode),
    messages,
  };
}

/**
 * Diagnose a failed probe of the server without overclaiming: only when every
 * connection attempt reports ECONNREFUSED is there evidence that bb is not
 * running. Blocked connections (sandboxed agent shells) and timeouts name the
 * address and errno so the reader — often an agent — does not declare a
 * running bb dead.
 */
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
  // A retryable transport failure does not prove bb is down, but it also does
  // not prove bb is running: the timeout covers DNS lookup and connection
  // setup as well as waiting for a response. Say the command did not run and
  // that retrying is the fix, because the reader is usually an agent that will
  // otherwise record the write as impossible and silently drop it.
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

export interface FetchPluginCliContributionsOptions {
  /** Injected so tests exercise the retry schedule without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch plugin CLI contributions, retrying transient transport failures.
 *
 * This probe gates every plugin-contributed command (`bb memory add`,
 * `bb tasks ...`), so a false negative here does not merely misreport — it
 * stops the command from running at all. Failing the whole invocation on one
 * 2s window made a busy machine look like a stopped app; the work is retried
 * instead, and only a genuinely refused or blocked connection fails fast.
 */
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
        // JSON syntax is an invalid old/malformed route response. Transport
        // failures while consuming a valid response are still probe failures
        // and follow the same retry policy as failures before the headers.
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

/**
 * Look up an installed-but-disabled plugin whose id matches the unknown
 * command name (the `bb <id>` convention builtins follow), so `bb connect`
 * with the connect plugin disabled explains itself instead of erroring with
 * "unknown command". Best effort: any failure returns null.
 */
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

/**
 * The first CLI token is a plugin-proxy candidate only when it looks like a
 * command (not a flag) and no core command claims it. Core commands always
 * win: commander resolved them before this path runs.
 */
export function pluginProxyCandidate(
  firstArg: string | undefined,
  knownCommandNames: ReadonlySet<string>,
): string | null {
  if (firstArg === undefined || firstArg.length === 0) return null;
  if (firstArg.startsWith("-")) return null;
  if (knownCommandNames.has(firstArg)) return null;
  return firstArg;
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

/**
 * Plugin commands run to completion inside one POST and the server sends
 * nothing — not even response headers — until the command returns. A command
 * that waits on a human (`bb secret request` holds the request open until the
 * form is submitted, up to the 10-minute interaction timeout) can therefore
 * outlive Node's default undici `headersTimeout` of 300 s, which rejects the
 * fetch with a bare "fetch failed" and aborts the interaction server-side.
 * Dispatch these calls with a headers timeout above the server's longest
 * interaction (`ui.requestInput` allows at most 60 minutes), so the server's
 * own deadline decides first, but keep it finite: the server has no general
 * plugin-command deadline, and a plugin that never resolves must not hold the
 * CLI process and its socket forever. undici is imported lazily so built-in
 * `bb` commands do not pay its startup cost.
 */
export const PLUGIN_CLI_HEADERS_TIMEOUT_MS = 65 * 60 * 1000;
let pluginCliDispatcher: Promise<Dispatcher> | undefined;
function getPluginCliDispatcher(): Promise<Dispatcher> {
  pluginCliDispatcher ??= import("undici").then(
    ({ Agent }) => new Agent({ headersTimeout: PLUGIN_CLI_HEADERS_TIMEOUT_MS }),
  );
  return pluginCliDispatcher;
}

/**
 * Proxy one invocation to the server and mirror its output. Returns the
 * command's exit code after both output streams have flushed. Waiting for the
 * write callbacks is required because callers terminate the CLI process as
 * soon as this promise resolves; an immediate exit can otherwise drop every
 * buffered byte after the platform pipe capacity.
 */
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
      dispatcher: await getPluginCliDispatcher(),
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
