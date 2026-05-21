import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(testDirectory, "..");

const desktopPackageJsonSchema = z.object({
  version: z.string().min(1),
});

type DesktopPackageJson = z.infer<typeof desktopPackageJsonSchema>;

async function readDesktopPackageVersion(): Promise<string> {
  const packageJsonText = await readFile(
    resolve(desktopPackageRoot, "package.json"),
    "utf8",
  );
  const packageJson: DesktopPackageJson = desktopPackageJsonSchema.parse(
    JSON.parse(packageJsonText),
  );
  return packageJson.version;
}

describe("preload build", () => {
  it("inlines the desktop version for the preload global", async () => {
    const desktopVersion = await readDesktopPackageVersion();

    await execFileAsync(process.execPath, ["scripts/build.mjs"], {
      cwd: desktopPackageRoot,
    });

    const preloadSource = await readFile(
      resolve(desktopPackageRoot, "dist", "preload.cjs"),
      "utf8",
    );

    expect(preloadSource).toContain(desktopVersion);
    expect(preloadSource).not.toContain("BB_DESKTOP_VERSION");
    expect(preloadSource).not.toContain("getDesktopVersion(process.env");
  });
});
