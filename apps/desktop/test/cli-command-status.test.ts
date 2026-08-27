import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCliCommandStatus } from "../src/cli-command-status.js";

let homeDir: string;
let otherDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(resolve(tmpdir(), "bb-cli-status-home-"));
  otherDir = await mkdtemp(resolve(tmpdir(), "bb-cli-status-other-"));
  await mkdir(join(homeDir, ".bb", "bin"), { recursive: true });
});

afterEach(async () => {
  await rm(homeDir, { force: true, recursive: true });
  await rm(otherDir, { force: true, recursive: true });
});

async function writeExecutable(path: string): Promise<void> {
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o755);
}

describe("resolveCliCommandStatus", () => {
  it("reports not-installed and not-on-PATH before anything is written", () => {
    const status = resolveCliCommandStatus({
      commandName: "bb",
      homeDir,
      path: otherDir,
    });

    expect(status.wrapperInstalled).toBe(false);
    expect(status.onPath).toBe(false);
    expect(status.matches).toEqual([]);
    expect(status.ownEntryWins).toBe(false);
  });

  it("reports the app's entry winning when it is first on PATH", async () => {
    const binDir = join(homeDir, ".bb", "bin");
    await writeExecutable(join(binDir, "bb"));

    const status = resolveCliCommandStatus({
      commandName: "bb",
      homeDir,
      path: `${binDir}:${otherDir}`,
    });

    expect(status.wrapperInstalled).toBe(true);
    expect(status.onPath).toBe(true);
    expect(status.matches).toEqual([join(binDir, "bb")]);
    expect(status.ownEntryWins).toBe(true);
  });

  it("flags a shadowing global install rather than hiding it", async () => {
    // This is the "silently runs the wrong bb" failure the whole feature
    // exists to prevent, so every match is reported in PATH order.
    const binDir = join(homeDir, ".bb", "bin");
    await writeExecutable(join(otherDir, "bb"));
    await writeExecutable(join(binDir, "bb"));

    const status = resolveCliCommandStatus({
      commandName: "bb",
      homeDir,
      path: `${otherDir}:${binDir}`,
    });

    expect(status.matches).toEqual([join(otherDir, "bb"), join(binDir, "bb")]);
    expect(status.ownEntryWins).toBe(false);
  });

  it("treats an empty PATH entry as the current directory, not as ~/.bb/bin", () => {
    const status = resolveCliCommandStatus({
      commandName: "bb",
      homeDir,
      path: `:${otherDir}`,
    });

    expect(status.onPath).toBe(false);
  });
});
