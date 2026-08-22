import { readFileSync } from "node:fs";
import { BUILTIN_THEME_IDS } from "@bb/domain";
import { converter, parse } from "culori";
import { describe, expect, it } from "vitest";
import {
  buildNativeThemeModel,
  generateNativeThemeSource,
  NATIVE_THEME_OUTPUT_PATH,
  renderNativeThemeSource,
} from "../../scripts/generate-native-theme";
import {
  nativeRadii,
  nativeThemes,
  nativeTypography,
  type NativeThemeTokens,
} from "./theme.native";

/**
 * The committed `theme.native.ts` is derived from the web app's theme.css and
 * palette files. These tests keep it honest: it must match what the generator
 * produces today, and the generated values must preserve the relationships
 * theme.test.ts guards on the web (the ink ramp ordering, mode parity, the
 * translucent state fills).
 */

const MODES = ["light", "dark"] as const;
const toOklch = converter("oklch");

function lightness(color: string): number {
  const parsed = parse(color);
  if (!parsed) throw new Error(`not a color: ${color}`);
  return toOklch(parsed).l;
}

function alpha(color: string): number {
  const match = color.match(/^rgba\(\d+, \d+, \d+, ([\d.]+)\)$/);
  if (!match) throw new Error(`expected rgba(): ${color}`);
  return Number(match[1]);
}

/** How far a token sits from the canvas, as an oklch lightness delta. */
function contrastFromCanvas(
  tokens: NativeThemeTokens,
  key: keyof NativeThemeTokens,
): number {
  return Math.abs(lightness(tokens[key]) - lightness(tokens.canvas));
}

