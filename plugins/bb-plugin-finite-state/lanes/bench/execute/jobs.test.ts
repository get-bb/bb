import { describe, expect, it, vi } from "vitest";
import type { ForgeJobSnapshot } from "../../../lib/remote/types.js";
import { ForgeJobPollLimitError, pollForgeJob, pollForgeJobs } from "./jobs.js";

function snapshot(
  status: ForgeJobSnapshot["status"],
  result: ForgeJobSnapshot["result"] = null,
) {
  return {
    jobId: "job-1",
    status,
    tool: "verify_dynamic",
    recipe: null,
    scope: {},
    environment: {},
    runId: null,
    elapsedSeconds: 1,
    logTail: [],
    events: [],
    eventCount: 0,
    result,
    error: null,
  } satisfies ForgeJobSnapshot;
}

const immediate = { sleep: async () => undefined };

describe("Forge job polling", () => {
  it("polls RUNNING to COMPLETED and reads result only from the terminal response", async () => {
    const getJobStatus = vi
      .fn()
      .mockResolvedValueOnce(
        snapshot("RUNNING", { forbiddenEarlyResult: true }),
      )
      .mockResolvedValueOnce(snapshot("COMPLETED", { outcome: "pass" }));
    await expect(
      pollForgeJob({ getJobStatus }, "job-1", new AbortController().signal, {
        scheduler: immediate,
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      result: { outcome: "pass" },
    });
    expect(getJobStatus).toHaveBeenCalledTimes(2);
  });

  it.each(["FAILED", "TIMEOUT"] as const)(
    "returns exact %s terminal state",
    async (status) => {
      await expect(
        pollForgeJob(
          { getJobStatus: async () => snapshot(status) },
          "job-1",
          new AbortController().signal,
          { scheduler: immediate },
        ),
      ).resolves.toMatchObject({ status });
    },
  );

  it("cancels during backoff", async () => {
    const controller = new AbortController();
    const scheduler = {
      async sleep() {
        controller.abort(new Error("cancelled"));
      },
    };
    await expect(
      pollForgeJob(
        { getJobStatus: async () => snapshot("RUNNING") },
        "job-1",
        controller.signal,
        { scheduler },
      ),
    ).rejects.toThrow("cancelled");
  });

  it("rejects an unknown runtime state", async () => {
    const invalid = Object.defineProperty(snapshot("RUNNING"), "status", {
      value: "CANCELLED",
    });
    await expect(
      pollForgeJob(
        { getJobStatus: async () => invalid },
        "job-1",
        new AbortController().signal,
        { scheduler: immediate },
      ),
    ).rejects.toThrow("FORGE_JOB_UNKNOWN_STATE");
  });

  it("resumes the same job id after a connection reset", async () => {
    const getJobStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(snapshot("COMPLETED", { outcome: "pass" }));
    await pollForgeJob(
      { getJobStatus },
      "job-1",
      new AbortController().signal,
      {
        scheduler: immediate,
      },
    );
    expect(getJobStatus.mock.calls.map((call) => call[0])).toEqual([
      "job-1",
      "job-1",
    ]);
  });

  it("bounds a never-terminal job so the serial queue can advance", async () => {
    const getJobStatus = vi.fn(async () => snapshot("RUNNING"));
    await expect(
      pollForgeJob({ getJobStatus }, "job-1", new AbortController().signal, {
        scheduler: immediate,
        maximumPollAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(ForgeJobPollLimitError);
    expect(getJobStatus).toHaveBeenCalledTimes(3);
  });

  it("lets each job reach its own polling outcome before rejecting the batch", async () => {
    const calls = new Map<string, number>();
    const getJobStatus = vi.fn(async (jobId: string) => {
      calls.set(jobId, (calls.get(jobId) ?? 0) + 1);
      if (jobId === "transient-job") throw new Error("ECONNRESET");
      return { ...snapshot("RUNNING"), jobId };
    });

    await expect(
      pollForgeJobs(
        { getJobStatus },
        ["transient-job", "ceiling-job"],
        new AbortController().signal,
        {
          scheduler: immediate,
          maximumConsecutiveErrors: 0,
          maximumPollAttempts: 3,
        },
      ),
    ).rejects.toMatchObject({
      name: "ForgeJobPollLimitError",
      message: expect.stringMatching(/ceiling-job.*3 polls/iu),
    });
    expect(calls).toEqual(
      new Map([
        ["transient-job", 1],
        ["ceiling-job", 3],
      ]),
    );
  });
});
