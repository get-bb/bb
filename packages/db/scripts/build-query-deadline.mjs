import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const headers = resolve(
  dirname(require.resolve("better-sqlite3/package.json")),
  "deps/sqlite3",
);
await mkdir(resolve(root, "dist"), { recursive: true });
if (process.platform !== "linux" && process.platform !== "darwin") {
  throw new Error("The SQLite deadline extension supports Linux and macOS.");
}
await promisify(execFile)("cc", [
  "-pthread",
  "-std=c11",
  "-O2",
  "-Wall",
  "-Wextra",
  "-Werror",
  "-fPIC",
  ...(process.platform === "darwin" ? ["-dynamiclib"] : ["-shared"]),
  "-I",
  headers,
  resolve(root, "native/query-deadline.c"),
  "-o",
  resolve(root, "dist/sqlite-query-deadline.so"),
]);
