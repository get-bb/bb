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
  "icon-192.png",
  "icon-512.png",
  "icon-192-maskable.png",
  "icon-512-maskable.png",
  // Opaque white tile: iOS renders transparency in touch icons as black,
  // and the system's dark/tinted home-screen treatments need a full-bleed
  // opaque source.
  "apple-touch-icon.png",
];

// Monochrome manifest icons (purpose: "monochrome") are alpha masks — the
// platform supplies the fill color when tinting (Android themed icons,
// notification badges) — so a single color-independent asset serves every
// manifest variant.
const monochromeIcons = [
  { source: "icon-192.png", target: "icon-monochrome-192.png" },
  { source: "icon-512.png", target: "icon-monochrome-512.png" },
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

async function generatedPng(file, hex) {
  const { data, info } = await sharp(join(publicDir, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = tintTileIcon(data, parseHex(hex));

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
        icons: baseManifest.icons.map((icon) =>
          icon.purpose === "monochrome"
            ? icon
            : {
                ...icon,
                src: icon.src.replace(/\.png$/u, `-${color}.png`),
              },
        ),
      },
      null,
      2,
    )}\n`,
  );
}

// Platforms use only the alpha channel of a monochrome icon as the tint
// mask, so the glyph's darkness (against the tile's white backing) becomes
// alpha — the same luma mask tintTileIcon uses to find glyph pixels.
async function generatedMonochromePng(sourceFile) {
  const { data, info } = await sharp(join(publicDir, sourceFile))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += 4) {
    const luma =
      0.2126 * data[index] +
      0.7152 * data[index + 1] +
      0.0722 * data[index + 2];
    const maskAlpha =
      luma >= 245
        ? 0
        : Math.round(
            255 * Math.sqrt((245 - luma) / 245) * (data[index + 3] / 255),
          );
    output[index] = 255;
    output[index + 1] = 255;
    output[index + 2] = 255;
    output[index + 3] = maskAlpha;
  }
  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
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

for (const monochromeIcon of monochromeIcons) {
  await writeOrCheck(
    monochromeIcon.target,
    await generatedMonochromePng(monochromeIcon.source),
  );
}

for (const [color, hex] of Object.entries(faviconColorValues)) {
  for (const file of icons) {
    await writeOrCheck(
      outputFileName(file, color),
      await generatedPng(file, hex),
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
