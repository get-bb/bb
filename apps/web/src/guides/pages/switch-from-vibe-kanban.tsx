import type { Guide, GuideMeta } from "../guide-types";
import { SWITCH_TOOLS, switchGuide } from "../shared/switch";

export const meta: GuideMeta = {
  slug: "switch-from-vibe-kanban",
  title: "Switch from Vibe Kanban to bb",
  nav: null,
  canonical: null,
};

export const guide: Guide = switchGuide(meta, SWITCH_TOOLS["vibe-kanban"]);
