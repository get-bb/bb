import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(
  fileURLToPath(new URL("./fsds-dark.css", import.meta.url)),
  "utf8",
);
const officialThemeCss = readFileSync(
  fileURLToPath(
    new URL("../../../apps/app/src/components/ui/theme.css", import.meta.url),
  ),
  "utf8",
);
const fontReadme = readFileSync(
  fileURLToPath(new URL("../assets/fonts/README.md", import.meta.url)),
  "utf8",
);

function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`Missing CSS block: ${selector}`);
  }

  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }
  throw new Error(`Unclosed CSS block: ${selector}`);
}

function declarations(block: string): Map<string, string> {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//gu, "");
  return new Map(
    [...withoutComments.matchAll(/(--[a-z\d-]+)\s*:\s*([^;]+);/gu)].map(
      ([, name, value]) => [name, value.trim()],
    ),
  );
}

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}

function resolveColor(name: string, variables: Map<string, string>): string {
  let value = variables.get(name);
  const visited = new Set<string>();
  while (value?.startsWith("var(") && value.endsWith(")")) {
    if (visited.has(value)) {
      throw new Error(`Circular color variable at ${name}`);
    }
    visited.add(value);
    value = variables.get(value.slice(4, -1));
  }
  if (value === undefined) {
    throw new Error(`Missing color variable ${name}`);
  }
  return value;
}

function parseOklch(name: string, variables: Map<string, string>): Oklch {
  const value = resolveColor(name, variables);
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(value);
  if (!match) {
    throw new Error(`${name} must resolve to a testable opaque oklch color; got ${value}`);
  }
  return {
    lightness: Number(match[1]),
    chroma: Number(match[2]),
    hue: Number(match[3]),
  };
}

function relativeLuminance({ lightness, chroma, hue }: Oklch): number {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(red) + 0.7152 * clamp(green) + 0.0722 * clamp(blue);
}

function contrastRatio(
  foreground: string,
  background: string,
  variables: Map<string, string>,
): number {
  const foregroundLuminance = relativeLuminance(parseOklch(foreground, variables));
  const backgroundLuminance = relativeLuminance(parseOklch(background, variables));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Finite State dark theme", () => {
  const themeVariables = declarations(extractBlock(themeCss, ".dark"));

  it("declares the complete current official dark-theme variable baseline", () => {
    const officialVariables = declarations(extractBlock(officialThemeCss, ".dark"));
    const missing = [...officialVariables.keys()].filter(
      (name) => !themeVariables.has(name),
    );

    expect(missing).toEqual([]);
    expect([...themeCss.matchAll(/\.dark\s*\{/gu)]).toHaveLength(1);
    expect(themeVariables.get("--font-heading")).toContain("FSDS Space Grotesk");
    expect(themeVariables.get("--font-sans")).toContain("FSDS Instrument Sans");
    expect(themeVariables.get("--font-mono")).toContain("SFMono-Regular");

    for (const name of [
      "--chart-1",
      "--chart-2",
      "--chart-3",
      "--chart-4",
      "--chart-5",
      "--severity-critical",
      "--severity-high",
      "--severity-medium",
      "--severity-low",
      "--severity-none",
      "--severity-unknown",
    ]) {
      expect(themeVariables.has(name), `${name} is missing`).toBe(true);
    }
  });

  it("embeds the two recorded WOFF2 faces without a runtime URL", () => {
    const faceBlocks = [...themeCss.matchAll(/@font-face\s*\{([^}]+)\}/gu)].map(
      ([, block]) => block,
    );
    expect(faceBlocks).toHaveLength(2);
    expect(themeCss).not.toMatch(/url\(\s*["']?https?:/iu);

    const expectedHashes = new Map([
      [
        "FSDS Instrument Sans",
        "2ee17598a98d8a59e4df8152d015bec9ab8e4d5672cc0ab42bef806b568e3971",
      ],
      [
        "FSDS Space Grotesk",
        "0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d",
      ],
    ]);

    for (const block of faceBlocks) {
      expect(block).toContain("font-display: swap");
      const family = /font-family:\s*"([^"]+)"/u.exec(block)?.[1];
      const encoded = /url\("data:font\/woff2;base64,([A-Za-z\d+/=]+)"\)/u.exec(
        block,
      )?.[1];
      expect(family).toBeDefined();
      expect(encoded).toBeDefined();
      if (family === undefined || encoded === undefined) {
        continue;
      }
      const hash = createHash("sha256")
        .update(Buffer.from(encoded, "base64"))
        .digest("hex");
      expect(hash, family).toBe(expectedHashes.get(family));
      expect(fontReadme).toContain(hash);
    }
  });

  it("keeps operational text and focus indicators above chosen WCAG thresholds", () => {
    const matrix = [
      ["foreground on canvas", "--foreground", "--canvas", 7],
      ["muted text on canvas", "--muted-foreground", "--canvas", 4.5],
      ["primary text on primary", "--primary-foreground", "--primary", 4.5],
      [
        "destructive text on canvas",
        "--destructive-text",
        "--canvas",
        4.5,
      ],
      [
        "destructive button text",
        "--destructive-foreground",
        "--destructive",
        4.5,
      ],
      ["warning text on canvas", "--warning-text", "--canvas", 4.5],
      ["success text on canvas", "--success", "--canvas", 4.5],
      ["focus ring on canvas", "--ring", "--canvas", 3],
    ] as const;

    for (const [label, foreground, background, minimum] of matrix) {
      const ratio = contrastRatio(foreground, background, themeVariables);
      expect(ratio, `${label}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        minimum,
      );
    }
  });

  it("provides selection, visible focus, and reduced-motion behavior", () => {
    expect(themeCss).toMatch(/\.dark\s+::selection\s*\{/u);
    expect(themeCss).toMatch(/\.dark\s+:focus-visible\s*\{[^}]*outline:\s*2px/u);
    expect(themeCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
    expect(themeCss).toContain("animation-duration: 0.01ms !important");
    expect(themeCss).toContain("transition-duration: 0.01ms !important");
  });
});
