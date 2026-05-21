import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bumpVersion } from "../../../scripts/bump-version.mjs";

const scriptPath = fileURLToPath(
  new URL("../../../scripts/bump-version.mjs", import.meta.url),
);
const testRoots = [];

function createPackageJson({ name, version }) {
  return `${JSON.stringify({ name, version, type: "module" }, null, 2)}\n`;
}

function createTestRepo({ bbAppVersion, desktopVersion }) {
  const repoRoot = mkdtempSync(join(tmpdir(), "bb-bump-version-"));
  testRoots.push(repoRoot);

  mkdirSync(join(repoRoot, "packages", "bb-app"), { recursive: true });
  mkdirSync(join(repoRoot, "apps", "desktop"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages", "bb-app", "package.json"),
    createPackageJson({ name: "bb-app", version: bbAppVersion }),
  );
  writeFileSync(
    join(repoRoot, "apps", "desktop", "package.json"),
    createPackageJson({ name: "@bb/desktop", version: desktopVersion }),
  );

  return repoRoot;
}

function readVersion(repoRoot, packagePath) {
  return JSON.parse(readFileSync(join(repoRoot, packagePath), "utf8")).version;
}

function readPackageContent(repoRoot, packagePath) {
  return readFileSync(join(repoRoot, packagePath), "utf8");
}

function runScript(repoRoot, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      BB_BUMP_VERSION_REPO_ROOT: repoRoot,
    },
  });
}

afterEach(() => {
  for (const testRoot of testRoots.splice(0)) {
    rmSync(testRoot, { force: true, recursive: true });
  }
});

describe("bump-version", () => {
  it("exits non-zero for an invalid version argument", () => {
    const repoRoot = createTestRepo({
      bbAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const result = runScript(repoRoot, ["not-semver"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid version: not-semver");
    expect(readVersion(repoRoot, "packages/bb-app/package.json")).toBe("0.0.6");
    expect(readVersion(repoRoot, "apps/desktop/package.json")).toBe("0.0.6");
  });

  it("rejects a bump lower than the highest current target version", () => {
    const repoRoot = createTestRepo({
      bbAppVersion: "0.0.6",
      desktopVersion: "0.0.9",
    });
    const originalBbAppContent = readPackageContent(
      repoRoot,
      "packages/bb-app/package.json",
    );
    const originalDesktopContent = readPackageContent(
      repoRoot,
      "apps/desktop/package.json",
    );
    const result = runScript(repoRoot, ["0.0.7"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "New version 0.0.7 must be greater than current max 0.0.9 across bb-app=0.0.6 @bb/desktop=0.0.9.",
    );
    expect(readPackageContent(repoRoot, "packages/bb-app/package.json")).toBe(
      originalBbAppContent,
    );
    expect(readPackageContent(repoRoot, "apps/desktop/package.json")).toBe(
      originalDesktopContent,
    );
  });

  it("updates both package versions for a valid version argument", () => {
    const repoRoot = createTestRepo({
      bbAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const result = runScript(repoRoot, ["0.0.7"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Bumped: bb-app + @bb/desktop → 0.0.7");
    expect(readVersion(repoRoot, "packages/bb-app/package.json")).toBe("0.0.7");
    expect(readVersion(repoRoot, "apps/desktop/package.json")).toBe("0.0.7");
  });

  it("restores the first package file when the second rename fails", async () => {
    const repoRoot = createTestRepo({
      bbAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const originalBbAppContent = readPackageContent(
      repoRoot,
      "packages/bb-app/package.json",
    );
    const originalDesktopContent = readPackageContent(
      repoRoot,
      "apps/desktop/package.json",
    );
    let renameCalls = 0;

    await expect(
      bumpVersion({
        args: ["0.0.7"],
        fileSystem: {
          readFile,
          rename: async (from, to) => {
            renameCalls += 1;

            if (renameCalls === 2) {
              throw new Error("simulated rename failure");
            }

            await rename(from, to);
          },
          unlink,
          writeFile,
        },
        log: () => {},
        repoRoot,
      }),
    ).rejects.toThrow("simulated rename failure");

    expect(renameCalls).toBe(2);
    expect(readPackageContent(repoRoot, "packages/bb-app/package.json")).toBe(
      originalBbAppContent,
    );
    expect(readPackageContent(repoRoot, "apps/desktop/package.json")).toBe(
      originalDesktopContent,
    );
    expect(
      readdirSync(join(repoRoot, "packages", "bb-app")),
    ).not.toContainEqual(expect.stringMatching(/^\.tmp-/u));
    expect(readdirSync(join(repoRoot, "apps", "desktop"))).not.toContainEqual(
      expect.stringMatching(/^\.tmp-/u),
    );
  });
});
