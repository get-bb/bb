import {
  appCommandIdSchema,
  appKeybindingSchema,
  type AppKeybinding,
  type AppKeybindings,
} from "@bb/domain";
import { z } from "zod";

/**
 * The desktop shell reads `/api/v1/system/config` to drive the native browser
 * view's shortcut resolver and the application-menu accelerators. The shell
 * and the server are shipped separately (a desktop build talks to whatever
 * server it finds), so a newer server may send command ids this shell does
 * not know. Parsing the whole response with the shell's strict command enum
 * would then reject every binding. This parser accepts any command id, keeps
 * the bindings this shell understands, and drops the rest.
 */
const desktopKeybindingSchema = appKeybindingSchema.extend({
  command: z.string(),
});

const desktopSystemConfigSchema = z.object({
  keybindings: z.array(desktopKeybindingSchema).max(256),
});

export interface DesktopSystemConfig {
  keybindings: AppKeybindings;
}

export function parseDesktopSystemConfig(
  payload: unknown,
): DesktopSystemConfig {
  const parsed = desktopSystemConfigSchema.parse(payload);
  const keybindings: AppKeybinding[] = [];
  for (const binding of parsed.keybindings) {
    const command = appCommandIdSchema.safeParse(binding.command);
    if (!command.success) {
      continue;
    }
    keybindings.push({ ...binding, command: command.data });
  }
  return { keybindings };
}
