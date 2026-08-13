import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectToolchains,
  redetectToolchains,
  DEFAULT_TOOLCHAIN_PROBES,
  type ToolchainContext,
  type ToolchainCapability,
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

function probe(id: string, unlocks: ToolchainCapability): ToolchainProbe {
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
  return {
    cacheKey: {},
    path,
    probes,
    probeTimeoutMs: 5_000,
    signal: new AbortController().signal,
  };
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

  it("configures a complete build capability while reporting a missing flash capability", async () => {
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

  it("caches across fresh contexts that share the stable plugin holder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fs-toolchain-holder-"));
    cleanup.push(directory);
    const cacheKey = {};
    const first = context(directory, [probe("stable-tool", "build")]);
    first.cacheKey = cacheKey;
    expect((await detectToolchains(first)).configured).toBe(false);
    const path = join(directory, "stable-tool");
    await writeFile(path, "#!/bin/sh\nprintf 'fixture 3.0.0\\n'\n", "utf8");
    await chmod(path, 0o700);
    const second = context(directory, [probe("stable-tool", "build")]);
    second.cacheKey = cacheKey;
    expect((await detectToolchains(second)).configured).toBe(false);
    expect((await redetectToolchains(second)).configured).toBe(true);
  });

  it("does not reuse a stable holder entry across different PATH values", async () => {
    const emptyDirectory = await mkdtemp(join(tmpdir(), "fs-toolchain-path-empty-"));
    cleanup.push(emptyDirectory);
    const foundDirectory = await fixtureBinary("path-tool", "printf 'fixture 4.0.0\\n'");
    const cacheKey = {};
    const absent = context(emptyDirectory, [probe("path-tool", "build")]);
    absent.cacheKey = cacheKey;
    expect((await detectToolchains(absent)).configured).toBe(false);

    const found = context(foundDirectory, [probe("path-tool", "build")]);
    found.cacheKey = cacheKey;
    expect((await detectToolchains(found)).found[0]?.version).toBe("4.0.0");
  });

  it("does not reuse a stable holder entry across different probe sets", async () => {
    const directory = await fixtureBinary("probe-a", "printf 'fixture 5.0.0\\n'");
    const secondDirectory = await fixtureBinary("probe-b", "printf 'fixture 6.0.0\\n'");
    const cacheKey = {};
    const first = context(`${directory}:${secondDirectory}`, [probe("probe-a", "build")]);
    first.cacheKey = cacheKey;
    expect((await detectToolchains(first)).found[0]?.id).toBe("probe-a");

    const second = context(`${directory}:${secondDirectory}`, [probe("probe-b", "build")]);
    second.cacheKey = cacheKey;
    expect((await detectToolchains(second)).found[0]?.id).toBe("probe-b");
  });

  it("cancels an in-flight version probe through the lifecycle signal", async () => {
    const directory = await fixtureBinary("hanging-tool", "/bin/sleep 30");
    const controller = new AbortController();
    const ctx = context(directory, [probe("hanging-tool", "build")]);
    ctx.signal = controller.signal;
    const pending = detectToolchains(ctx);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([
    {
      name: "plain bare-metal build host",
      installed: ["arm-none-eabi-gcc", "cmake", "ninja"],
      configured: true,
      missing: ["west/zephyr-workspace", "openocd/flash"],
    },
    {
      name: "Zephyr build host",
      installed: ["arm-none-eabi-gcc", "cmake", "ninja", "west"],
      configured: true,
      missing: ["openocd/flash"],
    },
    {
      name: "flash-only host",
      installed: ["openocd"],
      configured: true,
      missing: [
        "arm-none-eabi-gcc/build",
        "cmake/build",
        "ninja/build",
        "west/zephyr-workspace",
      ],
    },
    {
      name: "fully provisioned host",
      installed: ["arm-none-eabi-gcc", "cmake", "ninja", "west", "openocd"],
      configured: true,
      missing: [],
    },
  ])("classifies the default probe table on a $name", async ({ installed, configured, missing }) => {
    const directory = await mkdtemp(join(tmpdir(), "fs-toolchain-capabilities-"));
    cleanup.push(directory);
    for (const id of installed) {
      const path = join(directory, id);
      await writeFile(path, "#!/bin/sh\nprintf '1.2.3\\n'\n", "utf8");
      await chmod(path, 0o700);
    }
    const report = await detectToolchains(context(directory, DEFAULT_TOOLCHAIN_PROBES));
    expect(report.configured).toBe(configured);
    expect(report.missing.map((entry) => `${entry.id}/${entry.unlocks}`)).toEqual(missing);
  });
});
