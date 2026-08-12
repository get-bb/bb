import { describe, expect, it, vi } from "vitest";

import { RemoteError } from "../types.js";
import { ForgeComputeClient } from "./client.js";
import type { ForgeComputeTransport } from "./mcp-transport.js";

function statusResponse(status: "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED" = "RUNNING") {
  return {
    success: true,
    job_id: "job-1",
    status,
    tool: "pen_test_run",
    recipe: "recipe",
    scope: {},
    environment: {},
    run_id: "run-1",
    elapsed_seconds: 1,
    log_path: "/forge/secret.log",
    log_tail: "one\ntwo",
    events: [],
    event_count: 0,
  };
}

function listedJob(id: string) {
  return {
    job_id: id,
    status: "RUNNING",
    tool: "future_registry_tool",
    recipe: "recipe",
    scope: {},
    environment: {},
    elapsed_seconds: 1,
    log_path: `/forge/${id}.log`,
    run_dir: `/forge/${id}`,
  };
}

function transport(overrides: Partial<ForgeComputeTransport> = {}): ForgeComputeTransport {
  return {
    health: async () => undefined,
    verifyDynamic: async () => ({}),
    penTestRun: async () => ({}),
    getJobStatus: async () => statusResponse(),
    listJobs: async () => ({ success: true, count: 0, jobs: [] }),
    close: async () => undefined,
    ...overrides,
  };
}

async function collectJobIds(client: ForgeComputeClient): Promise<string[]> {
  const ids: string[] = [];
  for await (const page of client.listJobs({ page: { pageSize: 2 } })) {
    ids.push(...page.items.map(item => item.jobId));
  }
  return ids;
}

describe("ForgeComputeClient review regressions", () => {
  it.each([
    [false, "penTestRun.firmwarePathRequiredByManifest"],
    [true, "penTestRun.remoteFirmwareRoot"],
  ] as const)("fails penTestRun closed before an incomplete manifest dispatch", async (
    remoteTransport,
    operation,
  ) => {
    const penTestRun = vi.fn(async () => ({ success: true, job_id: "unexpected" }));
    const client = new ForgeComputeClient({
      transport: transport({ penTestRun }),
      remoteTransport,
    });
    await expect(client.penTestRun({
      cveId: "CVE-2026-1",
      componentId: "component-1",
      projectId: "project-1",
      projectVersionId: "version-1",
    })).rejects.toMatchObject({
      code: "REMOTE_UNSUPPORTED",
      details: { operation },
    });
    expect(penTestRun).not.toHaveBeenCalled();
  });

  it("pages one complete list_jobs envelope without refetching", async () => {
    const listJobs = vi.fn(async () => ({
      success: true,
      count: 3,
      jobs: [listedJob("job-1"), listedJob("job-2"), listedJob("job-3")],
    }));
    const client = new ForgeComputeClient({
      transport: transport({ listJobs }),
      remoteTransport: true,
    });
    await expect(collectJobIds(client)).resolves.toEqual(["job-1", "job-2", "job-3"]);
    expect(listJobs).toHaveBeenCalledTimes(1);
  });

  it("normalizes list_jobs error and partial paged envelopes", async () => {
    const failed = new ForgeComputeClient({
      transport: transport({ listJobs: async () => ({ success: false, error: "/secret/path" }) }),
      remoteTransport: true,
    });
    await expect(collectJobIds(failed)).rejects.toMatchObject({
      code: "FORGE_LIST_JOBS_FAILED",
      details: null,
    });

    const partial = new ForgeComputeClient({
      transport: transport({ listJobs: async () => ({
        success: true,
        count: 500,
        jobs: [listedJob("job-1"), listedJob("job-2")],
      }) }),
      remoteTransport: true,
    });
    await expect(collectJobIds(partial)).rejects.toMatchObject({
      code: "FORGE_LIST_JOBS_PARTIAL_ENVELOPE",
      details: { count: 500, jobs: 2 },
    });
  });

  it("strips only manifest-named local fields while preserving result paths", async () => {
    const client = new ForgeComputeClient({
      transport: transport({
        verifyDynamic: async () => ({
          bundle_path: "/forge/bundle",
          firmware_path: "/forge/rootfs",
          attack_path: "network-to-kernel",
        }),
        getJobStatus: async () => ({
          ...statusResponse("COMPLETED"),
          events: [{
            attack_path: "network-to-kernel",
            code_path: "parse -> copy",
            file_path: "evidence/source.c",
            registry: "/forge/registry.json",
          }],
          event_count: 1,
          result: {
            attack_path: "network-to-kernel",
            code_path: "parse -> copy",
            file_path: "evidence/source.c",
            nested: { firmware_path: "/forge/rootfs" },
          },
        }),
      }),
      remoteTransport: true,
    });

    await expect(client.verifyDynamic({
      projectVersionId: "version-1",
      verdictIds: ["verdict-1"],
    })).resolves.toEqual({ attack_path: "network-to-kernel" });
    const job = await client.getJobStatus("job-1");
    expect(job.events).toEqual([{
      attack_path: "network-to-kernel",
      code_path: "parse -> copy",
      file_path: "evidence/source.c",
    }]);
    expect(job.result).toEqual({
      attack_path: "network-to-kernel",
      code_path: "parse -> copy",
      file_path: "evidence/source.c",
      nested: {},
    });
  });

  it.each(["COMPLETED", "TIMEOUT"] as const)(
    "stops watchJob on the %s terminal state",
    async terminal => {
      const getJobStatus = vi.fn(async () => statusResponse(terminal));
      const sleep = vi.fn(async () => undefined);
      const client = new ForgeComputeClient({
        transport: transport({ getJobStatus }),
        remoteTransport: true,
        scheduler: { now: () => 0, sleep },
      });
      const statuses: string[] = [];
      for await (const item of client.watchJob("job-1")) statuses.push(item.status);
      expect(statuses).toEqual([terminal]);
      expect(getJobStatus).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("recovers a safe job-status read after a retryable connection reset", async () => {
    let attempts = 0;
    const client = new ForgeComputeClient({
      transport: transport({
        getJobStatus: async () => {
          attempts += 1;
          if (attempts === 1) throw new RemoteError("reset", {
            service: "forge-compute",
            code: "FORGE_TRANSPORT_ERROR",
            status: null,
            retryable: true,
            retryAfterMs: null,
            details: null,
          });
          return statusResponse("RUNNING");
        },
      }),
      remoteTransport: true,
      scheduler: { now: () => 0, sleep: async () => undefined },
    });
    await expect(client.getJobStatus("job-1")).resolves.toMatchObject({
      jobId: "job-1",
      status: "RUNNING",
    });
    expect(attempts).toBe(2);
  });
});