describe("generate-native-theme", () => {
  it("matches the committed theme.native.ts (run theme:generate)", () => {
    expect(generateNativeThemeSource()).toBe(
      readFileSync(NATIVE_THEME_OUTPUT_PATH, "utf8"),
    );
  });

  it("emits every built-in palette in both modes with the default key set", () => {
    const defaultKeys = Object.keys(nativeThemes.default.light).sort();
    expect(defaultKeys.length).toBeGreaterThan(50);
    expect(defaultKeys).toContain("ansi0");
    expect(defaultKeys).toContain("ansiBgFg15");
    for (const id of BUILTIN_THEME_IDS) {
      for (const mode of MODES) {
        expect(
          Object.keys(nativeThemes[id][mode]).sort(),
          `${id}/${mode}`,
        ).toEqual(defaultKeys);
        for (const [key, value] of Object.entries(nativeThemes[id][mode])) {
          expect(value, `${id}/${mode}/${key}`).toMatch(
            /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 0\.\d{1,3}\))$/,
          );
        }
      }
    }
  });

  it("keeps the default anchors: white light canvas, dark canvas below ink", () => {
    expect(nativeThemes.default.light.canvas).toBe("#ffffff");
    expect(nativeThemes.default.light.background).toBe("#ffffff");
    expect(lightness(nativeThemes.default.light.ink)).toBeLessThan(0.5);
    expect(lightness(nativeThemes.default.dark.canvas)).toBeLessThan(
      lightness(nativeThemes.default.dark.ink),
    );
  });

  for (const id of BUILTIN_THEME_IDS) {
    for (const mode of MODES) {
      describe(`${id} ${mode}`, () => {
        const tokens = nativeThemes[id][mode];

        it("keeps card and popover flush with the canvas", () => {
          expect(tokens.card).toBe(tokens.canvas);
          expect(tokens.popover).toBe(tokens.canvas);
          expect(tokens.background).toBe(tokens.canvas);
        });

        it("orders the ink ramp: sidebar < fills < border <= input", () => {
          const sidebar = contrastFromCanvas(tokens, "sidebar");
          const border = contrastFromCanvas(tokens, "border");
          for (const fill of ["secondary", "accent", "muted"] as const) {
            expect(sidebar).toBeLessThan(contrastFromCanvas(tokens, fill));
            expect(contrastFromCanvas(tokens, fill)).toBeLessThan(border);
          }
          expect(border).toBeLessThanOrEqual(
            contrastFromCanvas(tokens, "input"),
          );
        });

        it("makes the pressed fill stronger than hover, both translucent ink", () => {
          expect(alpha(tokens.stateActive)).toBeGreaterThan(
            alpha(tokens.stateHover),
          );
          const inkRgb = tokens.ink
            .match(/[0-9a-f]{2}/g)
            ?.map((part) => parseInt(part, 16));
          expect(
            tokens.stateHover.startsWith(`rgba(${inkRgb?.join(", ")}, `),
          ).toBe(true);
        });
      });
    }
  }

  it("resolves color-mix like Chrome: premultiplied alpha and carried hues", () => {
    const model = buildNativeThemeModel({
      themeCss: `
        :root, .light {
          color-scheme: light;
          --canvas: oklch(1 0 0);
          --ink: oklch(0.3211 0 0);
          --success: oklch(0.7 0.15 155);
          --hover: color-mix(in oklab, var(--ink) 5.9%, transparent);
          --border: color-mix(in oklch, var(--ink) 14%, var(--canvas));
          --success-foreground: color-mix(in oklch, var(--success) 45%, var(--ink));
          --scrim: color-mix(in oklab, var(--canvas) 92%, transparent);
          --radius: 0.5rem;
        }
        .dark {
          color-scheme: dark;
          --canvas: #2e3440;
          --ink: #eceff4;
          --success: #a3be8c;
          --hover: color-mix(in oklab, var(--ink) 13.8%, transparent);
          --border: color-mix(in oklch, var(--ink) 19.4%, var(--canvas));
          --success-foreground: color-mix(in oklch, var(--success) 45%, var(--ink));
          --scrim: color-mix(in oklab, var(--canvas) 92%, transparent);
        }
        @theme inline {
          --radius-sm: calc(var(--radius) - 4px);
          --radius-md: calc(var(--radius) - 2px);
          --radius-lg: var(--radius);
          --radius-xl: calc(var(--radius) + 4px);
        }
        @theme {
          --text-sm: 0.8125rem;
        }
        @media (max-width: 767px) and (pointer: coarse) {
          :root {
            --text-sm: 0.9375rem;
            --text-sm--line-height: 1.375rem;
          }
        }
      `,
      paletteCss: new Map(BUILTIN_THEME_IDS.map((id) => [id, ""])),
    });
    const light = model.themes.get("default")?.light;
    const dark = model.themes.get("default")?.dark;
    // Values below are Chrome 151's computed colors for the same expressions.
    expect(light?.hover).toBe("rgba(51, 51, 51, 0.059)");
    expect(light?.border).toBe("#dfdfdf");
    // oklch(0.3211 0 0) is *specified* in oklch, so its hue 0 counts: the mix
    // lands at hue ~70 (olive), not on the green's hue.
    expect(light?.successForeground).toBe("#7a5a34");
    expect(light?.scrim).toBe("rgba(255, 255, 255, 0.92)");
    // #eceff4 (chroma 0.007) is converted into oklch, so its hue is powerless
    // and #2e3440's hue carries through the whole ramp.
    expect(dark?.border).toBe("#4f5460");
    expect(dark?.hover).toBe("rgba(236, 239, 244, 0.138)");
    expect(dark?.successForeground).toBe("#cbd9c0");
    expect(model.radii).toEqual({ base: 8, sm: 4, md: 6, lg: 8, xl: 12 });
    expect(model.typography).toEqual([
      ["sm", { fontSize: 15, lineHeight: 22 }],
    ]);
  });

  it("rejects a token that only the dark block defines", () => {
    // `:root` declarations reach dark mode too, so a light-block token can
    // only go missing the other way round: declared under `.dark` alone.
    expect(() =>
      buildNativeThemeModel({
        themeCss: `
          :root, .light { --canvas: #fff; --ink: #000; --radius: 8px; }
          .dark { --canvas: #000; --ink: #fff; --only-dark: #123456; }
          @theme inline { --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px; }
        `,
        paletteCss: new Map(BUILTIN_THEME_IDS.map((id) => [id, ""])),
      }),
    ).toThrow(/one mode only: --only-dark/);
  });

  it("rejects a palette that sets a token theme.css does not define", () => {
    expect(() =>
      buildNativeThemeModel({
        themeCss: `
          :root, .light { --canvas: #fff; --ink: #000; --radius: 8px; }
          .dark { --canvas: #000; --ink: #fff; }
          @theme inline { --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px; }
        `,
        paletteCss: new Map(
          BUILTIN_THEME_IDS.map((id) => [
            id,
            id === "nord" ? ":root, .light { --primary-fg: #fff; }" : "",
          ]),
        ),
      }),
    ).toThrow(/Palette "nord" declares --primary-fg/);
  });

  it("emits Oxfmt-stable, sorted output", () => {
    const source = renderNativeThemeSource(buildNativeThemeModel());
    const keys = [...source.matchAll(/^  ([A-Za-z0-9]+): string;$/gm)].map(
      (match) => match[1],
    );
    expect(keys).toEqual([...keys].sort());
    expect(
      source.startsWith(
        "/**\n * GENERATED FILE — run pnpm --filter @bb/mobile theme:generate",
      ),
    ).toBe(true);
    expect(source.endsWith("\n")).toBe(true);
  });

  it("exposes the touch type scale and radii used by the web app", () => {
    expect(nativeTypography.sm).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(nativeTypography.base).toEqual({ fontSize: 16, lineHeight: 24 });
    expect(nativeTypography["2xs"].fontSize).toBeLessThan(
      nativeTypography.xs.fontSize,
    );
    expect(nativeRadii).toEqual({ base: 8, sm: 4, md: 6, lg: 8, xl: 12 });
  });
});
