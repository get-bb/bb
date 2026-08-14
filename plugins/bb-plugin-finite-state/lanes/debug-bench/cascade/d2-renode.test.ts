import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenodeDriver, runD2 } from "./d2-renode.js";
import { type CascadeDeps, type RenodeReplayRequest } from "./types.js";

const roots: string[] = [];

async function fixture(golden = "boot ok\n"): Promise<{
  root: string;
  request: RenodeReplayRequest;
}> {
  const root = await mkdtemp(join(tmpdir(), "fs126-renode-"));
  roots.push(root);
  await mkdir(join(root, ".fs-bench"));
  const scenarioPath = join(root, "boot.resc");
  const platformPath = join(root, "board.repl");
  const goldenLogPath = join(root, "boot.log");
  await Promise.all([
    writeFile(
      scenarioPath,
      "mach create\nmachine LoadPlatformDescription @board.repl\nstart\n",
      "utf8",
    ),
    writeFile(platformPath, "cpu: CPU.CortexM\n", "utf8"),
    writeFile(goldenLogPath, golden, "utf8"),
  ]);
  const [canonicalRoot, canonicalScenario, canonicalPlatform, canonicalGolden] =
    await Promise.all([
      realpath(root),
      realpath(scenarioPath),
      realpath(platformPath),
      realpath(goldenLogPath),
    ]);
  return {
    root: canonicalRoot,
    request: {
      kind: "boot_chain",
      hypothesis: {
        id: "hyp-boot",
        text: "the boot chain reaches userspace",
        class: "state",
        likelihood: 0.7,
        easeOfVerification: 0.8,
      },
      scenarioPath: canonicalScenario,
      platformPath: canonicalPlatform,
      goldenLogPath: canonicalGolden,
      outputArtifactPath: ".fs-bench/actual.log",
    },
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function deps(
  root: string,
  outputs: readonly string[],
  configured = true,
): CascadeDeps {
  let index = 0;
  return {
    loadFirmwareReadiness: vi.fn(),
    stp: { configured: false, run: vi.fn() },
    runBench: vi.fn(),
    waitForRehostingTerminal: vi.fn(),
    readRehostingObservation: vi.fn(),
    renode: {
      executable: "/opt/renode/renode",
      probe: vi.fn(async () => configured),
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: outputs[Math.min(index++, outputs.length - 1)] ?? "",
        stderr: "",
      })),
    },
    scenariosRoot: root,
    artifactsRoot: root,
    isTrackedFile: vi.fn(async () => true),
    readText: async (path) => await readFile(path, "utf8"),
    writeText: async (path, text) => await writeFile(path, text, "utf8"),
  };
}

describe("D2 Renode replay", () => {
  it("passes hostile-looking arguments literally without a shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs126-argv-"));
    roots.push(root);
    const marker = join(root, "shell-was-used");
    const literal = `$(touch ${marker})`;
    const driver = createRenodeDriver(process.execPath);
    const result = await driver.run(
      ["-e", "process.stdout.write(process.argv[1])", literal],
      root,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: literal });
    await expect(access(marker)).rejects.toThrow();
  });

  it("terminates an owned hanging process group on abort", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs126-abort-"));
    roots.push(root);
    const driver = createRenodeDriver(process.execPath);
    const controller = new AbortController();
    const running = driver.run(
      ["-e", "setInterval(() => {}, 1000)"],
      root,
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error("test abort")), 20);
    await expect(running).rejects.toThrow("test abort");
  });

  it.each([
    ["boot ok\n", "confirmed"],
    ["boot failed\n", "refuted"],
  ] as const)(
    "diffs a stable replay against the golden",
    async (output, outcome) => {
      const { root, request } = await fixture();
      const dependencies = deps(root, [output, output]);
      await expect(
        runD2(dependencies, request, new AbortController().signal),
      ).resolves.toMatchObject({
        tier: "d2",
        outcome,
        producedBy: {
          command: [
            "/opt/renode/renode",
            "-p",
            "--console",
            "--disable-gui",
            request.scenarioPath,
            "-e",
            "quit",
          ],
          inputs: { replayCount: "2" },
        },
      });
      expect(
        await readFile(join(root, request.outputArtifactPath), "utf8"),
      ).toBe(output);
    },
  );

  it("reports missing Renode as a lane-scoped configuration prerequisite", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, [], false);
    await expect(
      runD2(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "RENODE_NOT_CONFIGURED",
      needsConfiguration: "debug-bench.renode",
    });
    expect(dependencies.renode.run).not.toHaveBeenCalled();
  });

  it("refuses platform-model authoring before probing any host prerequisite", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, []);
    await expect(
      runD2(
        dependencies,
        { ...request, kind: "model_platform" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "D2_OUT_OF_SCOPE" });
    expect(dependencies.renode.probe).not.toHaveBeenCalled();
  });

  it("fails closed when identical invocations produce different normalized output", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, ["boot ok\n", "boot maybe\n"]);
    await expect(
      runD2(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "D2_NONDETERMINISTIC_OUTPUT" });
  });

  it("normalizes timestamps while retaining deterministic log content", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, [
      "12:00:00.0001 boot ok\n",
      "12:00:01.9999 boot ok\n",
    ]);
    await expect(
      runD2(dependencies, request, new AbortController().signal),
    ).resolves.toMatchObject({ outcome: "confirmed" });
  });

  it("enforces physical confirmation rules at the D2 boundary", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, ["boot ok\n", "boot ok\n"]);
    await expect(
      runD2(
        dependencies,
        {
          ...request,
          hypothesis: { ...request.hypothesis, class: "power" },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "CASCADE_CONFIRM_REQUIRES_PHYSICAL",
      coercedVerdict: {
        outcome: "inconclusive",
        forcedEscalation: true,
      },
    });
  });

  it("refuses untracked replay inputs", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, ["boot ok\n", "boot ok\n"]);
    dependencies.isTrackedFile = vi.fn(
      async (path) => path !== request.scenarioPath,
    );
    await expect(
      runD2(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "D2_SCENARIO_NOT_TRACKED" });
    expect(dependencies.renode.run).not.toHaveBeenCalled();
  });

  it("refuses to write replay output outside the diagnostic artifact root", async () => {
    const { root, request } = await fixture();
    const dependencies = deps(root, ["boot ok\n", "boot ok\n"]);
    await expect(
      runD2(
        dependencies,
        { ...request, outputArtifactPath: "../escape.log" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "D2_INVALID_OUTPUT_PATH" });
    expect(dependencies.renode.run).not.toHaveBeenCalled();
  });

  it("binds the declared platform to the checked-in scenario", async () => {
    const { root, request } = await fixture();
    await writeFile(request.scenarioPath, "mach create\nstart\n", "utf8");
    const dependencies = deps(root, ["boot ok\n", "boot ok\n"]);
    await expect(
      runD2(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "D2_PLATFORM_NOT_REFERENCED" });
    expect(dependencies.renode.run).not.toHaveBeenCalled();
  });
});
