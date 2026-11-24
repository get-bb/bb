import fs from "node:fs/promises";
import path from "node:path";
import {
  experimental_createHostEntryHarness,
} from "@get-bb/plugin-sdk/testing/host";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { runGit } from "bb-environment-provider-host/workspace-git";
import { describe, expect, it, vi } from "vitest";
import hostEntry from "./host.js";
import { WorkspaceReads } from "./host/workspace-reads.js";
import { makeWorkspaceStatus } from "./testing.js";

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

describe("Git plugin host statuses", () => {
  it("answers each read on its own and gives up on one that outlasts the deadline", async () => {
    const fast = await initRepo(
      await makeTempDir("bb-git-host-statuses-fast-"),
    );
    const slow = await initRepo(
      await makeTempDir("bb-git-host-statuses-slow-"),
    );
    const missing = path.join(
      await makeTempDir("bb-git-host-statuses-"),
      "gone",
    );
    const tempDir = await makeTempDir("bb-git-host-statuses-temp-");
    const harness = experimental_createHostEntryHarness(hostEntry, {
      experimental_paths: { dataDir: tempDir, tempDir },
    });
    const freshness = { work: "w", refs: "r" };
    try {
      const warm = await harness.experimental_call("statuses", {
        reads: [
          { path: fast, freshness },
          { path: slow, freshness },
        ],
      });
      expect(warm.map((result) => result.outcome)).toEqual([
        "available",
        "available",
      ]);

      vi.spyOn(WorkspaceReads.prototype, "getStatus").mockImplementation(
        function (this: WorkspaceReads) {
          return this.path === slow
            ? new Promise(() => {})
            : Promise.resolve(makeWorkspaceStatus());
        },
      );
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const pending = harness.experimental_call("statuses", {
        reads: [
          { path: fast, freshness },
          { path: slow, freshness: { work: "w2", refs: "r" } },
          { path: missing, freshness },
        ],
      });
      await vi.advanceTimersByTimeAsync(20_000);
      const results = await pending;
      expect(results[0]).toEqual({
        outcome: "available",
        value: makeWorkspaceStatus(),
      });
      expect(results[1]).toMatchObject({
        outcome: "unavailable",
        failure: { workspacePath: slow },
      });
      expect(results[2]).toMatchObject({
        outcome: "unavailable",
        failure: { code: "path_not_found", workspacePath: missing },
      });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      await harness.experimental_dispose();
    }
  });
});
