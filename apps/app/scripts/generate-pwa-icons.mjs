import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(appDir, "public");
const checkOnly = process.argv.includes("--check");

const faviconColorValues = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffba18",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
};

const icons = [
  { file: "icon-192.png", mode: "tile" },
  { file: "icon-512.png", mode: "tile" },
  { file: "icon-192-maskable.png", mode: "tile" },
  { file: "icon-512-maskable.png", mode: "tile" },
  { file: "apple-touch-icon.png", mode: "glyph" },
];

const mismatches = [];

function parseHex(hex) {
  return [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16),
  );
}

function outputFileName(file, color) {
  return file.replace(/\.png$/u, `-${color}.png`);
}

function tintTileIcon(data, colorRgb) {
  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha === 0) continue;

    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (luma >= 245) continue;

    const maskAlpha = Math.round(
      255 * Math.sqrt((245 - luma) / 245) * (alpha / 255),
    );
    if (maskAlpha <= 0) continue;

    const ratio = maskAlpha / 255;
    output[index] = Math.round(colorRgb[0] * ratio + 255 * (1 - ratio));
    output[index + 1] = Math.round(colorRgb[1] * ratio + 255 * (1 - ratio));
    output[index + 2] = Math.round(colorRgb[2] * ratio + 255 * (1 - ratio));
    output[index + 3] = alpha;
  }
  return output;
}

function tintGlyphIcon(data, colorRgb) {
  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    output[index] = colorRgb[0];
    output[index + 1] = colorRgb[1];
    output[index + 2] = colorRgb[2];
    output[index + 3] = alpha;
  }
  return output;
}

async function generatedPng(icon, color, hex) {
  const { data, info } = await sharp(join(publicDir, icon.file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colorRgb = parseHex(hex);
  const output =
    icon.mode === "glyph"
      ? tintGlyphIcon(data, colorRgb)
      : tintTileIcon(data, colorRgb);

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

function generatedManifest(baseManifest, color) {
  return Buffer.from(
    `${JSON.stringify(
      {
        ...baseManifest,
        icons: baseManifest.icons.map((icon) => ({
          ...icon,
          src: icon.src.replace(/\.png$/u, `-${color}.png`),
        })),
      },
      null,
      2,
    )}\n`,
  );
}

async function writeOrCheck(fileName, content) {
  const filePath = join(publicDir, fileName);
  if (!checkOnly) {
    await writeFile(filePath, content);
    return;
  }

  if (!existsSync(filePath)) {
    mismatches.push(fileName);
    return;
  }

  const existing = await readFile(filePath);
  if (!existing.equals(content)) {
    mismatches.push(fileName);
  }
}

const baseManifest = JSON.parse(
  await readFile(join(publicDir, "manifest.webmanifest"), "utf8"),
);

for (const [color, hex] of Object.entries(faviconColorValues)) {
  for (const icon of icons) {
    await writeOrCheck(
      outputFileName(icon.file, color),
      await generatedPng(icon, color, hex),
    );
  }

  await writeOrCheck(
    `manifest-${color}.webmanifest`,
    generatedManifest(baseManifest, color),
  );
}

if (mismatches.length > 0) {
  console.error(
    [
      "Generated PWA icon assets are out of date:",
      ...mismatches.map((fileName) => `  ${fileName}`),
      "Run `pnpm --filter @bb/app generate:pwa-icons`.",
    ].join("\n"),
  );
  process.exitCode = 1;
}
