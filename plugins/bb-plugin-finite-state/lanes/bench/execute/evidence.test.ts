import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeJobSnapshot } from "../../../lib/remote/types.js";
import { listBenchAttestations } from "../store/attestations.js";
import { storeEvidenceCheckpoint } from "../store/results.js";
import {
  createBenchTestStore,
  DIGEST_A,
  DIGEST_B,
  evidenceBundle,
} from "../store/test-helpers.js";
import { forgeEvidenceCheckpoint } from "./evidence.js";

const hosts: Array<ReturnType<typeof createBenchTestStore>["host"]> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function completed(subjectDigest: string): ForgeJobSnapshot {
  return {
    jobId: "job-1",
    status: "COMPLETED",
    tool: "verify_dynamic",
    recipe: "qemu",
    scope: {},
    environment: {},
    runId: "run-a",
    elapsedSeconds: 2,
    logTail: ["bounded line"],
    events: [{ phase: "done" }],
    eventCount: 1,
    result: {
      outcome: "pass",
      summary: "explicit evidence pass",
      attestation: {
        format: "sigstore",
        subjectDigest,
        payload: "{}",
        signature: "signed-envelope",
      },
    },
    error: null,
  };
}

async function checkpoint(subjectDigest: string, signatureVerified: boolean) {
  const verify = vi.fn(async () => signatureVerified);
  const bundle = await forgeEvidenceCheckpoint(
    {
      persistLog: async () => "runs/run-a/jobs/job-1.log",
      verifier: { verify },
    },
    { run: evidenceBundle().run, jobs: [completed(subjectDigest)], requirementId: "REQ-A" },
    new AbortController().signal,
  );
  return { bundle, verify };
}

describe("bench evidence conversion", () => {
  it("accepts a cryptographically verified attestation with the prepared digest subject", async () => {
    const fixture = createBenchTestStore("execute-evidence-valid");
    hosts.push(fixture.host);
    const { bundle, verify } = await checkpoint(DIGEST_A, true);
    storeEvidenceCheckpoint(fixture.db, bundle);
    const page = listBenchAttestations(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 10,
      continuation: null,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(page.items[0]).toMatchObject({
      signatureVerified: true,
      subjectMatchesRun: true,
      verified: true,
    });
  });

  it("keeps a valid signature with a mismatched subject unverified", async () => {
    const fixture = createBenchTestStore("execute-evidence-mismatch");
    hosts.push(fixture.host);
    const { bundle } = await checkpoint(DIGEST_B, true);
    storeEvidenceCheckpoint(fixture.db, bundle);
    const page = listBenchAttestations(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 10,
      continuation: null,
    });
    expect(page.items[0]).toMatchObject({
      signatureVerified: true,
      subjectMatchesRun: false,
      verified: false,
    });
  });

  it("stores signing-unavailable evidence as unsigned", async () => {
    const fixture = createBenchTestStore("execute-evidence-unsigned");
    hosts.push(fixture.host);
    const bundle = await forgeEvidenceCheckpoint(
      { persistLog: async () => "runs/run-a/jobs/job-1.log" },
      { run: evidenceBundle().run, jobs: [completed(DIGEST_A)], requirementId: "REQ-A" },
      new AbortController().signal,
    );
    storeEvidenceCheckpoint(fixture.db, bundle);
    const page = listBenchAttestations(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 10,
      continuation: null,
    });
    expect(page.items[0]).toMatchObject({ signatureVerified: false, verified: false });
  });

  it("never infers pass from COMPLETED without an explicit result outcome", async () => {
    const job = completed(DIGEST_A);
    Object.defineProperty(job, "result", { value: null });
    const bundle = await forgeEvidenceCheckpoint(
      { persistLog: async () => null },
      { run: evidenceBundle().run, jobs: [job], requirementId: "REQ-A" },
      new AbortController().signal,
    );
    expect(bundle.results[0]).toMatchObject({ outcome: "error" });
  });

  it("keeps each persisted log locator aligned with its originating job", async () => {
    const first = completed(DIGEST_A);
    const second = { ...completed(DIGEST_A), jobId: "job-2", tool: "pen_test_run" };
    const bundle = await forgeEvidenceCheckpoint(
      {
        persistLog: async (_runId, job) =>
          job.jobId === "job-2" ? "runs/run-a/jobs/job-2.log" : null,
      },
      { run: evidenceBundle().run, jobs: [first, second], requirementId: "REQ-A" },
      new AbortController().signal,
    );
    expect(bundle.run.logLocator).toBe("runs/run-a/jobs/job-2.log");
    expect(bundle.run.raw).toMatchObject({
      jobs: [
        { jobId: "job-1", logLocator: null },
        { jobId: "job-2", logLocator: "runs/run-a/jobs/job-2.log" },
      ],
    });
  });
});
