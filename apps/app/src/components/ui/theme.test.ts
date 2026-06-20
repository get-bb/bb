import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the relational structure of the neutral ramp. The whole light/dark
 * palette is derived from two anchors per mode (`--canvas`, `--ink`) by mixing
 * ink into the canvas; each token's mix percentage is its *contrast from the
 * canvas*. These tests fail if someone reintroduces a hand-set literal, inverts
 * a state relationship, or adds a token to only one mode — the regressions that
 * the flat token set used to hide.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "theme.css"),
  "utf8",
);

/** Declarations of the rule whose body contains `color-scheme: <scheme>;`. */
function modeBlock(scheme: "light" | "dark"): string {
  const at = css.indexOf(`color-scheme: ${scheme};`);
  if (at === -1) throw new Error(`no ${scheme} block in theme.css`);
  return css.slice(css.lastIndexOf("{", at) + 1, css.indexOf("}", at));
}

/**
 * token -> ink mix percentage, for tokens derived from the anchors. The base is
 * either the canvas (opaque steps, mixed in oklch) or `transparent` (translucent
 * interactive/overlay steps, mixed in oklab — see the guard below); over the
 * canvas both resolve to the same step, so the mix percentage is the comparable
 * "contrast from canvas" either way.
 */
function rampSteps(block: string): Map<string, number> {
  const re =
    /--([a-z-]+):\s*color-mix\(in okl(?:ch|ab), var\(--ink\) ([\d.]+)%, (?:var\(--canvas\)|transparent)\);/g;
  const steps = new Map<string, number>();
  for (const match of block.matchAll(re)) {
    steps.set(match[1], Number(match[2]));
  }
  return steps;
}

// Every neutral surface/line must be derived from the anchors, not hand-set.
const REQUIRED_RAMP_TOKENS = [
  "secondary",
  "accent",
  "muted",
  "state-hover",
  "state-active",
  "border",
  "border-hairline",
  "input",
  "sidebar",
  "sidebar-accent",
  "sidebar-border",
] as const;

const MODES = ["light", "dark"] as const;

interface OklchColor {
  lightness: number;
  chroma: number;
  hueDegrees: number;
}

interface LinearRgb {
  blue: number;
  green: number;
  red: number;
}

function variableValue(block: string, token: string): string {
  const re = new RegExp(`--${token}:\\s*([^;]+);`);
  const match = block.match(re);
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`--${token} not defined`);
  }
  return value.trim();
}

function parseOklch(value: string): OklchColor {
  const match = value.match(
    /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/,
  );
  const lightness = match?.[1];
  const chroma = match?.[2];
  const hueDegrees = match?.[3];
  if (
    lightness === undefined ||
    chroma === undefined ||
    hueDegrees === undefined
  ) {
    throw new Error(`expected oklch() value, got ${value}`);
  }
  return {
    lightness: Number(lightness),
    chroma: Number(chroma),
    hueDegrees: Number(hueDegrees),
  };
}

