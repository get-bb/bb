import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const svg = await readFile(resolve(root, "assets/opulent-logo.svg"));
const check = process.argv.includes("--check");
async function output(relative, data) {
  const target = resolve(root, relative);
  if (check) {
    if (!(await readFile(target)).equals(data)) throw new Error(`Opulent icon out of date: ${relative}`);
  } else await writeFile(target, data);
}
async function icon(size, background = "#ffffff", foreground = "#111111") {
  const source = Buffer.from(svg.toString().replaceAll("#111111", foreground));
  return sharp(source).resize(size, size).flatten({ background }).png().toBuffer();
}
for (const size of [16, 32]) {
  await output(`apps/app/public/favicon-${size}x${size}.png`, await icon(size));
  await output(`apps/app/public/favicon-${size}x${size}-dark.png`, await icon(size, "#111111", "#ffffff"));
  await output(`apps/app/public/favicon-${size}x${size}-dev.png`, await icon(size, "#ffffff", "#2563eb"));
}
for (const size of [192, 512]) {
  await output(`apps/app/public/icon-${size}.png`, await icon(size));
  await output(`apps/app/public/icon-${size}-maskable.png`, await icon(size));
}
await output("apps/app/public/apple-touch-icon.png", await icon(180));
for (const [suffix, color] of [["", "#111111"], ["-nightly", "#7c3aed"], ["-dev", "#2563eb"]]) {
  await output(`apps/desktop/assets/icon${suffix}.png`, await icon(512, "#ffffff", color));
  if (suffix === "-dev") continue;
  const chunks = [];
  for (const [tag, size] of [["icp4",16],["icp5",32],["icp6",64],["ic07",128],["ic08",256],["ic09",512],["ic10",1024]]) {
    const image = await icon(size, "#ffffff", color);
    const header = Buffer.alloc(8); header.write(tag); header.writeUInt32BE(image.length + 8,4);
    chunks.push(header,image);
  }
  const body = Buffer.concat(chunks); const header = Buffer.alloc(8);
  header.write("icns"); header.writeUInt32BE(body.length + 8,4);
  await output(`apps/desktop/assets/icon${suffix}.icns`, Buffer.concat([header,body]));
}
