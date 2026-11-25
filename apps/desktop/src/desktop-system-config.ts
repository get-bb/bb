import {
  appCommandIdSchema,
  appKeybindingSchema,
  appShortcutSchema,
  type AppKeybinding,
  type AppKeybindings,
} from "@bb/domain";
import { serverRouteSchema } from "@bb/server-contract";
import { z } from "zod";
import { STARTUP_RELOAD_KEYBINDINGS } from "./desktop-reload-shortcut.js";
import type { ServerRouteEntry } from "./server-target.js";

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
  serverId: z.string().min(1).optional(),
  routes: z.array(serverRouteSchema).max(64).optional().catch(undefined),
});

export interface AdvertisedServerRoutes {
  serverId: string;
  routes: ServerRouteEntry[];
}

interface DesktopSystemConfig {
  keybindings: AppKeybindings;
  serverRoutes: AdvertisedServerRoutes | null;
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
  return {
    keybindings,
    serverRoutes:
      parsed.serverId === undefined
        ? null
        : {
            serverId: parsed.serverId,
            routes: (parsed.routes ?? []).map((route) => ({
              url: route.url,
              kind: route.kind,
              providerId: route.providerId,
              label: route.displayName,
            })),
          },
  };
}
