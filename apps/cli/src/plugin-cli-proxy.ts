import {
  resolveContextProjectId,
  resolveContextThreadId,
} from "./context-env.js";

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
 * (fetch threw: server down, timeout) is distinguished from "invalid" (an
 * old server without the route, or a malformed payload) so unknown-command
 * handling can tell the user to start bb instead of printing a misleading
 * "unknown command" for a plugin command that would exist if bb were up.
 */
export type PluginCliContributionsResult =
  | { outcome: "ok"; contributions: PluginCliContributionEntry[] }
  | { outcome: "unreachable" }
  | { outcome: "invalid" };

/** Fetch plugin CLI contributions with a short timeout. */
export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<PluginCliContributionsResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/plugins/contributions`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { outcome: "unreachable" };
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
    const response = await fetch(`${baseUrl}/api/v1/plugins`, {
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
            typeof match.statusDetail === "string"
              ? match.statusDetail
              : null,
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

/**
 * Proxy one invocation to the server and mirror its output. Returns the
 * command's exit code.
 */
export async function runPluginCliCommand(
  baseUrl: string,
  pluginId: string,
  argv: string[],
): Promise<number> {
  const threadId = resolveContextThreadId();
  const projectId = resolveContextProjectId();
  const response = await fetch(
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
    console.error(
      typeof result?.error === "string"
        ? result.error
        : `Unexpected response from the plugin CLI endpoint (HTTP ${response.status})`,
    );
    return 1;
  }
  if (typeof result.stdout === "string" && result.stdout.length > 0) {
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  }
  if (typeof result.stderr === "string" && result.stderr.length > 0) {
    process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  }
  return result.exitCode;
}
