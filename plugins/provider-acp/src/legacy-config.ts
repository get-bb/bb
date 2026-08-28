import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CustomAcpAgent } from "./agents.js";

export const LEGACY_CUSTOM_AGENTS_REMOVED_IN = "0.41";

const legacyConfigSchema = z
  .object({ customAcpAgents: z.array(z.unknown()).optional() })
  .passthrough();

const legacyConfigEntrySchema = z.object({}).passthrough();

function legacyConfigPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export async function readLegacyCustomAcpAgents(
  dataDir: string,
): Promise<{ entries: unknown[]; problem?: string }> {
  const path = legacyConfigPath(dataDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    return code === "ENOENT"
      ? { entries: [] }
      : { entries: [], problem: `could not read ${path}: ${String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      entries: [],
      problem: `${path} is not valid JSON: ${String(error)}`,
    };
  }
  const config = legacyConfigSchema.safeParse(parsed);
  if (!config.success) {
    return { entries: [], problem: `${path} is not a bb config file` };
  }
  const entries = (config.data.customAcpAgents ?? []).map((entry) => {
    const parsedEntry = legacyConfigEntrySchema.safeParse(entry);
    if (!parsedEntry.success || !Object.hasOwn(parsedEntry.data, "logo")) {
      return entry;
    }
    const { logo: _logo, ...rest } = parsedEntry.data;
    return rest;
  });
  return {
    entries,
  };
}

export function legacyAgentDeprecationMessage(agent: CustomAcpAgent): string {
  return (
    `Custom ACP agent "${agent.id}" comes from the deprecated customAcpAgents ` +
    `array in config.json. bb reads it until ${LEGACY_CUSTOM_AGENTS_REMOVED_IN}; ` +
    `move it to the ACP providers plugin's "customAgents" setting.`
  );
}
