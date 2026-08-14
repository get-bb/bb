import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
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
import { bumpPluginSdk } from "../../../scripts/bump-plugin-sdk.mjs";

const scriptPath = fileURLToPath(
  new URL("../../../scripts/bump-plugin-sdk.mjs", import.meta.url),
);
const MANIFEST_PATH = "packages/plugin-sdk/package.json";
const VERSION_MODULE_PATH = "packages/domain/src/plugin-sdk-version.ts";
const testRoots = [];

/**
 * The real plugin-sdk-version.ts carries a long comment that cites version
 * numbers ("any earlier 0.x", "0.4.3 releases"). The fixture reproduces that so
 * a bump that rewrites prose instead of the export is a test failure, not a
 * surprise in a release commit.
 */
function createVersionModule(version) {
  return `// The major is the plugin API compatibility number. Pre-1.0, a plugin
// built against any earlier 0.x keeps loading, so ${version} stays compatible.
export const PLUGIN_SDK_VERSION = "${version}";

/** Major of {@link PLUGIN_SDK_VERSION}. */
export const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);
`;
}

function createTestRepo({ manifestVersion, moduleVersion }) {
  const repoRoot = mkdtempSync(join(tmpdir(), "bb-bump-plugin-sdk-"));
  testRoots.push(repoRoot);

  mkdirSync(join(repoRoot, "packages", "plugin-sdk"), { recursive: true });
  mkdirSync(join(repoRoot, "packages", "domain", "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, MANIFEST_PATH),
    `${JSON.stringify(
      {
        name: "@get-bb/plugin-sdk",
        version: manifestVersion,
        files: ["bundled-types", "dist", "README.md"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(repoRoot, VERSION_MODULE_PATH),
    createVersionModule(moduleVersion),
  );

  return repoRoot;
}

function readContent(repoRoot, path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readManifestVersion(repoRoot) {
  return JSON.parse(readContent(repoRoot, MANIFEST_PATH)).version;
}

function readModuleVersion(repoRoot) {
  const match = /export const PLUGIN_SDK_VERSION = "([^"]+)";/u.exec(
    readContent(repoRoot, VERSION_MODULE_PATH),
  );

  return match === null ? null : match[1];
}

function runScript(repoRoot, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, BB_BUMP_PLUGIN_SDK_REPO_ROOT: repoRoot },
  });
}

afterEach(() => {
  for (const testRoot of testRoots.splice(0)) {
    rmSync(testRoot, { force: true, recursive: true });
  }
});

describe("bump-plugin-sdk", () => {
  it("moves the manifest and the version module together", () => {
    const repoRoot = createTestRepo({
      manifestVersion: "0.4.3",
      moduleVersion: "0.4.3",
    });
    const result = runScript(repoRoot, ["--patch"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@get-bb/plugin-sdk 0.4.3 → 0.4.4");
    expect(readManifestVersion(repoRoot)).toBe("0.4.4");
    expect(readModuleVersion(repoRoot)).toBe("0.4.4");
  });

  it("rewrites only the export, leaving version numbers in comments alone", () => {
    const repoRoot = createTestRepo({
      manifestVersion: "0.4.3",
      moduleVersion: "0.4.3",
    });

    expect(runScript(repoRoot, ["--patch"]).status).toBe(0);

    const moduleContent = readContent(repoRoot, VERSION_MODULE_PATH);

    expect(moduleContent).toContain("so 0.4.3 stays compatible");
    expect(moduleContent).toContain(
      'export const PLUGIN_SDK_VERSION = "0.4.4";',
    );
  });

  it("refuses to bump when the two sources already disagree", () => {
    const repoRoot = createTestRepo({
      manifestVersion: "0.4.3",
      moduleVersion: "0.4.2",
    });
    const originalManifest = readContent(repoRoot, MANIFEST_PATH);
    const originalModule = readContent(repoRoot, VERSION_MODULE_PATH);
    const result = runScript(repoRoot, ["--patch"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Version mismatch before bump");
    expect(readContent(repoRoot, MANIFEST_PATH)).toBe(originalManifest);
    expect(readContent(repoRoot, VERSION_MODULE_PATH)).toBe(originalModule);
  });

  it("rejects a version that does not move forward", () => {
    const repoRoot = createTestRepo({
      manifestVersion: "0.4.3",
      moduleVersion: "0.4.3",
    });
    const result = runScript(repoRoot, ["0.4.3"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "New version 0.4.3 must be greater than current 0.4.3.",
    );
    expect(readManifestVersion(repoRoot)).toBe("0.4.3");
  });

  it("restores the manifest when the version module rename fails", async () => {
    const repoRoot = createTestRepo({
      manifestVersion: "0.4.3",
      moduleVersion: "0.4.3",
    });
    const originalManifest = readContent(repoRoot, MANIFEST_PATH);
    const originalModule = readContent(repoRoot, VERSION_MODULE_PATH);
    let renameCalls = 0;

    await expect(
      bumpPluginSdk({
        args: ["--patch"],
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

    // A half-applied bump is the exact drift this script prevents, so the
    // already-renamed manifest must be rolled back.
    expect(readContent(repoRoot, MANIFEST_PATH)).toBe(originalManifest);
    expect(readContent(repoRoot, VERSION_MODULE_PATH)).toBe(originalModule);
    expect(
      readdirSync(join(repoRoot, "packages", "plugin-sdk")),
    ).not.toContainEqual(expect.stringMatching(/^\.tmp-/u));
    expect(
      readdirSync(join(repoRoot, "packages", "domain", "src")),
    ).not.toContainEqual(expect.stringMatching(/^\.tmp-/u));
  });
});
