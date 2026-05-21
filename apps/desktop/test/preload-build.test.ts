import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const desktopPackageRoot = process.cwd();

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

describe("desktop build", () => {
  it("emits package-compatible Electron entries", async () => {
    const desktopVersion = await readDesktopPackageVersion();

    await execFileAsync(process.execPath, ["scripts/build.mjs"], {
      cwd: desktopPackageRoot,
    });

    const mainSource = await readFile(
      resolve(desktopPackageRoot, "dist", "main.js"),
      "utf8",
    );
    const preloadSource = await readFile(
      resolve(desktopPackageRoot, "dist", "preload.cjs"),
      "utf8",
    );
    const bridgeSource = await readFile(
      resolve(desktopPackageRoot, "dist", "bb-app-bridge.mjs"),
      "utf8",
    );

    expect(mainSource).toContain('"use strict";');
    expect(mainSource).not.toMatch(/^import\s/mu);
    expect(preloadSource).toContain(desktopVersion);
    expect(preloadSource).not.toContain("BB_DESKTOP_VERSION");
    expect(preloadSource).not.toContain("getDesktopVersion(process.env");
    expect(bridgeSource).toContain('import "bb-app/dist/bb-app.js"');
  });
});
