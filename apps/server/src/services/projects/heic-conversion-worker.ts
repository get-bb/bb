import { parentPort, workerData } from "node:worker_threads";
import convert from "heic-convert";

if (!parentPort || !(workerData instanceof Uint8Array)) {
  throw new Error("Invalid HEIC conversion worker input");
}

const port = parentPort;
void convert({ buffer: workerData, format: "PNG" }).then(
  (output) => {
    const bytes = new Uint8Array(output);
    port.postMessage(bytes, [bytes.buffer]);
  },
  () => port.postMessage(null),
);
