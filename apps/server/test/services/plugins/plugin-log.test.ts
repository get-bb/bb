import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPluginLogLine,
  readPluginLogTail,
} from "../../../src/services/plugins/plugin-log.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("plugin logs", () => {
  it("redacts credentials before persisting and uses owner-only permissions", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-plugin-log-"));
    tempDirs.push(dataDir);
    const credential = "sk-example-plugin-log-secret";

    appendPluginLogLine(
      dataDir,
      "example",
      "error",
      `provider failed with OPENAI_API_KEY=${credential}`,
    );

    const logDir = path.join(dataDir, "plugins", "example", "logs");
    expect((await fs.stat(logDir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(logDir, "plugin.log"))).mode & 0o777).toBe(
      0o600,
    );
    const lines = await readPluginLogTail(dataDir, "example", 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(lines[0]).not.toContain(credential);
  });
});
