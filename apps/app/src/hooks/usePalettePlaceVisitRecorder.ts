import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { resolvePalettePlaceVisit } from "@/lib/command-palette/palette-places";
import { recordPaletteVisit } from "@/lib/command-palette/palette-visits";
import { usePluginSlots } from "@/lib/plugin-slots";

export function usePalettePlaceVisitRecorder(): void {
  const { pathname } = useLocation();
  const { navPanels } = usePluginSlots();
  const visit = resolvePalettePlaceVisit(pathname, navPanels);
  const kind = visit?.kind ?? null;
  const id = visit?.id ?? null;
  useEffect(() => {
    if (kind === null || id === null) return;
    recordPaletteVisit(kind, id);
  }, [kind, id]);
}
