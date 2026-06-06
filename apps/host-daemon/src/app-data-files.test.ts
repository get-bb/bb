import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listApplicationDataTargetsFromRoot } from "./app-data-files.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("app data files", () => {
  it("treats a missing apps root as an empty target list", async () => {
    const missingRoot = path.join(
      os.tmpdir(),
      `bb-missing-apps-${randomUUID()}`,
    );

    await expect(
      listApplicationDataTargetsFromRoot({
        appsRootPath: missingRoot,
      }),
    ).resolves.toEqual([]);
  });

  it("lists valid global application data targets", async () => {
    const dataDir = await makeTempDir("bb-app-data-files-");
    const appsRootPath = path.join(dataDir, "apps");
    const applicationPath = path.join(appsRootPath, "valid");
    await fs.mkdir(applicationPath, { recursive: true });
    await fs.writeFile(
      path.join(applicationPath, "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "valid",
        name: "Valid App",
        entry: "index.html",
      }),
      "utf8",
    );
    await fs.mkdir(path.join(appsRootPath, "broken"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(appsRootPath, "broken", "manifest.json"),
      JSON.stringify({
        manifestVersion: 1,
        id: "other",
        name: "Broken App",
      }),
      "utf8",
    );

    const resolvedDataDir = path.dirname(await fs.realpath(appsRootPath));
    await expect(
      listApplicationDataTargetsFromRoot({ appsRootPath }),
    ).resolves.toEqual([
      {
        applicationId: "valid",
        // App data lives outside the app folder, beside the apps root.
        appDataPath: path.join(resolvedDataDir, "app-data", "valid"),
      },
    ]);
  });
});
