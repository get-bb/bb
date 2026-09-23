import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pluginInstallJobSchema,
  type PluginInstallJob,
} from "@bb/server-contract";
import { z } from "zod";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { createPluginInstallJobs } from "../../../src/services/plugins/plugin-install-jobs.js";

const BASE = "http://127.0.0.1:3334";

const jobResponseSchema = z.object({
  ok: z.literal(true),
  job: pluginInstallJobSchema,
});

async function startInstall(
  harness: TestAppHarness,
  source: string,
): Promise<PluginInstallJob> {
  const response = await harness.app.request(`${BASE}/api/v1/plugins/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source }),
  });
  expect(response.status).toBe(202);
  return jobResponseSchema.parse(await response.json()).job;
}

async function settledJob(
  harness: TestAppHarness,
  jobId: string,
): Promise<PluginInstallJob> {
  return vi.waitFor(
    async () => {
      const response = await harness.app.request(
        `${BASE}/api/v1/plugins/install-jobs/${jobId}`,
      );
      expect(response.status).toBe(200);
      const { job } = jobResponseSchema.parse(await response.json());
      if (job.state === "running") {
        throw new Error(`install job ${jobId} is still running`);
      }
      return job;
    },
    { timeout: 20_000 },
  );
}

describe("plugin install jobs", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it("answers immediately and reports the installed plugin through the job", async () => {
    const started = await startInstall(harness, "builtin:keep-awake");

    expect(started.state).toBe("running");
    await expect(settledJob(harness, started.id)).resolves.toMatchObject({
      state: "succeeded",
      plugin: { id: "keep-awake", status: "running" },
    });
  });

  it("reports a failed install through the job", async () => {
    vi.spyOn(harness.pluginService, "install").mockRejectedValue(
      new Error("install sentinel"),
    );

    const started = await startInstall(harness, "builtin:keep-awake");

    await expect(settledJob(harness, started.id)).resolves.toEqual({
      id: started.id,
      state: "failed",
      error: "install sentinel",
    });
  });

  it("answers 404 for a job the server does not know", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/install-jobs/missing`,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "unknown install job; the server may have restarted",
    });
  });

  it("forgets finished jobs once the retention window passes", async () => {
    vi.useFakeTimers();
    try {
      const jobs = createPluginInstallJobs();
      const finished = jobs.start(async () => {
        throw new Error("done");
      });
      await vi.waitFor(() => {
        expect(jobs.get(finished.id)?.state).toBe("failed");
      });

      vi.advanceTimersByTime(10 * 60_000 + 1);
      jobs.start(async () => {
        throw new Error("later");
      });

      expect(jobs.get(finished.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
