import vibeKanbanIcon from "../../assets/competitors/vibe-kanban.png";
import type { BrandLogo } from "../compare-visuals";
import type { CompareMeta } from "../compare-types";

const VIBE_KANBAN_LOGO: BrandLogo = {
  kind: "image",
  src: vibeKanbanIcon,
};

export const meta: CompareMeta = {
  slug: "vibe-kanban-alternative",
  competitor: { name: "Vibe Kanban", logo: VIBE_KANBAN_LOGO },
};
