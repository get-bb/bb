/**
 * The deprecated `customAcpAgents` array in `<dataDir>/config.json`.
 *
 * Before the ACP agents were the plugin's own, a user configured an agent by
 * hand-editing bb's managed config file and the server composed it into the
 * provider list. That path is deprecated: the plugin's `customAgents` setting
 * replaces it. bb keeps READING the old file until the release named by
 * {@link LEGACY_CUSTOM_AGENTS_REMOVED_IN} so an existing agent keeps working,
 * logs each one it finds, and never writes to it. Delete this module when the
 * deprecation window closes.
 *
 * The data directory comes from the server (`bb.server.experimental_dataDir`)
 * rather than from this module's own guess: a dev server's data dir is
 * `~/.bb-dev/<instance>`, derived from its repo root, so a plugin that
 * resolved `~/.bb` itself would read the production file while the server
 * read another one.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CustomAcpAgent } from "./agents.js";

/**
 * The release that stops reading the file. bb 0.39 shipped the setting, so
 * two minor releases of overlap is 0.41. The owner sets this; the prose in
 * every user-facing surface names the constant instead of restating a
 * duration, so there is one number to change.
 */
export const LEGACY_CUSTOM_AGENTS_REMOVED_IN = "0.41";

const legacyConfigSchema = z
  .object({ customAcpAgents: z.array(z.unknown()).optional() })
  .passthrough();

function legacyConfigPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

/**
 * The legacy `logo` field, removed before the entry reaches the shared agent
 * schema.
 *
 * The old config let a user point at a logo file, which the server served
 * from a route of its own. A plugin's icon is a host glyph or an asset the
 * plugin ships, so a configured agent takes the generic glyph. Stripping it
 * HERE, in the module that dies with the deprecation, is what lets the
 * `customAgents` setting schema stay strict about a field it does not have.
 */
function withoutLegacyLogo(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return entry;
  }
  if (!Object.hasOwn(entry, "logo")) {
    return entry;
  }
  const { logo: _logo, ...rest } = entry as Record<string, unknown>;
  return rest;
}

/**
 * The agents the deprecated file declares. A missing file is the normal case
 * and is not a problem; anything else the caller logs.
 */
export async function readLegacyCustomAcpAgents(
  dataDir: string,
): Promise<{ entries: unknown[]; problem?: string }> {
  const path = legacyConfigPath(dataDir);
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
  return { entries: (config.data.customAcpAgents ?? []).map(withoutLegacyLogo) };
}

/** The deprecation notice for one legacy agent, ready to log. */
export function legacyAgentDeprecationMessage(agent: CustomAcpAgent): string {
  return (
    `Custom ACP agent "${agent.id}" comes from the deprecated customAcpAgents ` +
    `array in config.json. bb reads it until ${LEGACY_CUSTOM_AGENTS_REMOVED_IN}; ` +
    `move it to the ACP providers plugin's "customAgents" setting.`
  );
}
