import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectToolchains,
  redetectToolchains,
  type ToolchainContext,
  type ToolchainProbe,
} from "./toolchain.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureBinary(name: string, body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "fs-toolchain-"));
  cleanup.push(directory);
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o700);
  return directory;
}

function probe(id: string, unlocks: "build" | "flash"): ToolchainProbe {
  return {
    id,
    binary: id,
    versionArgs: ["--version"],
    unlocks,
    parse(output) {
      const match = /^fixture (\d+\.\d+\.\d+)\n?$/u.exec(output);
      return match?.[1] ?? null;
    },
  };
}

function context(path: string, probes: readonly ToolchainProbe[]): ToolchainContext {
  return { path, probes, probeTimeoutMs: 5_000 };
}

describe("toolchain detection", () => {
  it("reports absent tools as unconfigured without throwing or installing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fs-toolchain-empty-"));
    cleanup.push(directory);
    const report = await detectToolchains(context(directory, [probe("missing-gcc", "build")]));
    expect(report).toEqual({
      found: [],
      missing: [{ id: "missing-gcc", unlocks: "build" }],
      configured: false,
    });
  });

  it("finds an executable and treats an unparsable version as missing", async () => {
    const foundDir = await fixtureBinary("fixture-gcc", "printf 'fixture 1.2.3\\n'");
    const badDir = await fixtureBinary("fixture-bad", "printf 'unexpected output\\n'");
    const report = await detectToolchains(
      context(`${foundDir}:${badDir}`, [
        probe("fixture-gcc", "build"),
        probe("fixture-bad", "flash"),
      ]),
    );
    expect(report.configured).toBe(true);
    expect(report.found).toMatchObject([{ id: "fixture-gcc", version: "1.2.3" }]);
    expect(report.missing).toEqual([{ id: "fixture-bad", unlocks: "flash" }]);
  });

  it("caches detection until explicit re-detect invalidates it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fs-toolchain-cache-"));
    cleanup.push(directory);
    const ctx = context(directory, [probe("late-tool", "build")]);
    expect((await detectToolchains(ctx)).configured).toBe(false);
    const path = join(directory, "late-tool");
    await writeFile(path, "#!/bin/sh\nprintf 'fixture 2.0.0\\n'\n", "utf8");
    await chmod(path, 0o700);
    expect((await detectToolchains(ctx)).configured).toBe(false);
    expect((await redetectToolchains(ctx)).found[0]?.version).toBe("2.0.0");
  });
});
