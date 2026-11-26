import fs from "node:fs/promises";
import path from "node:path";
import {
  experimental_createHostEntryHarness,
} from "@get-bb/plugin-sdk/testing/host";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { runGit } from "bb-environment-provider-host/workspace-git";
import { describe, expect, it, vi } from "vitest";
import hostEntry from "./host.js";

const FILE_COUNT = 20;
const LINE = "x".repeat(4_000);

describe("Git plugin host patches", () => {
  it("keeps a batch of large patches under the worker's result cap and defers the rest", async () => {
    const repo = await initRepo(await makeTempDir("bb-environment-provider-host-"));
    const tempDir = await makeTempDir("bb-environment-provider-host-temp-");
    const paths: string[] = [];
    for (let index = 0; index < FILE_COUNT; index += 1) {
      const name = `generated-${index}.txt`;
      paths.push(name);
      await fs.writeFile(
        path.join(repo, name),
        Array.from({ length: 120 }, () => LINE).join("\n"),
      );
    }
    const harness = experimental_createHostEntryHarness(hostEntry, {
      experimental_paths: { dataDir: tempDir, tempDir },
    });
    try {
      const result = await harness.experimental_call("patches", {
        path: repo,
        freshness: { work: "w", refs: "r" },
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
        paths,
      });
      expect(result.outcome).toBe("available");
      if (result.outcome !== "available") return;
      expect(result.value.deferred.length).toBeGreaterThan(0);
      expect(
        [
          ...result.value.patches.map((patch) => patch.path),
          ...result.value.deferred,
        ].sort(),
      ).toEqual([...paths].sort());
    } finally {
      await harness.experimental_dispose();
    }
  });
});

describe("Git plugin host file lists", () => {
  it("reads only the inline patches whose revision the server does not hold, also inside a snapshot", async () => {
    const repo = await initRepo(await makeTempDir("bb-git-host-files-"));
    const tempDir = await makeTempDir("bb-git-host-files-temp-");
    await fs.writeFile(path.join(repo, "README.md"), "changed\n");
    await fs.writeFile(path.join(repo, "notes.txt"), "new\n");
    const harness = experimental_createHostEntryHarness(hostEntry, {
      experimental_paths: { dataDir: tempDir, tempDir },
    });
    const query = {
      target: { type: "uncommitted" as const },
      ignoreWhitespace: false,
    };
    try {
      const first = await harness.experimental_call("files", {
        path: repo,
        freshness: { work: "w1", refs: "r" },
        ...query,
        knownPatches: [],
      });
      if (first.outcome !== "available") throw new Error("files unavailable");
      expect(first.value.initialPatches.map((entry) => entry.path).sort())
        .toEqual(["README.md", "notes.txt"]);
      expect(first.value.reusedPatchPaths).toEqual([]);

      await fs.writeFile(path.join(repo, "notes.txt"), "newer\n");
      const snapshot = await harness.experimental_call("snapshot", {
        path: repo,
        freshness: { work: "w2", refs: "r" },
        files: [
          {
            ...query,
            knownPatches: first.value.files.map(({ path, revision }) => ({
              path,
              revision,
            })),
          },
        ],
      });
      if (snapshot.outcome !== "available") {
        throw new Error("snapshot unavailable");
      }
      expect(snapshot.value.status).toMatchObject({
        outcome: "available",
        value: { workingTree: { fileCount: 2 } },
      });
      expect(snapshot.value.files).toMatchObject([
        {
          outcome: "available",
          value: {
            reusedPatchPaths: ["README.md"],
            initialPatches: [
              { path: "notes.txt", patch: expect.stringContaining("+newer") },
            ],
          },
        },
      ]);
      const status = snapshot.value.status;
      const [files] = snapshot.value.files;
      if (status.outcome !== "available" || files?.outcome !== "available") {
        throw new Error("snapshot parts unavailable");
      }

      await fs.writeFile(path.join(repo, "notes.txt"), "newer\n");
      const unchanged = await harness.experimental_call("snapshot", {
        path: repo,
        freshness: { work: "w3", refs: "r" },
        statusUnless: status.fingerprint,
        files: [{ ...query, knownPatches: [], unless: files.fingerprint }],
      });
      expect(unchanged).toEqual({
        outcome: "available",
        value: {
          status: { outcome: "unchanged" },
          files: [{ outcome: "unchanged" }],
        },
      });
    } finally {
      await harness.experimental_dispose();
    }
  });
});

describe("Git plugin host branches", () => {
  it("fetches remote branches when asked, never on a branch read", async () => {
    const repo = await initRepo(await makeTempDir("bb-git-host-branches-"));
    const remote = await makeTempDir("bb-git-host-branches-remote-");
    const tempDir = await makeTempDir("bb-git-host-branches-temp-");
    const marker = path.join(tempDir, "fetched");
    const uploadPack = path.join(tempDir, "upload-pack.sh");
    await runGit(["init", "--bare", "-q"], { cwd: remote });
    await runGit(["remote", "add", "origin", remote], { cwd: repo });
    await fs.writeFile(
      uploadPack,
      `#!/bin/sh\ntouch ${JSON.stringify(marker.replaceAll("\\", "/"))}\nexec git-upload-pack "$@"\n`,
      { mode: 0o755 },
    );
    await runGit(
      ["config", "remote.origin.uploadpack", uploadPack.replaceAll("\\", "/")],
      { cwd: repo },
    );
    const fetched = () =>
      fs.access(marker).then(
        () => true,
        () => false,
      );
    const harness = experimental_createHostEntryHarness(hostEntry, {
      experimental_paths: { dataDir: tempDir, tempDir },
    });
    try {
      await harness.experimental_call("branches", { path: repo, limit: 50 });
      await harness.experimental_call("branches", {
        path: repo,
        limit: 50,
        query: "ma",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(await fetched()).toBe(false);

      await harness.experimental_call("fetchRemoteBranches", { path: repo });

      await vi.waitFor(async () => expect(await fetched()).toBe(true), {
        timeout: 10_000,
      });
    } finally {
      await harness.experimental_dispose();
    }
  });
});
