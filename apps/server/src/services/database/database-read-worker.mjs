// Source-mode entry. Packaged builds use database-read-worker.js directly.
import { register } from "tsx/esm/api";
register();
await import("./database-read-worker.ts");
