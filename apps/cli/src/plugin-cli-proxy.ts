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
 * Fetch plugin CLI contributions with a short timeout. Returns null on any
 * failure (server down, old server, timeout) so unknown-command handling can
 * silently fall back to the normal commander error.
 */
export async function fetchPluginCliContributions(
  baseUrl: string,
  timeoutMs: number = CONTRIBUTIONS_TIMEOUT_MS,
): Promise<PluginCliContributionEntry[] | null> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/plugins/contributions`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as {
      cliCommands?: unknown;
    } | null;
    const cliCommands = parsed?.cliCommands;
    if (!Array.isArray(cliCommands)) return null;
    return cliCommands.filter(
      (entry): entry is PluginCliContributionEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { pluginId?: unknown }).pluginId === "string" &&
        typeof (entry as { name?: unknown }).name === "string",
    );
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
