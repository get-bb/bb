import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catppuccinThemeCss } from "./catppuccin";
import { draculaThemeCss } from "./dracula";
import { gruvboxThemeCss } from "./gruvbox";
import { nordThemeCss } from "./nord";
import { solarizedThemeCss } from "./solarized";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

interface PaletteColor {
  id: string;
  hue: number;
}

interface PaletteModule {
  PROJECT_COLOR_PALETTE: readonly PaletteColor[];
  projectColorCss: (colorId: string) => string;
}

interface ContrastCase {
  name: string;
  css: string;
}

const APP_THEME_CSS = readFileSync(
  fileURLToPath(new URL("../../components/ui/theme.css", import.meta.url)),
  "utf8",
);

const THEMES: readonly ContrastCase[] = [
  { name: "default", css: APP_THEME_CSS },
  { name: "catppuccin", css: catppuccinThemeCss },
  { name: "dracula", css: draculaThemeCss },
  { name: "gruvbox", css: gruvboxThemeCss },
  { name: "nord", css: nordThemeCss },
  { name: "solarized", css: solarizedThemeCss },
];

const DROP_TARGET_OVERLAY_ALPHA = 0.6;

function mixWeight(block: string, name: string): number {
  const value = token(block, name);
  const match = value.match(
    /color-mix\(in oklch, var\(--ink\) ([\d.]+)%, var\(--canvas\)\)/,
  );
  if (match === null) {
    throw new Error(`unexpected --${name} expression: ${value}`);
  }
  return Number(match[1]) / 100;
}

const SURFACE_RAMPS = {
  light: {
    sidebar: mixWeight(modeBlock(APP_THEME_CSS, "light"), "sidebar"),
    accent: mixWeight(modeBlock(APP_THEME_CSS, "light"), "sidebar-accent"),
  },
  dark: {
    sidebar: mixWeight(modeBlock(APP_THEME_CSS, "dark"), "sidebar"),
    accent: mixWeight(modeBlock(APP_THEME_CSS, "dark"), "sidebar-accent"),
  },
} as const;

const palette = (await import(
  /* @vite-ignore */
  fileURLToPath(
    new URL(
      "../../../../../plugins/thread-list/shared/project-colors.ts",
      import.meta.url,
    ),
  )
)) as PaletteModule;

function modeBlock(css: string, scheme: "light" | "dark"): string {
  const match =
    scheme === "light"
      ? css.match(/:root\s*,\s*\.light\s*\{([\s\S]*?)\}/)
      : css.match(/\.dark\s*\{([\s\S]*?)\}/);
  if (match === null) {
    throw new Error(`missing ${scheme} theme block`);
  }
  return match[1];
}

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (match === null) {
    throw new Error(`missing --${name}`);
  }
  return match[1].trim();
}

function parseHex(value: string): Rgb {
  const hex = value.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  };
}

function parseOklch(value: string): Oklch {
  const match = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (match === null) {
    throw new Error(`unsupported color: ${value}`);
  }
  return {
    lightness: Number(match[1]),
    chroma: Number(match[2]),
    hue: Number(match[3]),
  };
}

function parseColor(value: string): Rgb {
  return value.startsWith("#")
    ? parseHex(value)
    : oklchToRgb(parseOklch(value));
}

function toLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function oklchToRgb({ lightness, chroma, hue }: Oklch): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l =
    (0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb) ** (1 / 3);
  const m =
    (0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb) ** (1 / 3);
  const s =
    (0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb) ** (1 / 3);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness,
    chroma: Math.hypot(a, bb),
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

function mixOklch(first: Rgb, second: Rgb, firstWeight: number): Rgb {
  const left = rgbToOklch(first);
  const right = rgbToOklch(second);
  const leftRadians = (left.hue * Math.PI) / 180;
  const rightRadians = (right.hue * Math.PI) / 180;
  const x =
    left.chroma * Math.cos(leftRadians) * firstWeight +
    right.chroma * Math.cos(rightRadians) * (1 - firstWeight);
  const y =
    left.chroma * Math.sin(leftRadians) * firstWeight +
    right.chroma * Math.sin(rightRadians) * (1 - firstWeight);
  return oklchToRgb({
    lightness:
      left.lightness * firstWeight + right.lightness * (1 - firstWeight),
    chroma: Math.hypot(x, y),
    hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
  });
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(first: Rgb, second: Rgb): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

interface ProjectColorExpression {
  light: Oklch;
  dark: Oklch;
  foregroundMix: number;
}

function projectColorCssParts(css: string): ProjectColorExpression {
  const match = css.match(
    /light-dark\(oklch\(([\d.]+) ([\d.]+) ([\d.]+)\), oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)\)\s+([\d.]+)%,\s+var\(--ink\)/,
  );
  if (match === null) {
    throw new Error(`unexpected project color expression: ${css}`);
  }
  return {
    light: {
      lightness: Number(match[1]),
      chroma: Number(match[2]),
      hue: Number(match[3]),
    },
    dark: {
      lightness: Number(match[4]),
      chroma: Number(match[5]),
      hue: Number(match[6]),
    },
    foregroundMix: Number(match[7]) / 100,
  };
}

function surfacesFor(css: string, scheme: "light" | "dark") {
  const block = modeBlock(css, scheme);
  const canvas = parseColor(token(block, "canvas"));
  const ink = parseColor(token(block, "ink"));
  const ramp = SURFACE_RAMPS[scheme];
  const sidebar = mixOklch(ink, canvas, ramp.sidebar);
  const accent = mixOklch(ink, canvas, ramp.accent);
  return {
    ink,
    sidebar,
    drop: mixOklch(accent, sidebar, DROP_TARGET_OVERLAY_ALPHA),
  };
}

describe("project color contrast", () => {
  it("keeps every project color readable on every shipped theme", () => {
    for (const theme of THEMES) {
      for (const scheme of ["light", "dark"] as const) {
        const surfaces = surfacesFor(theme.css, scheme);
        for (const color of palette.PROJECT_COLOR_PALETTE) {
          const css = palette.projectColorCss(color.id);
          const expression = projectColorCssParts(css);
          const hue = scheme === "light" ? expression.light : expression.dark;
          const rendered = mixOklch(
            oklchToRgb(hue),
            surfaces.ink,
            expression.foregroundMix,
          );
          const label = `${theme.name}/${scheme}/${color.id}`;
          expect(
            contrast(rendered, surfaces.sidebar),
            label,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(rendered, surfaces.drop),
            label,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
