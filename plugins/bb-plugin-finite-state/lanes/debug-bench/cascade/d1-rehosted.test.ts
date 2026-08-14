import { describe, expect, it, vi } from "vitest";
import { BenchRunError } from "../../bench/execute/run.js";
import { runD1 } from "./d1-rehosted.js";
import {
  type CascadeDeps,
  type ReproRequest,
  type RehostingRunState,
} from "./types.js";

const request: ReproRequest = {
  hypothesis: {
    id: "hyp-crash",
    text: "the parser crashes on malformed input",
    class: "logic",
    likelihood: 0.8,
    easeOfVerification: 0.7,
  },
  bench: {
    projectId: "project-1",
    pvId: "pv-1",
    tier: "tier1",
    hostId: "host-1",
    requirementId: "REQ-1",
    target: "CVE-1:component-1",
  },
  symptom: { kind: "crash_signature", signature: "SIGSEGV parser.c:42" },
};

function deps(
  observation: Awaited<ReturnType<CascadeDeps["readRehostingObservation"]>>,
  terminal: RehostingRunState = { state: "completed" },
): CascadeDeps {
  return {
    loadFirmwareReadiness: vi.fn(),
    stp: { configured: false, run: vi.fn() },
    runBench: vi.fn(async () => ({
      runId: "bench-rehost-1",
      threadId: "thread-1",
      jobIds: ["job-1"],
      firmwareDigest: "a".repeat(64),
      status: "running" as const,
    })),
    waitForRehostingTerminal: vi.fn(async () => terminal),
    readRehostingObservation: vi.fn(async () => observation),
    renode: {
      executable: "renode",
      probe: vi.fn(async () => false),
      run: vi.fn(),
    },
    scenariosRoot: "/unused",
    artifactsRoot: "/unused",
    isTrackedFile: vi.fn(async () => false),
    readText: vi.fn(async () => ""),
    writeText: vi.fn(async () => undefined),
  };
}

describe("D1 rehosted reproduction", () => {
  it("delegates to WP-53 and confirms a literally matched symptom", async () => {
    const dependencies = deps({
      output: "booting\nSIGSEGV parser.c:42\n",
      command: ["forge", "verify_dynamic", "job-1"],
      evidence: [{ kind: "emulation-log", path: ".fs-bench/job-1.log" }],
    });
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).resolves.toMatchObject({
      outcome: "confirmed",
      rehostingRunId: "bench-rehost-1",
      producedBy: {
        command: ["forge", "verify_dynamic", "job-1"],
        inputs: { rehostingRunId: "bench-rehost-1" },
      },
    });
    expect(dependencies.runBench).toHaveBeenCalledWith(
      request.bench,
      expect.any(AbortSignal),
    );
  });

  it("refutes a symptom that a completed emulation did not reproduce", async () => {
    const dependencies = deps({
      output: "boot complete",
      command: ["forge", "verify_dynamic", "job-1"],
      evidence: [],
    });
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).resolves.toMatchObject({ outcome: "refuted" });
  });

  it("marks an emulation failure inconclusive instead of refuting", async () => {
    const dependencies = deps(
      {
        output: "",
        command: ["forge", "verify_dynamic", "job-1"],
        evidence: [{ kind: "emulation-log", path: ".fs-bench/job-1.log" }],
      },
      { state: "failed", failureReason: "QEMU exited before boot" },
    );
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).resolves.toMatchObject({
      outcome: "inconclusive",
      annotations: [
        { code: "EMULATION_FAILED", message: "QEMU exited before boot" },
      ],
    });
  });

  it("propagates WP-53 preflight failure without reading or dispatching another runner", async () => {
    const dependencies = deps({
      output: "",
      command: ["unused"],
      evidence: [],
    });
    dependencies.runBench = vi.fn(async () => {
      throw new BenchRunError(
        "HOST_PREREQUISITE_MISSING",
        "Host cannot run tier 1",
      );
    });
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "HOST_PREREQUISITE_MISSING" });
    expect(dependencies.readRehostingObservation).not.toHaveBeenCalled();
    expect(dependencies.waitForRehostingTerminal).not.toHaveBeenCalled();
  });

  it("does not read or persist an observation while the dispatched run is in flight", async () => {
    const dependencies = deps(
      {
        output: "SIGSEGV parser.c:42",
        command: ["forge", "verify_dynamic"],
        evidence: [],
      },
      { state: "running" },
    );
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "D1_RUN_IN_FLIGHT" });
    expect(dependencies.readRehostingObservation).not.toHaveBeenCalled();
  });

  it("treats log patterns as literals rather than executing untrusted regex", async () => {
    const dependencies = deps({
      output: "literal (a+)+ marker",
      command: ["forge", "verify_dynamic"],
      evidence: [],
    });
    await expect(
      runD1(
        dependencies,
        {
          ...request,
          symptom: { kind: "log_pattern", pattern: "(a+)+" },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ outcome: "confirmed" });
  });

  it("treats a boot-hang marker as progress whose absence reproduces the hang", async () => {
    const dependencies = deps({
      output: "booting peripherals",
      command: ["forge", "verify_dynamic"],
      evidence: [],
    });
    await expect(
      runD1(
        dependencies,
        {
          ...request,
          symptom: { kind: "boot_hang", marker: "userspace ready" },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ outcome: "confirmed" });
    dependencies.readRehostingObservation = vi.fn(async () => ({
      output: "userspace ready",
      command: ["forge", "verify_dynamic"],
      evidence: [],
    }));
    await expect(
      runD1(
        dependencies,
        {
          ...request,
          symptom: { kind: "boot_hang", marker: "userspace ready" },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ outcome: "refuted" });
  });

  it("enforces physical confirmation rules at the D1 boundary", async () => {
    const dependencies = deps({
      output: "SIGSEGV parser.c:42",
      command: ["forge", "verify_dynamic"],
      evidence: [],
    });
    await expect(
      runD1(
        dependencies,
        {
          ...request,
          hypothesis: { ...request.hypothesis, class: "timing" },
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

  it("refuses a verdict when WP-53 observation provenance is missing", async () => {
    const dependencies = deps({
      output: "SIGSEGV parser.c:42",
      command: [],
      evidence: [],
    });
    await expect(
      runD1(dependencies, request, new AbortController().signal),
    ).rejects.toThrow("D1_PROVENANCE_MISSING");
  });
});
