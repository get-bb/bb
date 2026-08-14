import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFindingsCliRunner } from "./cli.js";
import type { FindingsDriftService } from "./drift/index.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("findings drift CLI chunk fencing", () => {
  it("never re-arms a caller's prune digest across more than 500 keys", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-cli-prune-chunk",
      sdk: {
        threads: {
          get: () => ({
            id: "thread-1",
            projectId: "workspace-1",
            environmentId: "environment-1",
          }),
        },
        environments: {
          get: () => ({
            id: "environment-1",
            projectId: "workspace-1",
            hostId: "host-1",
            path: "/workspace",
          }),
        },
      },
    });
    hosts.push(host);
    const pruneOrphans = vi.fn();
    const drift = {
      pruneOrphans,
    } as unknown as FindingsDriftService;
    const run = createFindingsCliRunner(host.bb, drift, () => undefined);
    const argv = [
      "orphans",
      "prune",
      "--expected-base",
      "f".repeat(64),
      "--project",
      "platform-1",
      "--version",
      "version-1",
      "--json",
    ];
    for (let index = 0; index < 501; index += 1) {
      argv.splice(2, 0, "--stable-key", `key-${index}`);
    }

    await expect(
      run(argv, { threadId: "thread-1", projectId: "workspace-1" }),
    ).rejects.toThrow("ORPHAN_PRUNE_CHUNK_REQUIRED");
    expect(pruneOrphans).not.toHaveBeenCalled();
  });
});
