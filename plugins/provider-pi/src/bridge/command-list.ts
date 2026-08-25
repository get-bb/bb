import type { ExperimentalProviderCommand } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

/**
 * Pi's `get_commands` answer: every slash command the session would accept.
 * `sourceInfo.scope` is where the owning resource lives (`project` for the
 * workspace's `.pi/`, anything else the user's own).
 */
const piRpcCommandSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    source: z.enum(["extension", "prompt", "skill"]),
    sourceInfo: z.object({ scope: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * The commands pi's resources register for a cwd that bb cannot see
 * statically: extension commands (registered by executing the trusted,
 * cwd-bound extension) and prompt templates. Skills are left out — the
 * daemon scans pi's skill roots itself and would list each one twice.
 * Unknown entries are dropped, not guessed at.
 */
export function toPiExtensionCommands(raw: unknown): ExperimentalProviderCommand[] {
  const entries = z.array(z.unknown()).safeParse(raw);
  if (!entries.success) {
    return [];
  }
  const commands: ExperimentalProviderCommand[] = [];
  for (const entry of entries.data) {
    const parsed = piRpcCommandSchema.safeParse(entry);
    if (!parsed.success || parsed.data.source === "skill") {
      continue;
    }
    commands.push({
      name: parsed.data.name,
      source: "command",
      origin: parsed.data.sourceInfo?.scope === "project" ? "project" : "user",
      description: parsed.data.description ?? null,
      argumentHint: null,
    });
  }
  return commands;
}

/**
 * The names pi would hand to an extension's command handler (`source:
 * "extension"`, load-order suffixes included): the inputs pi executes to
 * completion before it answers `prompt`, on no input queue and with no agent
 * run of their own.
 */
export function toPiExtensionCommandNames(raw: unknown): Set<string> {
  const names = new Set<string>();
  const entries = z.array(z.unknown()).safeParse(raw);
  if (!entries.success) {
    return names;
  }
  for (const entry of entries.data) {
    const parsed = piRpcCommandSchema.safeParse(entry);
    if (parsed.success && parsed.data.source === "extension") {
      names.add(parsed.data.name);
    }
  }
  return names;
}