function oklchToLinearRgb(color: OklchColor): LinearRgb {
  const hueRadians = (color.hueDegrees * Math.PI) / 180;
  const a = color.chroma * Math.cos(hueRadians);
  const b = color.chroma * Math.sin(hueRadians);

  const l = color.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m = color.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s = color.lightness - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;

  return {
    red: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    green: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    blue: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function relativeLuminance(color: OklchColor): number {
  const rgb = oklchToLinearRgb(color);
  return 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue;
}

function contrastRatio(foreground: OklchColor, background: OklchColor): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme.css neutral ramp", () => {
  for (const mode of MODES) {
    describe(mode, () => {
      const block = modeBlock(mode);
      const steps = rampSteps(block);
      const step = (token: string): number => {
        const value = steps.get(token);
        if (value === undefined) throw new Error(`--${token} not derived`);
        return value;
      };

      it("defines the canvas and ink anchors", () => {
        expect(block).toMatch(/--canvas:\s*oklch\(/);
        expect(block).toMatch(/--ink:\s*oklch\(/);
      });

      it("derives every neutral-ramp token from the anchors", () => {
        for (const token of REQUIRED_RAMP_TOKENS) {
          expect(
            steps.has(token),
            `--${token} must derive from var(--ink)/var(--canvas), not a literal`,
          ).toBe(true);
        }
      });

      it("keeps card and popover flush with the background", () => {
        // Elevation is conveyed by border + shadow, not a surface tint, so card
        // and popover share the page's canvas value instead of sitting on the
        // lift ramp. Guards against anyone reintroducing a fill tint (the change
        // that silently broke sticky overlay headers).
        expect(steps.has("card")).toBe(false);
        expect(steps.has("popover")).toBe(false);
        expect(block).toMatch(/--card:\s*var\(--canvas\);/);
        expect(block).toMatch(/--popover:\s*var\(--canvas\);/);
      });

      it("orders fills below borders below input", () => {
        for (const fill of ["secondary", "accent", "muted", "state-hover"]) {
          expect(step(fill)).toBeLessThan(step("border"));
        }
        expect(step("border")).toBeLessThanOrEqual(step("input"));
      });

      it("makes the pressed/selected fill stronger than hover", () => {
        expect(step("state-active")).toBeGreaterThan(step("state-hover"));
        expect(step("sidebar-accent")).toBeGreaterThan(step("sidebar"));
      });

      it("keeps the sidebar a quiet chrome lift below the fills", () => {
        // Sidebar is chrome adjacent to the page, so it should be the faintest
        // lift — below the secondary/accent fills — and never compete with
        // content surfaces. This must hold in light and dark (the lift used to
        // invert between modes). Cards are now flush with the page, so the floor
        // this is measured against is the lowest fill rather than the card.
        expect(step("sidebar")).toBeLessThan(step("secondary"));
      });
    });
  }

  it("defines the same ramp tokens in light and dark", () => {
    const light = [...rampSteps(modeBlock("light")).keys()].sort();
    const dark = [...rampSteps(modeBlock("dark")).keys()].sort();
    expect(light).toEqual(dark);
  });

  it("derives translucent (transparent-mixed) tokens in oklab, not oklch", () => {
    // Mixing a color with `transparent` in a *polar* space (oklch) drops the
    // result hue to `none`, which renders as hue 0 (red). The chroma survives,
    // so any palette whose canvas/ink/primary isn't pure gray got a pink-tinted
    // header (--surface-scrim), hover, and selection — the default palette only
    // escaped because its anchors are chroma-0. Rectangular spaces (oklab) carry
    // the hue through, so translucency must mix in oklab. Opaque color->canvas
    // mixes can stay oklch. This guard keeps every future palette correct by
    // construction, since palettes only set opaque anchors and never touch these
    // derived tokens.
    const offenders = [
      ...css.matchAll(/color-mix\(\s*in oklch\b[^;]*?\btransparent\b/g),
    ].map((match) => match[0].replace(/\s+/g, " "));
    expect(offenders).toEqual([]);
  });
});

describe("theme.css Cadence text tokens", () => {
  it("registers Cadence color and type utilities with Tailwind", () => {
    expect(css).toMatch(
      /--color-readback-foreground:\s*var\(--readback-foreground\);/,
    );
    expect(css).toMatch(
      /--color-destructive-text:\s*var\(--destructive-text\);/,
    );
    expect(css).toMatch(/--text-2xs:\s*0\.625rem;/);
    expect(css).toMatch(/--text-2xs--line-height:\s*0\.875rem;/);
  });

  for (const mode of MODES) {
    it(`keeps ${mode} Cadence text tokens above the AA text floor`, () => {
      const block = modeBlock(mode);
      const canvas = parseOklch(variableValue(block, "canvas"));
      const readbackForeground = parseOklch(
        variableValue(block, "readback-foreground"),
      );
      const destructiveText = parseOklch(
        variableValue(block, "destructive-text"),
      );

      expect(contrastRatio(readbackForeground, canvas)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(destructiveText, canvas)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});
