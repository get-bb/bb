import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(appDir, "src", "components", "ui", "shine-sweep.png");

const WIDTH = 128;
const HEIGHT = 2;
const FRAME_COUNT = 30;
const LOOP_SECONDS = 1;
const EDGE_ALPHA = 0.5;
const BYTES_PER_PIXEL = 4;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sweepAlpha(x, frame) {
  const offset = (x + 0.5) / WIDTH / 2 - frame / FRAME_COUNT;
  const phase = ((offset % 1) + 1) % 1;
  const band = 1 - Math.abs(2 * phase - 1);
  return Math.round((EDGE_ALPHA + (1 - EDGE_ALPHA) * band) * 255);
}

function framePixels(frame) {
  const pixels = Buffer.alloc(WIDTH * BYTES_PER_PIXEL, 255);
  for (let x = 0; x < WIDTH; x += 1) {
    pixels[x * BYTES_PER_PIXEL + 3] = sweepAlpha(x, frame);
  }
  const firstRow = Buffer.alloc(1 + pixels.length);
  firstRow[0] = FILTER_SUB;
  for (let index = 0; index < pixels.length; index += 1) {
    const left = index < BYTES_PER_PIXEL ? 0 : pixels[index - BYTES_PER_PIXEL];
    firstRow[1 + index] = (pixels[index] - left) & 255;
  }
  const repeatedRow = Buffer.alloc(1 + pixels.length);
  repeatedRow[0] = FILTER_UP;
  const rows = [
    firstRow,
    ...Array.from({ length: HEIGHT - 1 }, () => repeatedRow),
  ];
  return deflateSync(Buffer.concat(rows), { level: 9 });
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function header() {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(WIDTH, 0);
  data.writeUInt32BE(HEIGHT, 4);
  data[8] = 8;
  data[9] = 6;
  return chunk("IHDR", data);
}

function animationControl() {
  const data = Buffer.alloc(8);
  data.writeUInt32BE(FRAME_COUNT, 0);
  data.writeUInt32BE(0, 4);
  return chunk("acTL", data);
}

function frameControl(sequence) {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(WIDTH, 4);
  data.writeUInt32BE(HEIGHT, 8);
  data.writeUInt16BE(LOOP_SECONDS, 20);
  data.writeUInt16BE(FRAME_COUNT, 22);
  return chunk("fcTL", data);
}

function frameData(sequence, pixels) {
  const data = Buffer.alloc(4 + pixels.length);
  data.writeUInt32BE(sequence, 0);
  pixels.copy(data, 4);
  return chunk("fdAT", data);
}

const chunks = [PNG_SIGNATURE, header(), animationControl()];
let sequence = 0;
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  chunks.push(frameControl(sequence));
  sequence += 1;
  if (frame === 0) {
    chunks.push(chunk("IDAT", framePixels(frame)));
  } else {
    chunks.push(frameData(sequence, framePixels(frame)));
    sequence += 1;
  }
}
chunks.push(chunk("IEND", Buffer.alloc(0)));

const png = Buffer.concat(chunks);
await writeFile(outputPath, png);
console.log(`wrote ${outputPath} (${png.length} bytes, ${FRAME_COUNT} frames)`);
