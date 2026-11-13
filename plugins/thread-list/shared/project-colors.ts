import { z } from "zod";

const PROJECT_COLORS = [
  { id: "rose", name: "Rose", hue: 0 },
  { id: "coral", name: "Coral", hue: 30 },
  { id: "amber", name: "Amber", hue: 60 },
  { id: "lime", name: "Lime", hue: 95 },
  { id: "sage", name: "Sage", hue: 140 },
  { id: "teal", name: "Teal", hue: 175 },
  { id: "cyan", name: "Cyan", hue: 200 },
  { id: "sky", name: "Sky", hue: 220 },
  { id: "blue", name: "Blue", hue: 245 },
  { id: "indigo", name: "Indigo", hue: 270 },
  { id: "violet", name: "Violet", hue: 300 },
  { id: "pink", name: "Pink", hue: 330 },
] as const;

export type ProjectColorId = (typeof PROJECT_COLORS)[number]["id"];

export interface ProjectColor {
  id: ProjectColorId;
  name: string;
  hue: number;
}

export const PROJECT_COLOR_PALETTE: readonly ProjectColor[] = PROJECT_COLORS;

export const PROJECT_COLOR_IDS = PROJECT_COLORS.map((color) => color.id) as [
  ProjectColorId,
  ...ProjectColorId[],
];

export const projectColorIdSchema = z.enum(PROJECT_COLOR_IDS);

const LIGHT_COLOR = { lightness: 0.46, chroma: 0.18 } as const;
const DARK_COLOR = { lightness: 0.72, chroma: 0.16 } as const;
const FOREGROUND_MIX = 50;

export function isProjectColorId(value: unknown): value is ProjectColorId {
  return (
    typeof value === "string" &&
    PROJECT_COLORS.some((color) => color.id === value)
  );
}

export function projectColorIdForProject(projectId: string): ProjectColorId {
  let hash = 0x811c9dc5;
  for (let index = 0; index < projectId.length; index += 1) {
    hash ^= projectId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return PROJECT_COLORS[(hash >>> 0) % PROJECT_COLORS.length].id;
}

export function resolveProjectColorId(
  projectId: string,
  overrides: Readonly<Record<string, string>>,
): ProjectColorId {
  const override = overrides[projectId];
  return isProjectColorId(override)
    ? override
    : projectColorIdForProject(projectId);
}

export function projectColorCss(colorId: ProjectColorId): string {
  const color = PROJECT_COLORS.find((entry) => entry.id === colorId);
  if (color === undefined) {
    throw new Error(`Unknown project color: ${colorId}`);
  }
  const light = `oklch(${LIGHT_COLOR.lightness} ${LIGHT_COLOR.chroma} ${color.hue})`;
  const dark = `oklch(${DARK_COLOR.lightness} ${DARK_COLOR.chroma} ${color.hue})`;
  return `color-mix(in oklch, light-dark(${light}, ${dark}) ${FOREGROUND_MIX}%, var(--ink))`;
}
