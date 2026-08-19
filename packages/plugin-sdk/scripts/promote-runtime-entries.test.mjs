import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promoteRuntimeEntries } from "./promote-runtime-entries.mjs";

describe("promoteRuntimeEntries", () => {
  let rootDir;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  it("replaces staged exports without making a live export disappear", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "bb-plugin-sdk-promote-"));
    const distDir = path.join(rootDir, "dist");
    const stagingDir = path.join(rootDir, "staging");
    await mkdir(path.join(distDir, "internal"), { recursive: true });
    await mkdir(path.join(stagingDir, "internal"), { recursive: true });
    await writeFile(path.join(distDir, "provider-bridge.js"), "old bridge");
    await writeFile(path.join(distDir, "stale.js"), "stale");
    await writeFile(path.join(stagingDir, "provider-bridge.js"), "new bridge");
    await writeFile(path.join(stagingDir, "internal", "host.js"), "new host");

    let keepReading = true;
    const observed = [
      await readFile(path.join(distDir, "provider-bridge.js"), "utf8"),
    ];
    const reader = (async () => {
      while (keepReading) {
        observed.push(
          await readFile(path.join(distDir, "provider-bridge.js"), "utf8"),
        );
      }
    })();

    await promoteRuntimeEntries({
      distDir,
      stagingDir,
      relativeOutputs: ["provider-bridge.js", "internal/host.js"],
    });
    observed.push(
      await readFile(path.join(distDir, "provider-bridge.js"), "utf8"),
    );
    keepReading = false;
    await reader;

    expect(observed.length).toBeGreaterThan(0);
    expect(new Set(observed)).toEqual(new Set(["old bridge", "new bridge"]));
    await expect(
      readFile(path.join(distDir, "provider-bridge.js"), "utf8"),
    ).resolves.toBe("new bridge");
    await expect(
      readFile(path.join(distDir, "internal", "host.js"), "utf8"),
    ).resolves.toBe("new host");
    await expect(readFile(path.join(distDir, "stale.js"))).rejects.toThrow();
  });
});
