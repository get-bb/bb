import fs from "node:fs/promises";
import path from "node:path";
import {
  experimental_createHostEntryHarness,
} from "@get-bb/plugin-sdk/testing/host";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
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
