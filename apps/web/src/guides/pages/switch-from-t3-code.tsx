import type { Guide, GuideMeta } from "../guide-types";
import { SWITCH_TOOLS, switchGuide } from "../shared/switch";

export const meta: GuideMeta = {
  slug: "switch-from-t3-code",
  title: "Switch from T3 Code to bb",
  nav: null,
  canonical: null,
};

export const guide: Guide = switchGuide(meta, SWITCH_TOOLS["t3-code"]);
