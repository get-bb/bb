import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

export async function readBbAppVersion(): Promise<string> {
  const packageJson = z
    .object({ version: z.string() })
    .safeParse(
      JSON.parse(
        await readFile(
          join(repoRoot, "packages", "bb-app", "package.json"),
          "utf8",
        ),
      ),
    );
  if (packageJson.success) {
    return packageJson.data.version;
  }
  throw new Error("packages/bb-app/package.json has no version");
}
