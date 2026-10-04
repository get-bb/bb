import { TOOLS_SECTIONS } from "@/components/tools/tools-navigation";
import type { PaletteAction } from "./palette-action";

interface BuildToolsPagePaletteActionsArgs {
  navigate: (path: string) => void;
}

export function buildToolsPagePaletteActions(
  args: BuildToolsPagePaletteActionsArgs,
): PaletteAction[] {
  return [TOOLS_SECTIONS.plugins, TOOLS_SECTIONS.skills].map((section) => ({
    id: `tools:${section.id}`,
    bucket: "Plugins" as const,
    group: "Pages",
    title: section.label,
    shortcut: null,
    run: () => args.navigate(section.to),
  }));
}
