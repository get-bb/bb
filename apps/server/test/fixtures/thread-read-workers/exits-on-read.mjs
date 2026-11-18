import { parentPort } from "node:worker_threads";

parentPort.on("message", () => {
  process.exit(3);
});
