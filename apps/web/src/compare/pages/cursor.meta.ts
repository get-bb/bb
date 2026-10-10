import cursorIcon from "../../assets/competitors/cursor.png";
import type { BrandLogo } from "../compare-visuals";
import type { CompareMeta } from "../compare-types";

const CURSOR_LOGO: BrandLogo = { kind: "image", src: cursorIcon };

export const meta: CompareMeta = {
  slug: "cursor-alternative",
  competitor: { name: "Cursor", logo: CURSOR_LOGO },
};
