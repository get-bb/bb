import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

export function runMainIfEntrypoint(
  moduleUrl: string,
  main: () => Promise<void>,
): void {
  if (
    process.argv[1] != null &&
    resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  ) {
    void main().catch((error) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
  }
}
