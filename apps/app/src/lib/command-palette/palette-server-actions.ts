import type { DesktopServerTargetsControl } from "@/hooks/useDesktopServerTargets";
import type { PaletteAction } from "./palette-action";

export function buildServerPaletteActions(
  control: DesktopServerTargetsControl | null,
): PaletteAction[] {
  if (control === null) {
    return [];
  }
  return control.servers
    .filter((server) => !server.active)
    .map((server) => ({
      id: `server:${server.id}`,
      bucket: "Actions" as const,
      group: "Servers",
      title: `Switch to server: ${server.name}`,
      shortcut: null,
      run: () => control.select(server.id),
    }));
}
