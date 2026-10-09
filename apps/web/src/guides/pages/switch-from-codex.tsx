import type { Guide, GuideMeta } from "../guide-types";
import { SWITCH_TOOLS, switchGuide } from "../shared/switch";

export const meta: GuideMeta = {
  slug: "switch-from-codex",
  title: "Switch from Codex to bb",
  nav: null,
  canonical: null,
};

export const guide: Guide = switchGuide(meta, SWITCH_TOOLS["codex-app"]);
