export type PreviewMode = "light" | "dark";

export interface ThemeStudioTokens {
  canvas: string;
  ink: string;
  primary: string;
  destructive: string;
  warning: string;
  success: string;
  prMerged: string;
  fileAccent: string;
  diffAdded: string;
  diffRemoved: string;
}

export type StudioTokenName = keyof ThemeStudioTokens;

export const STUDIO_TOKEN_LABELS: Record<StudioTokenName, string> = {
  canvas: "Canvas",
  ink: "Ink",
  primary: "Primary",
  destructive: "Destructive",
  warning: "Warning",
  success: "Success",
  prMerged: "Merged PR",
  fileAccent: "File accent",
  diffAdded: "Diff added",
  diffRemoved: "Diff removed",
};

export const GUIDED_TOKEN_NAMES: readonly StudioTokenName[] = [
  "canvas",
  "ink",
  "primary",
  "destructive",
  "warning",
  "success",
];

export const ADVANCED_TOKEN_NAMES: readonly StudioTokenName[] = [
  "prMerged",
  "fileAccent",
  "diffAdded",
  "diffRemoved",
];

export function buildPreviewCss(
  tokens: ThemeStudioTokens,
  mode: PreviewMode,
): string {
  const selector = mode === "light" ? ":root, .light" : ".dark";
  const inkMix = (percent: number): string =>
    `color-mix(in oklch, var(--ink) ${percent}%, var(--canvas))`;

  return `${selector} {
  --canvas: ${tokens.canvas};
  --ink: ${tokens.ink};
  --primary: ${tokens.primary};
  --primary-foreground: ${tokens.canvas};
  --destructive: ${tokens.destructive};
  --destructive-foreground: ${tokens.canvas};
  --destructive-text: ${tokens.destructive};
  --warning: ${tokens.warning};
  --warning-foreground: ${tokens.canvas};
  --attention: ${tokens.warning};
  --success: ${tokens.success};
  --success-foreground: ${tokens.canvas};
  --diff-added: ${tokens.diffAdded};
  --diff-removed: ${tokens.diffRemoved};
  --pr-merged: ${tokens.prMerged};
  --file-accent: ${tokens.fileAccent};
  --background: var(--canvas);
  --foreground: var(--ink);
  --card: var(--canvas);
  --card-foreground: var(--ink);
  --popover: var(--canvas);
  --popover-foreground: var(--ink);
  --primary-foreground: var(--canvas);
  --secondary: ${inkMix(8)};
  --secondary-foreground: var(--ink);
  --accent: ${inkMix(8)};
  --muted: ${inkMix(11)};
  --muted-foreground: ${inkMix(70)};
  --subtle-foreground: ${inkMix(58)};
  --readback-foreground: ${inkMix(64)};
  --border: ${inkMix(14)};
  --border-hairline: ${inkMix(15)};
  --border-seam: ${inkMix(10)};
  --input: ${inkMix(30)};
  --ring: var(--primary);
  --sidebar: ${inkMix(4)};
  --sidebar-foreground: var(--ink);
  --sidebar-accent: ${inkMix(8)};
  --sidebar-border: ${inkMix(12)};
  --surface-selected: color-mix(in oklch, var(--primary) 16%, transparent);
  --state-hover: color-mix(in oklab, var(--ink) 6%, transparent);
  --state-active: color-mix(in oklab, var(--ink) 11%, transparent);
}`;
}

export function buildStudioThemeCss(
  light: ThemeStudioTokens,
  dark: ThemeStudioTokens,
): string {
  return `${buildPreviewCss(light, "light")}\n${buildPreviewCss(dark, "dark")}`;
}
