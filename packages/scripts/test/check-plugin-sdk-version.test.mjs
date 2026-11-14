import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPluginSdkVersion,
  findPluginSdkVersionProblems,
} from "../../../.github/workflows/check-plugin-sdk-version.mjs";

const at = (version) => ({ manifestVersion: version, moduleVersion: version });
const testRoots = [];

function problemsFor(overrides) {
  return findPluginSdkVersionProblems({
    base: at("0.6.144"),
    head: at("0.6.144"),
    sdkSourceChanged: true,
    floorChanges: [],
    ...overrides,
  });
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

function writeFile(root, path, content) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function writeRepoState(root, { version, floor, sdkSource }) {
  writeFile(
    root,
    "packages/plugin-sdk/package.json",
    `${JSON.stringify({ name: "@get-bb/plugin-sdk", version })}\n`,
  );
  writeFile(
    root,
    "packages/domain/src/plugin-sdk-version.ts",
    `export const PLUGIN_SDK_VERSION = "${version}";\n`,
  );
  writeFile(
    root,
    "plugins/demo/package.json",
    `${JSON.stringify({ name: "demo", engines: { bbPluginSdk: floor } })}\n`,
  );
  writeFile(root, "packages/plugin-sdk/src/app.ts", sdkSource);
}

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("findPluginSdkVersionProblems", () => {
  it("accepts a change that leaves the version alone", () => {
    expect(problemsFor({})).toEqual([]);
  });

  it("rejects a version that moves backwards", () => {
    expect(problemsFor({ head: at("0.6.140") })).toEqual([
      expect.stringContaining("moved backwards from 0.6.144 to 0.6.140"),
    ]);
  });

  it("rejects a manifest and constant that disagree", () => {
    expect(
      problemsFor({
        head: { manifestVersion: "0.6.145", moduleVersion: "0.6.144" },
      }),
    ).toEqual([expect.stringContaining("They must agree")]);
  });

  it("rejects a floor raised to a released version alongside an SDK change", () => {
    expect(
      problemsFor({
        floorChanges: [
          {
            plugin: "plugins/demo/package.json",
            before: ">=0.6.100",
            after: ">=0.6.143",
          },
          {
            plugin: "plugins/new/package.json",
            before: undefined,
            after: ">=0.6.66",
          },
        ],
      }),
    ).toEqual([
      expect.stringContaining(
        "plugins/demo/package.json raises engines.bbPluginSdk to >=0.6.143",
      ),
      expect.stringContaining(
        "plugins/new/package.json raises engines.bbPluginSdk to >=0.6.66",
      ),
    ]);
  });

  it("accepts floors at the unreleased version, lowered floors, and floors outside SDK changes", () => {
    const floorChanges = [
      {
        plugin: "plugins/a/package.json",
        before: ">=0.6.100",
        after: ">=0.6.144",
      },
      {
        plugin: "plugins/b/package.json",
        before: ">=0.6.116",
        after: ">=0.6.6",
      },
    ];
    expect(problemsFor({ floorChanges })).toEqual([]);
    expect(
      problemsFor({
        sdkSourceChanged: false,
        floorChanges: [
          {
            plugin: "plugins/c/package.json",
            before: ">=0.6.1",
            after: ">=0.6.112",
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("checkPluginSdkVersion", () => {
  it("compares a push with the commit it replaced, so a stale floor merged after a release fails on main", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-check-plugin-sdk-"));
    testRoots.push(root);
    git(root, "init", "--quiet", "--initial-branch=main");
    writeRepoState(root, {
      version: "0.6.145",
      floor: ">=0.6.100",
      sdkSource: "export const a = 1;\n",
    });
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "release advanced main");
    const before = git(root, "rev-parse", "HEAD");
    writeRepoState(root, {
      version: "0.6.145",
      floor: ">=0.6.144",
      sdkSource: "export const a = 1;\nexport const b = 2;\n",
    });
    git(root, "add", "-A");
    git(
      root,
      "commit",
      "--quiet",
      "-m",
      "PR written while 0.6.144 was unreleased",
    );

    const result = checkPluginSdkVersion({
      repoRoot: root,
      env: { PLUGIN_SDK_CHECK_BASE: before },
    });

    expect(result.problems).toEqual([
      expect.stringContaining('Use ">=0.6.145"'),
    ]);
  });
});
