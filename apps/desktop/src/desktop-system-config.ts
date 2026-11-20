import {
  appCommandIdSchema,
  appKeybindingSchema,
  appShortcutSchema,
  type AppKeybinding,
  type AppKeybindings,
} from "@bb/domain";
import { z } from "zod";
import { STARTUP_RELOAD_KEYBINDINGS } from "./desktop-reload-shortcut.js";

const desktopKeybindingSchema = appKeybindingSchema.extend({
  command: z.string(),
});

const desktopDefaultKeybindingSchema = z.object({
  command: z.string(),
  shortcut: appShortcutSchema.nullable(),
});

const desktopSystemConfigSchema = z.object({
  defaultKeybindings: z.array(desktopDefaultKeybindingSchema).max(256),
  keybindings: z.array(desktopKeybindingSchema).max(256),
});

interface DesktopSystemConfig {
  keybindings: AppKeybindings;
}

export function parseDesktopSystemConfig(
  payload: unknown,
): DesktopSystemConfig {
  const parsed = desktopSystemConfigSchema.parse(payload);
  const keybindings: AppKeybinding[] = STARTUP_RELOAD_KEYBINDINGS.filter(
    (startup) =>
      !parsed.defaultKeybindings.some(
        (binding) =>
          binding.command === startup.command && binding.shortcut !== null,
      ),
  );
  for (const binding of parsed.keybindings) {
    const command = appCommandIdSchema.safeParse(binding.command);
    if (!command.success) {
      continue;
    }
    keybindings.push({ ...binding, command: command.data });
  }
  return { keybindings };
}
