import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cutPluginSdkRelease } from "../../../scripts/cut-plugin-sdk-release.mjs";

const MANIFEST_PATH = "packages/plugin-sdk/package.json";
const VERSION_MODULE_PATH = "packages/domain/src/plugin-sdk-version.ts";
const testRoots = [];
const unpublished = async () => ({ kind: "unpublished" });

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

function writeVersion(root, version) {
  mkdirSync(join(root, "packages", "plugin-sdk"), { recursive: true });
  mkdirSync(join(root, "packages", "domain", "src"), { recursive: true });
  writeFileSync(
    join(root, MANIFEST_PATH),
    `${JSON.stringify({ name: "@get-bb/plugin-sdk", version }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, VERSION_MODULE_PATH),
    `export const PLUGIN_SDK_VERSION = "${version}";\n\nexport const PLUGIN_SDK_MAJOR = Number(PLUGIN_SDK_VERSION.split(".", 1)[0]);\n`,
  );
}

function commitChange(clone, name) {
  writeFileSync(join(clone, `${name}.txt`), `${name}\n`);
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "-m", name);
  return git(clone, "rev-parse", "HEAD");
}

function createRepo(version) {
  const root = mkdtempSync(join(tmpdir(), "bb-cut-plugin-sdk-"));
  testRoots.push(root);
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, clone);
  writeVersion(clone, version);
  commitChange(clone, "base");
  git(clone, "push", "--quiet", "origin", "HEAD:main");
  return { remote, clone };
}

function remoteVersion(remote) {
  return JSON.parse(git(remote, "show", `main:${MANIFEST_PATH}`)).version;
}

function remoteModule(remote) {
  return git(remote, "show", `main:${VERSION_MODULE_PATH}`);
}

function remoteTag(remote, version) {
  return git(remote, "tag", "--list", `plugin-sdk-v${version}`) === ""
    ? null
    : git(remote, "rev-parse", `plugin-sdk-v${version}^{commit}`);
}

async function cut(clone, options = {}) {
  const logs = [];
  const result = await cutPluginSdkRelease({
    repoRoot: clone,
    dryRun: false,
    findPublished: unpublished,
    log: (line) => logs.push(line),
    ...options,
  });
  return { ...result, logs };
}

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("cut-plugin-sdk-release", () => {
  it("claims the version for the release commit and moves main to the next patch", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const releaseCommit = git(clone, "rev-parse", "HEAD");

    const result = await cut(clone);

    expect(result).toMatchObject({ version: "0.6.144", ownsVersion: true });
    expect(remoteTag(remote, "0.6.144")).toBe(releaseCommit);
    expect(remoteVersion(remote)).toBe("0.6.145");
    expect(remoteModule(remote)).toContain(
      'export const PLUGIN_SDK_VERSION = "0.6.145";',
    );
    expect(remoteModule(remote)).toContain("PLUGIN_SDK_MAJOR");
    expect(git(remote, "rev-parse", "main^")).toBe(releaseCommit);
    expect(git(remote, "log", "-1", "--format=%an", "main")).toBe(
      "github-actions[bot]",
    );
  });

  it("keeps main's newer commits when advancing past the cut", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const releaseCommit = git(clone, "rev-parse", "HEAD");
    const laterMerge = commitChange(clone, "later");
    git(clone, "push", "--quiet", "origin", "HEAD:main");
    git(clone, "checkout", "--quiet", "--detach", releaseCommit);

    await cut(clone);

    expect(git(remote, "rev-parse", "main^")).toBe(laterMerge);
    expect(git(remote, "show", "main:later.txt")).toBe("later");
    expect(remoteVersion(remote)).toBe("0.6.145");
  });

  it("advances main from a blob-less partial clone without fetching every blob", async () => {
    const { remote, clone } = createRepo("0.6.144");
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(join(clone, `unrelated-${index}.txt`), `${index}\n`);
    }
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "unrelated files");
    git(clone, "push", "--quiet", "origin", "HEAD:main");
    git(remote, "config", "uploadpack.allowFilter", "true");
    const partial = join(remote, "..", "partial");
    git(
      join(remote, ".."),
      "clone",
      "--quiet",
      "--no-local",
      "--no-checkout",
      "--filter=blob:none",
      `file://${remote}`,
      partial,
    );
    const missingBefore = git(
      partial,
      "rev-list",
      "--objects",
      "--missing=print",
      "--all",
    )
      .split("\n")
      .filter((line) => line.startsWith("?")).length;

    await cut(partial);

    const missingAfter = git(
      partial,
      "rev-list",
      "--objects",
      "--missing=print",
      "--all",
    )
      .split("\n")
      .filter((line) => line.startsWith("?")).length;
    expect(missingBefore).toBeGreaterThan(20);
    expect(missingAfter).toBeGreaterThanOrEqual(missingBefore - 4);
    expect(remoteVersion(remote)).toBe("0.6.145");
    expect(git(remote, "show", "main:unrelated-7.txt")).toBe("7");
  });

  it("is idempotent when the same release reruns", async () => {
    const { remote, clone } = createRepo("0.6.144");
    await cut(clone);
    const advancedMain = git(remote, "rev-parse", "main");

    const rerun = await cut(clone);

    expect(rerun.ownsVersion).toBe(true);
    expect(git(remote, "rev-parse", "main")).toBe(advancedMain);
    expect(remoteVersion(remote)).toBe("0.6.145");
  });

  it("retries when main moves between reading it and pushing the advance", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const marker = join(remote, "rejected-once");
    const hook = join(remote, "hooks", "pre-receive");
    writeFileSync(
      hook,
      `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ] && [ ! -f "${marker}" ]; then\n    touch "${marker}"\n    exit 1\n  fi\ndone\nexit 0\n`,
    );
    chmodSync(hook, 0o755);

    const result = await cut(clone);

    expect(result.logs.some((line) => line.includes("retrying"))).toBe(true);
    expect(remoteVersion(remote)).toBe("0.6.145");
  });

  it("lets a later commit release a host on a version an earlier release cut, without publishing it", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const earlierRelease = git(clone, "rev-parse", "HEAD");
    git(
      clone,
      "push",
      "--quiet",
      "origin",
      `${earlierRelease}:refs/tags/plugin-sdk-v0.6.144`,
    );
    commitChange(clone, "later");
    git(clone, "push", "--quiet", "origin", "HEAD:main");

    const result = await cut(clone);

    expect(result.ownsVersion).toBe(false);
    expect(remoteTag(remote, "0.6.144")).toBe(earlierRelease);
    expect(remoteVersion(remote)).toBe("0.6.145");
  });

  it("refuses to release a host that lacks what another release cut under the same version", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const olderRelease = git(clone, "rev-parse", "HEAD");
    const newerRelease = commitChange(clone, "later");
    git(clone, "push", "--quiet", "origin", "HEAD:main");
    git(
      clone,
      "push",
      "--quiet",
      "origin",
      `${newerRelease}:refs/tags/plugin-sdk-v0.6.144`,
    );
    git(clone, "checkout", "--quiet", "--detach", olderRelease);

    await expect(cut(clone)).rejects.toThrow(
      `already cut from ${newerRelease} (tag plugin-sdk-v0.6.144)`,
    );
    expect(remoteVersion(remote)).toBe("0.6.144");
  });

  it("treats an npm release without a tag as the claim on that version", async () => {
    const { clone } = createRepo("0.6.144");
    const elsewhere = "0123456789abcdef0123456789abcdef01234567";

    await expect(
      cut(clone, {
        findPublished: async () => ({ kind: "published", gitHead: elsewhere }),
      }),
    ).rejects.toThrow(`already cut from ${elsewhere} (npm gitHead)`);
    await expect(
      cut(clone, {
        findPublished: async () => ({ kind: "published", gitHead: null }),
      }),
    ).rejects.toThrow("without a gitHead");
  });

  it("refuses when main's version is behind the release commit's", async () => {
    const { remote, clone } = createRepo("0.6.144");
    writeVersion(clone, "0.6.140");
    commitChange(clone, "lowered");
    git(clone, "push", "--quiet", "origin", "HEAD:main");
    git(clone, "checkout", "--quiet", "--detach", "HEAD~1");

    await expect(cut(clone)).rejects.toThrow(
      "main carries @get-bb/plugin-sdk 0.6.140, older than 0.6.144",
    );
    expect(remoteTag(remote, "0.6.144")).toBeNull();
  });

  it("changes nothing on a dry run", async () => {
    const { remote, clone } = createRepo("0.6.144");
    const main = git(remote, "rev-parse", "main");

    const result = await cut(clone, { dryRun: true });

    expect(result.ownsVersion).toBe(true);
    expect(git(remote, "rev-parse", "main")).toBe(main);
    expect(remoteTag(remote, "0.6.144")).toBeNull();
  });
});
