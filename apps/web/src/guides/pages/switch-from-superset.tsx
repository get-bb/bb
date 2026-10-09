import type { Guide, GuideMeta } from "../guide-types";
import { SWITCH_TOOLS, switchGuide } from "../shared/switch";

export const meta: GuideMeta = {
  slug: "switch-from-superset",
  title: "Switch from Superset to bb",
  nav: null,
  canonical: null,
};

export const guide: Guide = switchGuide(meta, SWITCH_TOOLS.superset);
