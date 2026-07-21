import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { catppuccinThemeCss } from "@/lib/themes/catppuccin";
import { draculaThemeCss } from "@/lib/themes/dracula";
import { gruvboxThemeCss } from "@/lib/themes/gruvbox";
import { nordThemeCss } from "@/lib/themes/nord";
import { solarizedThemeCss } from "@/lib/themes/solarized";

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
const appCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app.css"),
  "utf8",
);

/** Declarations of the rule whose body contains `color-scheme: <scheme>;`. */
function modeBlock(scheme: "light" | "dark", source = css): string {
  const at = source.indexOf(`color-scheme: ${scheme};`);
  if (at === -1) throw new Error(`no ${scheme} block in theme.css`);
  return source.slice(source.lastIndexOf("{", at) + 1, source.indexOf("}", at));
}

function builtInPaletteModeBlock(
  scheme: "light" | "dark",
  source: string,
): string {
  const selector = scheme === "light" ? ":root, .light {" : ".dark {";
  const at = source.indexOf(selector);
  if (at === -1) throw new Error(`no ${scheme} palette block`);
  const start = at + selector.length;
  return source.slice(start, source.indexOf("}", start));
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

interface OklabColor {
  a: number;
  b: number;
  lightness: number;
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
  const match = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/);
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

function parseHexToLinearRgb(value: string): LinearRgb {
  const match = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!match) throw new Error(`expected six-digit hex color, got ${value}`);
  const toLinear = (channel: string): number => {
    const srgb = Number.parseInt(channel, 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return {
    red: toLinear(match[1]),
    green: toLinear(match[2]),
    blue: toLinear(match[3]),
  };
}

function parseCssColorToLinearRgb(value: string): LinearRgb {
  return value.startsWith("#")
    ? parseHexToLinearRgb(value)
    : oklchToLinearRgb(parseOklch(value));
}

function linearRgbToOklab({ red, green, blue }: LinearRgb): OklabColor {
  const l = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const m = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const s = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToLinearRgb({ lightness, a, b }: OklabColor): LinearRgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function mixOklch(
  foreground: LinearRgb,
  background: LinearRgb,
  foregroundWeight: number,
): LinearRgb {
  const foregroundLab = linearRgbToOklab(foreground);
  const backgroundLab = linearRgbToOklab(background);
  const foregroundChroma = Math.hypot(foregroundLab.a, foregroundLab.b);
  const backgroundChroma = Math.hypot(backgroundLab.a, backgroundLab.b);
  const rawForegroundHue =
    (Math.atan2(foregroundLab.b, foregroundLab.a) * 180) / Math.PI;
  const rawBackgroundHue =
    (Math.atan2(backgroundLab.b, backgroundLab.a) * 180) / Math.PI;
  const foregroundHue =
    foregroundChroma < 0.000001 ? rawBackgroundHue : rawForegroundHue;
  const backgroundHue =
    backgroundChroma < 0.000001 ? foregroundHue : rawBackgroundHue;
  const shortestHueDelta = ((backgroundHue - foregroundHue + 540) % 360) - 180;
  const hueDegrees = foregroundHue + shortestHueDelta * (1 - foregroundWeight);
  const chroma =
    foregroundChroma * foregroundWeight +
    backgroundChroma * (1 - foregroundWeight);
  const hueRadians = (hueDegrees * Math.PI) / 180;
  return oklabToLinearRgb({
    lightness:
      foregroundLab.lightness * foregroundWeight +
      backgroundLab.lightness * (1 - foregroundWeight),
    a: chroma * Math.cos(hueRadians),
    b: chroma * Math.sin(hueRadians),
  });
}

function compositeLinearRgb(
  foreground: LinearRgb,
  background: LinearRgb,
  opacity: number,
): LinearRgb {
  return {
    red: foreground.red * opacity + background.red * (1 - opacity),
    green: foreground.green * opacity + background.green * (1 - opacity),
    blue: foreground.blue * opacity + background.blue * (1 - opacity),
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

function linearContrastRatio(
  foreground: LinearRgb,
  background: LinearRgb,
): number {
  const foregroundLuminance =
    0.2126 * foreground.red +
    0.7152 * foreground.green +
    0.0722 * foreground.blue;
  const backgroundLuminance =
    0.2126 * background.red +
    0.7152 * background.green +
    0.0722 * background.blue;
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

      it("uses an opaque frame token for resource-card hover", () => {
        const percentage = mode === "light" ? 24 : 30;
        expect(
          variableValue(
            block,
            "resource-source-shelf-card-hover-border",
          ).replace(/\s+/g, " "),
        ).toContain(
          `in oklch, var(--ink) ${percentage}%, var(--canvas)`,
        );
        expect(block).not.toMatch(/--resource-source-shelf-card-hover:/);
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
    expect(css).toMatch(/--color-timeline-accent:\s*var\(--timeline-accent\);/);
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
      const timelineAccent = parseOklch(
        variableValue(block, "timeline-accent"),
      );
      const destructiveText = parseOklch(
        variableValue(block, "destructive-text"),
      );

      expect(contrastRatio(readbackForeground, canvas)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(timelineAccent, canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(destructiveText, canvas)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

describe("composer text shimmer", () => {
  it("uses the accessible semantic success foreground with opaque stops", () => {
    const shimmerRule = appCss.match(
      /\.prompt-text-shimmer\s*\{([^}]*)\}/,
    )?.[1];
    expect(shimmerRule).toContain("color: var(--success-foreground);");
    expect(
      shimmerRule?.match(
        /color-mix\(in oklch, var\(--success-foreground\) 78%, var\(--ink\)\)/g,
      ),
    ).toHaveLength(2);
    expect(shimmerRule).not.toMatch(/color-mix\([^;]*transparent/);

    for (const mode of MODES) {
      expect(modeBlock(mode)).toMatch(
        /--success-foreground:\s*color-mix\(\s*in oklch,\s*var\(--success\) 45%,\s*var\(--ink\)\s*\);/,
      );
    }

    const palettes = [
      { name: "default", source: css },
      { name: "nord", source: nordThemeCss },
      { name: "dracula", source: draculaThemeCss },
      { name: "solarized", source: solarizedThemeCss },
      { name: "gruvbox", source: gruvboxThemeCss },
      { name: "catppuccin", source: catppuccinThemeCss },
    ];
    for (const palette of palettes) {
      for (const mode of MODES) {
        const block =
          palette.name === "default"
            ? modeBlock(mode)
            : builtInPaletteModeBlock(mode, palette.source);
        const canvas = parseCssColorToLinearRgb(variableValue(block, "canvas"));
        const ink = parseCssColorToLinearRgb(variableValue(block, "ink"));
        const success = parseCssColorToLinearRgb(
          variableValue(block, "success"),
        );
        const successForeground = mixOklch(success, ink, 0.45);
        const darkestShimmerStop = mixOklch(successForeground, ink, 0.78);

        expect(
          linearContrastRatio(successForeground, canvas),
          `${palette.name} ${mode} static foreground`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          linearContrastRatio(darkestShimmerStop, canvas),
          `${palette.name} ${mode} shimmer stop`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps a static semantic color when reduced motion is requested", () => {
    const reducedMotionRule = appCss.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.prompt-text-shimmer\s*\{([^}]*)\}/,
    )?.[1];
    expect(reducedMotionRule).toContain("animation: none;");
    expect(reducedMotionRule).toContain("background: none;");
    expect(reducedMotionRule).toContain(
      "-webkit-text-fill-color: currentColor;",
    );
  });

  it("restores readable text when forced colors suppress the gradient", () => {
    const forcedColorsRule = appCss.match(
      /@media \(forced-colors: active\)\s*\{\s*\.prompt-text-shimmer\s*\{([^}]*)\}/,
    )?.[1];
    expect(forcedColorsRule).toContain("animation: none;");
    expect(forcedColorsRule).toContain("background: none;");
    expect(forcedColorsRule).toContain(
      "-webkit-text-fill-color: currentColor;",
    );
  });
});

describe("plugin thread-row status shimmer", () => {
  it("keeps every masked status tone above the graphical contrast floor", () => {
    const shimmerRule = css.match(/\.animate-shine-icon\s*\{([^}]*)\}/)?.[1];
    const statusRule = css.match(
      /\.animate-shine-icon-status\s*\{([^}]*)\}/,
    )?.[1];
    expect(shimmerRule).toContain("--shine-icon-edge-opacity: 0.45;");
    expect(shimmerRule).toContain("var(--shine-icon-edge-opacity)");
    expect(statusRule).toContain("--shine-icon-edge-opacity: 0.93;");

    const palettes = [
      { name: "default", source: css },
      { name: "nord", source: nordThemeCss },
      { name: "dracula", source: draculaThemeCss },
      { name: "solarized", source: solarizedThemeCss },
      { name: "gruvbox", source: gruvboxThemeCss },
      { name: "catppuccin", source: catppuccinThemeCss },
    ];
    for (const palette of palettes) {
      for (const mode of MODES) {
        const paletteBlock =
          palette.name === "default"
            ? modeBlock(mode)
            : builtInPaletteModeBlock(mode, palette.source);
        const canvas = parseCssColorToLinearRgb(
          variableValue(paletteBlock, "canvas"),
        );
        const ink = parseCssColorToLinearRgb(
          variableValue(paletteBlock, "ink"),
        );
        const success = parseCssColorToLinearRgb(
          variableValue(paletteBlock, "success"),
        );
        const steps = rampSteps(modeBlock(mode));
        const backgrounds = [
          { name: "canvas", color: canvas },
          {
            name: "hover",
            color: mixOklch(
              ink,
              canvas,
              (steps.get("sidebar-accent") ?? 0) / 100,
            ),
          },
          {
            name: "selected",
            color: mixOklch(
              ink,
              canvas,
              (steps.get("sidebar-border") ?? 0) / 100,
            ),
          },
        ];
        const successForeground = mixOklch(success, ink, 0.45);

        for (const background of backgrounds) {
          expect(
            linearContrastRatio(
              compositeLinearRgb(ink, background.color, 0.93),
              background.color,
            ),
            `${palette.name} ${mode} default on ${background.name}`,
          ).toBeGreaterThanOrEqual(3);
          expect(
            linearContrastRatio(
              compositeLinearRgb(successForeground, background.color, 0.93),
              background.color,
            ),
            `${palette.name} ${mode} success on ${background.name}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe("theme.css desktop portal hit testing", () => {
  it("carves portaled overlays out of native window drag regions", () => {
    const rule = css.match(/\[data-bb-portaled-overlay\]\s*\{([^}]*)\}/)?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/(?:^|\s)app-region:\s*no-drag;/);
    expect(rule).toMatch(/-webkit-app-region:\s*no-drag;/);
  });
});
