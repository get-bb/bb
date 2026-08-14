import { describe, expect, it, vi } from "vitest";
import type { FirmwareReadinessSnapshot } from "../../firmware/forge/readiness.js";
import { runD0 } from "./d0-static.js";
import type { CascadeDeps, Hypothesis, StaticQuery } from "./types.js";

const h: Hypothesis = {
  id: "hyp-init",
  text: "the expected init path is present",
  class: "logic",
  likelihood: 0.8,
  easeOfVerification: 0.9,
};

function readiness(): FirmwareReadinessSnapshot {
  return {
    pvId: "pv-1",
    readiness: "fully_materialized",
    rootfsPath: "/fixture/rootfs",
    manifestGeneration: "a".repeat(64),
    meta: {
      pvId: "pv-1",
      scanId: null,
      inputSha256: "b".repeat(64),
      source: "standalone_unpack",
      artifactHash: "c".repeat(64),
      fullyMaterialized: true,
      materializedAt: "2026-08-14T00:00:00.000Z",
      nodeCount: 1,
      hydratedCount: 1,
      adminBytesOk: null,
      unpackErrors: [],
      stale: false,
    },
    nodes: [
      {
        path: "/bin/fixture",
        kind: "file",
        fileHash: "d".repeat(64),
        size: 1,
        mimeType: "application/x-elf",
        fullType: "ELF",
        unixMode: null,
        symlinkTarget: null,
        materialized: true,
        errors: [],
      },
    ],
  };
}

function deps(overrides: Partial<CascadeDeps> = {}): CascadeDeps {
  return {
    loadFirmwareReadiness: vi.fn(async () => readiness()),
    stp: {
      configured: true,
      run: vi.fn(async () => ({
        status: "completed" as const,
        matched: true,
        command: ["stp", "callgraph", "/fixture/rootfs"],
        evidence: [{ kind: "stp-callgraph", path: ".fs-bench/d0.json" }],
      })),
    },
    runBench: vi.fn(async () => ({
      runId: "unused",
      threadId: "unused",
      jobIds: [],
      firmwareDigest: "e".repeat(64),
      status: "running" as const,
    })),
    readRehostingObservation: vi.fn(async () => ({
      output: "",
      command: ["unused"],
      evidence: [],
    })),
    waitForRehostingTerminal: vi.fn(async () => ({
      state: "completed" as const,
    })),
    renode: {
      executable: "renode",
      probe: vi.fn(async () => true),
      run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    },
    scenariosRoot: "/fixture",
    artifactsRoot: "/fixture",
    isTrackedFile: vi.fn(async () => true),
    readText: vi.fn(async () => ""),
    writeText: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("D0 static cascade", () => {
  it("runs a callgraph query over the readiness-checked fixture mount", async () => {
    const dependencies = deps();
    const query: StaticQuery = {
      kind: "call_path",
      hypothesis: h,
      projectVersionId: "pv-1",
      fromSymbol: "boot",
      toSymbol: "init_uart",
    };
    await expect(
      runD0(dependencies, query, new AbortController().signal),
    ).resolves.toMatchObject({
      tier: "d0",
      outcome: "confirmed",
      producedBy: {
        command: ["stp", "callgraph", "/fixture/rootfs"],
        inputs: { mountGeneration: "a".repeat(64) },
      },
    });
    expect(dependencies.stp.run).toHaveBeenCalledWith(
      "/fixture/rootfs",
      query,
      expect.any(AbortSignal),
    );
  });

  it("compares an init sequence with the same-silicon corpus", async () => {
    const dependencies = deps({
      stp: {
        configured: true,
        run: vi.fn(async () => ({
          status: "completed" as const,
          matched: true,
          observedSequence: ["clock", "gpio", "uart"],
          command: ["stp", "init-sequence"],
          evidence: [{ kind: "blob", path: ".fs-bench/blob.json" }],
        })),
      },
      corpus: {
        findInitSequence: vi.fn(async () => ({
          siliconFamily: "STM32H7",
          initSequence: ["clock", "gpio", "uart"],
          evidence: [{ kind: "corpus", path: ".fs-bench/corpus.json" }],
        })),
      },
    });
    await expect(
      runD0(
        dependencies,
        {
          kind: "init_sequence",
          hypothesis: h,
          projectVersionId: "pv-1",
          siliconFamily: "STM32H7",
          expectedSequence: ["clock", "gpio", "uart"],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      outcome: "confirmed",
      evidence: [
        { kind: "blob", path: ".fs-bench/blob.json" },
        { kind: "corpus", path: ".fs-bench/corpus.json" },
      ],
      producedBy: { inputs: { corpus: "compared" } },
    });
  });

  it("degrades visibly to blob-only analysis when the corpus is absent", async () => {
    const dependencies = deps({
      stp: {
        configured: true,
        run: vi.fn(async () => ({
          status: "completed" as const,
          matched: true,
          observedSequence: ["clock"],
          command: ["stp", "init-sequence"],
          evidence: [],
        })),
      },
    });
    const result = await runD0(
      dependencies,
      {
        kind: "init_sequence",
        hypothesis: h,
        projectVersionId: "pv-1",
        siliconFamily: "STM32H7",
        expectedSequence: ["clock"],
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "confirmed",
      annotations: [{ code: "BLOB_ONLY_ANALYSIS" }],
      producedBy: { inputs: { corpus: "absent" } },
    });
  });

  it.each(["partial", "metadata_only"] as const)(
    "refuses a legal %s readiness snapshot before byte analysis",
    async (mountReadiness) => {
      const run = vi.fn();
      const snapshot = readiness();
      const dependencies = deps({
        loadFirmwareReadiness: vi.fn(async () => ({
          ...snapshot,
          readiness: mountReadiness,
          meta: { ...snapshot.meta, fullyMaterialized: false },
        })),
        stp: { configured: true, run },
      });
      await expect(
        runD0(
          dependencies,
          {
            kind: "call_path",
            hypothesis: h,
            projectVersionId: "pv-1",
            fromSymbol: "a",
            toSymbol: "b",
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "MOUNT_INCOMPLETE" });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("rejects a corpus observation from the wrong silicon family", async () => {
    const dependencies = deps({
      stp: {
        configured: true,
        run: vi.fn(async () => ({
          status: "completed" as const,
          matched: true,
          observedSequence: ["clock"],
          command: ["stp", "init-sequence"],
          evidence: [],
        })),
      },
      corpus: {
        findInitSequence: vi.fn(async () => ({
          siliconFamily: "OTHER",
          initSequence: ["clock"],
          evidence: [],
        })),
      },
    });
    await expect(
      runD0(
        dependencies,
        {
          kind: "init_sequence",
          hypothesis: h,
          projectVersionId: "pv-1",
          siliconFamily: "STM32H7",
          expectedSequence: ["clock"],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "CORPUS_SILICON_MISMATCH" });
  });
});
