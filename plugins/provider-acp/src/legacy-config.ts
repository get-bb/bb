/**
 * The deprecated `customAcpAgents` array in `<dataDir>/config.json`.
 *
 * Before the ACP agents were the plugin's own, a user configured an agent by
 * hand-editing bb's managed config file and the server composed it into the
 * provider list. That path is deprecated: the plugin's `customAgents` setting
 * replaces it. bb keeps READING the old file for two minor releases so an
 * existing agent keeps working, logs each one it finds, and never writes to
 * it. Delete this module when the deprecation window closes.
 *
 * Resolving the data dir here duplicates the server's own resolution, which a
 * plugin cannot import. That duplication is deliberate and temporary: it is
 * confined to this module and dies with it.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { customAcpAgentsSchema, type CustomAcpAgent } from "./agents.js";

/** The release that stops reading the file. */
export const LEGACY_CUSTOM_AGENTS_REMOVED_IN = "0.40";

const legacyConfigSchema = z
  .object({ customAcpAgents: z.array(z.unknown()).optional() })
  .passthrough();

function resolveDataDir(env: NodeJS.ProcessEnv, home: string): string {
  const configured = env["BB_DATA_DIR"]?.trim();
  if (configured === undefined || configured.length === 0) {
    return join(home, ".bb");
  }
  if (configured === "~") return home;
  if (configured.startsWith("~/")) return join(home, configured.slice(2));
  return isAbsolute(configured) ? configured : join(home, configured);
}

export function legacyConfigPath(args?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): string {
  return join(
    resolveDataDir(args?.env ?? process.env, args?.home ?? homedir()),
    "config.json",
  );
}

/**
 * The agents the deprecated file declares. A missing file is the normal case
 * and is not a problem; anything else the caller logs.
 */
export async function readLegacyCustomAcpAgents(args?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): Promise<{ entries: unknown[]; problem?: string }> {
  const path = legacyConfigPath(args);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { entries: [] }
      : { entries: [], problem: `could not read ${path}: ${String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { entries: [], problem: `${path} is not valid JSON: ${String(error)}` };
  }
  const config = legacyConfigSchema.safeParse(parsed);
  if (!config.success) {
    return { entries: [], problem: `${path} is not a bb config file` };
  }
  return { entries: config.data.customAcpAgents ?? [] };
}

/** The deprecation notice for one legacy agent, ready to log. */
export function legacyAgentDeprecationMessage(agent: CustomAcpAgent): string {
  return (
    `Custom ACP agent "${agent.id}" comes from the deprecated customAcpAgents ` +
    `array in config.json. bb reads it until ${LEGACY_CUSTOM_AGENTS_REMOVED_IN}; ` +
    `move it to the ACP providers plugin's "customAgents" setting.`
  );
}

export { customAcpAgentsSchema };
