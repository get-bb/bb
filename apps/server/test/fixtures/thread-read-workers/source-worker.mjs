import { register } from "tsx/esm/api";

register();
await import("../../../src/thread-read-worker.ts");
