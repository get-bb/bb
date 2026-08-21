import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { legacyConfigPath, readLegacyCustomAcpAgents } from "./legacy-config.js";

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

describe("legacyConfigPath", () => {
  it("uses BB_DATA_DIR when set and the production data dir otherwise", () => {
    expect(legacyConfigPath({ env: { BB_DATA_DIR: "/srv/bb" }, home: "/home/u" })).toBe(
      "/srv/bb/config.json",
    );
    expect(legacyConfigPath({ env: { BB_DATA_DIR: "~/alt" }, home: "/home/u" })).toBe(
      "/home/u/alt/config.json",
    );
    expect(legacyConfigPath({ env: {}, home: "/home/u" })).toBe(
      "/home/u/.bb/config.json",
    );
  });
});

describe("readLegacyCustomAcpAgents", () => {
  it("reads the deprecated array", async () => {
    const dir = await dataDir({
      customAcpAgents: [{ id: "amp", displayName: "Amp", command: "amp" }],
      customModels: [],
    });

    expect(
      await readLegacyCustomAcpAgents({ env: { BB_DATA_DIR: dir }, home: "/home/u" }),
    ).toEqual({
      entries: [{ id: "amp", displayName: "Amp", command: "amp" }],
    });
  });

  // No config file is the normal case for most installs, and an empty
  // customAcpAgents is the normal case after a migration.
  it("reports no agents and no problem when there is nothing to read", async () => {
    const missing = await dataDir();
    expect(
      await readLegacyCustomAcpAgents({
        env: { BB_DATA_DIR: missing },
        home: "/home/u",
      }),
    ).toEqual({ entries: [] });

    const empty = await dataDir({ customModels: [] });
    expect(
      await readLegacyCustomAcpAgents({
        env: { BB_DATA_DIR: empty },
        home: "/home/u",
      }),
    ).toEqual({ entries: [] });
  });

  it("reports unreadable config instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-acp-legacy-"));
    dirs.push(dir);
    await writeFile(join(dir, "config.json"), "{ not json", "utf8");

    const result = await readLegacyCustomAcpAgents({
      env: { BB_DATA_DIR: dir },
      home: "/home/u",
    });
    expect(result.entries).toEqual([]);
    expect(result.problem).toContain("is not valid JSON");
  });
});
