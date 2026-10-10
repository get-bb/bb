import conductorIcon from "../../assets/competitors/conductor.png";
import type { BrandLogo } from "../compare-visuals";
import type { CompareMeta } from "../compare-types";

export const CONDUCTOR_LOGO: BrandLogo = { kind: "image", src: conductorIcon };

export const meta: CompareMeta = {
  slug: "conductor-alternatives",
  competitor: { name: "Conductor", logo: CONDUCTOR_LOGO },
};
