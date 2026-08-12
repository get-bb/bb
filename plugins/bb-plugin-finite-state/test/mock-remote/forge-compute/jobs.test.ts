import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerMockForgeCompute } from "./register.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

describe("mock optional Forge compute", () => {
  it("can be absent without affecting the independently constructed core mocks", () => {
    expect(registerMockForgeCompute(fixtureRoot, { configured: false })).toBeNull();
  });

  it("keeps root preparation unsupported and reaches every terminal state in order", () => {
    let tick = 0;
    const service = registerMockForgeCompute(fixtureRoot, {
      clock: {
        now: () => `2026-05-12T14:30:${String(tick).padStart(2, "0")}.000Z`,
        elapsedSeconds: () => tick++,
      },
    });
    expect(service).not.toBeNull();
    const controller = service!.controller;
    expect(controller.prepare({
      projectVersionId: "pv-a481df87dadf",
      rootPath: "/not-exposed",
      expectedDigest: "digest",
    })).toEqual({ prepared: false, reason: "UNSUPPORTED_UNVERIFIED_MAPPING" });

    for (const terminal of ["COMPLETED", "FAILED", "TIMEOUT"] as const) {
      const { jobId } = service!.verifyDynamic({ projectVersionId: "pv-a481df87dadf" });
      expect(service!.watchJob(jobId)).toMatchObject({ status: "RUNNING", eventCount: 1 });
      controller.advance(jobId, terminal);
      const final = service!.getJobStatus(jobId);
      expect(final.status).toBe(terminal);
      expect(final.events.map((event) => (event as { type: string }).type)).toEqual(["RUNNING", terminal]);
      expect(final.eventCount).toBe(2);
    }
    expect(new Set(service!.listJobs().map((job) => job.status))).toEqual(
      new Set(["RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]),
    );
    expect("platform" in service!).toBe(false);
    expect("assuranceStudio" in service!).toBe(false);
  });

  it("normalizes the reserved CANCELLED fixture into the four-state vocabulary", () => {
    const service = registerMockForgeCompute(fixtureRoot)!;
    expect(service.getJobStatus("forge-job-cancelled")).toMatchObject({
      status: "FAILED",
      error: { code: "FORGE_JOB_CANCELLED" },
    });
  });
});
