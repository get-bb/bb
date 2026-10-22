import { parentPort, workerData } from "node:worker_threads";
import libheif from "libheif-js/wasm-bundle.js";
import { PNG } from "pngjs";

if (!parentPort || !(workerData instanceof Uint8Array)) {
  throw new Error("Invalid HEIC conversion worker input");
}

const port = parentPort;
async function convertPrimaryImage(buffer: Uint8Array): Promise<Buffer> {
  await libheif.ready;
  const decoder = new libheif.HeifDecoder();
  let images: ReturnType<typeof decoder.decode> = [];
  try {
    images = decoder.decode(buffer);
    const image = images.find((candidate) => candidate.is_primary());
    if (!image) throw new Error("HEIF primary image not found");
    const width = image.get_width();
    const height = image.get_height();
    const data = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      image.display(
        { width, height, data: new Uint8ClampedArray(width * height * 4) },
        (result) => {
          if (result) resolve(result.data);
          else reject(new Error("HEIF decoding failed"));
        },
      );
    });
    const png = new PNG();
    png.width = width;
    png.height = height;
    png.data = Buffer.from(data);
    return PNG.sync.write(png);
  } finally {
    for (const image of images) image.free();
    decoder.decoder?.delete();
  }
}

void convertPrimaryImage(workerData).then(
  (output) => {
    const bytes = new Uint8Array(output);
    port.postMessage(bytes, [bytes.buffer]);
  },
  () => port.postMessage(null),
);
