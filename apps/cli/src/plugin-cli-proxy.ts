import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";
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
 * Result of asking the server for plugin CLI contributions. "unreachable"
 * (fetch threw: server down, blocked, timeout) is distinguished from
 * "invalid" (an old server without the route, or a malformed payload) so
 * unknown-command handling can tell the user to start bb instead of printing
 * a misleading "unknown command" for a plugin command that would exist if bb
 * were up. The thrown error is kept: EPERM (blocked shell) and a timeout mean
 * something very different from ECONNREFUSED (nothing listening).
 */
export type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | { outcome: "unreachable"; cause: unknown }
  | { outcome: "invalid" };

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
): string {
  let blockedCode: "EPERM" | "EACCES" | undefined;
  let timedOut = false;
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
    if (record.name === "TimeoutError") {
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

  if (blockedCode !== undefined) {
    return (
      `Cannot reach bb at ${baseUrl}: ${blockedCode} — the connection was blocked. ` +
      `bb may still be running; check sandbox or firewall rules for this shell.`
    );
  }
  if (timedOut) {
    return `bb did not respond at ${baseUrl} within ${timeoutMs}ms — it may be busy or unreachable.`;
  }
  if (
    terminalCodes.length > 0 &&
    terminalCodes.every((code) => code === "ECONNREFUSED")
  ) {
    return `bb is not running at ${baseUrl} — open the bb app, then re-run this command.`;
  }
  return `Cannot reach bb at ${baseUrl}: ${
    messages.length > 0 ? messages.join(": ") : String(cause)
  }`;
}

/** Fetch plugin CLI contributions with a short timeout. */
export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<PluginCliContributionsResult> {
  let response: Response;
  try {
    response = await cliFetch(`${baseUrl}/api/v1/plugins/contributions`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { outcome: "unreachable", cause: error };
  }
  try {
    if (!response.ok) return { outcome: "invalid" };
    const parsed = (await response.json()) as {
      cliCommands?: unknown;
    } | null;
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
  } catch {
    return { outcome: "invalid" };
  }
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
