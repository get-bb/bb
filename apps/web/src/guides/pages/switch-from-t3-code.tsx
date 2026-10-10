import type { Guide } from "../guide-types";
import { SWITCH_TOOLS, switchGuide } from "../shared/switch";
import { meta } from "./switch-from-t3-code.meta";

export const guide: Guide = switchGuide(meta, SWITCH_TOOLS["t3-code"]);
