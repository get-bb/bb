import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function anchorTsconfigPaths(
  sourceDir: string,
  copyDir: string,
): Promise<void> {
  const tsconfigPath = join(sourceDir, "tsconfig.json");
  const tsconfig: unknown = JSON.parse(await readFile(tsconfigPath, "utf8"));
  if (
    !isRecord(tsconfig) ||
    !isRecord(tsconfig.compilerOptions) ||
    !isRecord(tsconfig.compilerOptions.paths)
  ) {
    throw new Error(`${tsconfigPath} has no compilerOptions.paths`);
  }
  const paths = Object.fromEntries(
    Object.entries(tsconfig.compilerOptions.paths).map(([pattern, targets]) => {
      if (
        !Array.isArray(targets) ||
        !targets.every((target) => typeof target === "string")
      ) {
        throw new Error(`${tsconfigPath} maps ${pattern} to non-string paths`);
      }
      return [pattern, targets.map((target) => resolve(sourceDir, target))];
    }),
  );
  await writeFile(
    join(copyDir, "tsconfig.json"),
    JSON.stringify({
      ...tsconfig,
      compilerOptions: { ...tsconfig.compilerOptions, paths },
    }),
  );
}
