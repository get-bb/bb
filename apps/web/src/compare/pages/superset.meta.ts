import supersetIcon from "../../assets/competitors/superset.png";
import type { BrandLogo } from "../compare-visuals";
import type { CompareMeta } from "../compare-types";

export const SUPERSET_LOGO: BrandLogo = { kind: "image", src: supersetIcon };

export const meta: CompareMeta = {
  slug: "superset-alternative",
  competitor: { name: "Superset", logo: SUPERSET_LOGO },
};
