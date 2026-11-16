import {
  APP_SHELL_PLUGIN_LIST_ELEMENT_ID,
  pluginListResponseSchema,
} from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import { applyAppShellPluginList } from "@/hooks/cache-owners/plugin-cache-owner";

function parseShellPluginList(text: string) {
  try {
    const parsed = pluginListResponseSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.plugins : null;
  } catch {
    return null;
  }
}

export function seedPluginListFromAppShell(
  queryClient: QueryClient,
  doc: Document,
  servedAt: number,
): void {
  const element = doc.getElementById(APP_SHELL_PLUGIN_LIST_ELEMENT_ID);
  if (element === null) return;
  element.remove();
  const plugins = parseShellPluginList(element.textContent ?? "");
  if (plugins === null) {
    console.warn("bb: ignoring an unreadable plugin list in the app shell");
    return;
  }
  applyAppShellPluginList({ queryClient, plugins, servedAt });
}
