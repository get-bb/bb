import { z } from "zod";

/** `GET /plugins/:id/logs?tail=` is not in the typed SDK (server-policy glue). */
const pluginLogsResponseSchema = z.object({
  ok: z.literal(true),
  lines: z.array(z.string()),
});

export const PLUGIN_LOGS_DEFAULT_TAIL = 200;
const PLUGIN_LOGS_MAX_TAIL = 10_000;

function buildPluginLogsUrl(
  serverUrl: string,
  pluginId: string,
  tail: number,
): string {
  const base = serverUrl.replace(/\/+$/u, "");
  const clamped = Math.min(Math.max(Math.trunc(tail), 1), PLUGIN_LOGS_MAX_TAIL);
  return `${base}/api/v1/plugins/${encodeURIComponent(pluginId)}/logs?tail=${clamped}`;
}

export async function fetchPluginLogs(
  fetchImpl: typeof fetch,
  serverUrl: string,
  pluginId: string,
  tail: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetchImpl(
    buildPluginLogsUrl(serverUrl, pluginId, tail),
    { signal },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Unknown plugin"
        : `Could not load plugin logs (HTTP ${response.status})`,
    );
  }
  const json: unknown = await response.json();
  return pluginLogsResponseSchema.parse(json).lines;
}

/**
 * Log lines are plain text from the plugin host; a line can be long (JSON
 * payloads). The viewer renders them newest last, numbered from the tail.
 */
export interface PluginLogLine {
  key: string;
  index: number;
  text: string;
}

export function toPluginLogLines(lines: readonly string[]): PluginLogLine[] {
  return lines.map((text, index) => ({
    key: `${index}:${text.length}`,
    index,
    text,
  }));
}
