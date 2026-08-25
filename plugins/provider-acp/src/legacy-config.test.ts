import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyCustomAcpAgents } from "./legacy-config.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function dataDir(config?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-acp-legacy-"));
  dirs.push(dir);
  if (config !== undefined) {
    await writeFile(join(dir, "config.json"), JSON.stringify(config), "utf8");
  }
  return dir;
}

describe("readLegacyCustomAcpAgents", () => {
  it("reads the deprecated array", async () => {
    const dir = await dataDir({
      customAcpAgents: [{ id: "amp", displayName: "Amp", command: "amp" }],
      customModels: [],
    });

    expect(await readLegacyCustomAcpAgents(dir)).toEqual({
      entries: [{ id: "amp", displayName: "Amp", command: "amp" }],
    });
  });

  // The old config had a `logo` path the server served from a route of its
  // own. The setting schema is strict and has no such field, so the entry has
  // to lose it here or the whole agent would be dropped on migration.
  it("strips the legacy logo field before the agent schema sees it", async () => {
    const dir = await dataDir({
      customAcpAgents: [
        {
          id: "amp",
          displayName: "Amp",
          command: "amp",
          logo: "/home/u/amp.png",
        },
      ],
    });

    expect(await readLegacyCustomAcpAgents(dir)).toEqual({
      entries: [{ id: "amp", displayName: "Amp", command: "amp" }],
    });
  });

  // No config file is the normal case for most installs, and an empty
  // customAcpAgents is the normal case after a migration.
  it("reports no agents and no problem when there is nothing to read", async () => {
    expect(await readLegacyCustomAcpAgents(await dataDir())).toEqual({
      entries: [],
    });
    expect(
      await readLegacyCustomAcpAgents(await dataDir({ customModels: [] })),
    ).toEqual({ entries: [] });
  });

  it("reports unreadable config instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-acp-legacy-"));
    dirs.push(dir);
    await writeFile(join(dir, "config.json"), "{ not json", "utf8");

    const result = await readLegacyCustomAcpAgents(dir);
    expect(result.entries).toEqual([]);
    expect(result.problem).toContain("is not valid JSON");
  });
});
