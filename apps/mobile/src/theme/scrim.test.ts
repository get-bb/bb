import { interpolate, parse, wcagLuminance } from "culori";
import { describe, expect, it } from "vitest";
import { scrimBaseColor } from "./scrim";
import { nativeThemes } from "./theme.native";

describe("scrimBaseColor", () => {
  it("darkens the page and its lifted surfaces in every palette and mode", () => {
    for (const [palette, modes] of Object.entries(nativeThemes)) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = modes[mode];
        const scrim = scrimBaseColor(mode, tokens);
        const scrimAlpha = parse(scrim)?.alpha ?? 1;
        for (const key of ["background", "surfaceGroupedCell"] as const) {
          const before = wcagLuminance(tokens[key]);
          const after = wcagLuminance(
            interpolate([tokens[key], scrim], "rgb")(0.35 * scrimAlpha),
          );
          const label = `${palette}/${mode}/${key}`;
          if (before === 0) {
            expect(key, label).toBe("background");
            expect(after, label).toBe(0);
          } else {
            expect(after, label).toBeLessThan(before);
          }
        }
      }
    }
  });
});
