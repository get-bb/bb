export interface OklchColor {
  lightness: number;
  chroma: number;
  hueDegrees: number;
}

interface LinearRgb {
  red: number;
  green: number;
  blue: number;
}

export function oklchToLinearRgb(color: OklchColor): LinearRgb {
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

function linearToSrgb(channel: number): number {
  if (channel <= 0.0031308) return 12.92 * channel;
  return 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function srgbToLinear(channel: number): number {
  if (channel <= 0.04045) return channel / 12.92;
  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

function isInSrgbGamut(color: OklchColor): boolean {
  const rgb = oklchToLinearRgb(color);
  const epsilon = 0.0001;
  return (
    rgb.red >= -epsilon &&
    rgb.red <= 1 + epsilon &&
    rgb.green >= -epsilon &&
    rgb.green <= 1 + epsilon &&
    rgb.blue >= -epsilon &&
    rgb.blue <= 1 + epsilon
  );
}

/**
 * Reduce chroma until the color fits sRGB so its hue and lightness survive
 * quantisation. Channel clipping instead would silently rotate the hue, which
 * is how a "red" destructive token turns orange.
 */
export function fitToSrgb(color: OklchColor): OklchColor {
  if (isInSrgbGamut(color)) return color;
  let low = 0;
  let high = color.chroma;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (isInSrgbGamut({ ...color, chroma: mid })) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return { ...color, chroma: low };
}

export function oklchToHex(color: OklchColor): string {
  const rgb = oklchToLinearRgb(color);
  const to255 = (channel: number): number =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255);
  return `#${[to255(rgb.red), to255(rgb.green), to255(rgb.blue)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function oklchToHexInGamut(color: OklchColor): string {
  return oklchToHex(fitToSrgb(color));
}

/**
 * Emit the hex for `color` that still clears `target` contrast against
 * `background` after gamut fitting and 8-bit quantization. Fitting and rounding
 * both nudge a color, so a value that passed as raw OKLCH can land just under the
 * floor once serialized; this walks lightness until the emitted hex itself is
 * compliant.
 */
export function contrastSafeHex(
  color: OklchColor,
  background: OklchColor,
  target: number,
): string {
  const preferred = relativeLuminance(background) < 0.18 ? 1 : -1;
  let best = oklchToHexInGamut(color);
  let bestRatio = contrastRatio(hexToOklch(best), background);

  for (const direction of [preferred, -preferred]) {
    for (let step = 1; step <= 100; step += 1) {
      const lightness = Number(
        (color.lightness + direction * 0.01 * step).toFixed(4),
      );
      if (lightness < 0 || lightness > 1) break;
      const surfaceDistance = Math.abs(lightness - color.lightness);
      const candidate = {
        lightness,
        chroma: Math.max(
          0,
          Math.min(color.chroma, 0.32 - surfaceDistance * 0.22),
        ),
        hueDegrees: color.hueDegrees,
      };
      const hex = oklchToHexInGamut(candidate);
      const ratio = contrastRatio(hexToOklch(hex), background);
      if (ratio >= target) return hex;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = hex;
      }
    }
  }

  return best;
}

export function hexToOklch(hex: string): OklchColor {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`expected a hex color, got ${hex}`);
  }
  const red = srgbToLinear(parseInt(expanded.slice(0, 2), 16) / 255);
  const green = srgbToLinear(parseInt(expanded.slice(2, 4), 16) / 255);
  const blue = srgbToLinear(parseInt(expanded.slice(4, 6), 16) / 255);

  const l = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const m = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const s = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(a * a + b * b);
  let hueDegrees = (Math.atan2(b, a) * 180) / Math.PI;
  if (hueDegrees < 0) hueDegrees += 360;

  return {
    lightness,
    chroma: Number.isFinite(chroma) ? chroma : 0,
    hueDegrees,
  };
}

export function relativeLuminance(color: OklchColor): number {
  const rgb = oklchToLinearRgb(color);
  return 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue;
}

export function contrastRatio(
  foreground: OklchColor,
  background: OklchColor,
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function withLightness(color: OklchColor, lightness: number): OklchColor {
  return { ...color, lightness };
}

/**
 * Move a color's lightness until it clears `target` contrast against
 * `background`. Both directions are tried so a mid-tone canvas still resolves,
 * and the direction that needs the least movement wins. Chroma is reduced as
 * the color approaches the surface because high chroma cannot survive at
 * extreme lightness.
 */
export function ensureContrast(
  color: OklchColor,
  background: OklchColor,
  target: number,
): OklchColor {
  if (contrastRatio(color, background) >= target) return color;

  const preferred = relativeLuminance(background) < 0.18 ? 1 : -1;
  const directions = [preferred, -preferred];

  let best: OklchColor | null = null;
  let bestRatio = contrastRatio(color, background);

  for (const direction of directions) {
    for (let step = 1; step <= 100; step += 1) {
      const lightness = Number(
        (color.lightness + direction * 0.01 * step).toFixed(4),
      );
      if (lightness < 0 || lightness > 1) break;
      const surfaceDistance = Math.abs(lightness - color.lightness);
      const nextChroma = Math.max(
        0,
        Math.min(color.chroma, 0.32 - surfaceDistance * 0.22),
      );
      const candidate = {
        lightness,
        chroma: nextChroma,
        hueDegrees: color.hueDegrees,
      };
      const ratio = contrastRatio(candidate, background);
      if (ratio >= target) return candidate;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    }
  }

  if (best) return best;
  return { ...color, lightness: contrastRatio(color, background) > 0 ? (preferred > 0 ? 1 : 0) : color.lightness };
}

export function shortestHueDistance(a: number, b: number): number {
  const raw = Math.abs(((a - b) % 360) + 360) % 360;
  return raw > 180 ? 360 - raw : raw;
}
