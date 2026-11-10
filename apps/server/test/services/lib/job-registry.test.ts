import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import {
  createJobRegistry,
  FINISHED_JOB_RETENTION_MS,
} from "../../../src/services/lib/job-registry.js";

type TestJob =
  | { id: string; name: string; state: "queued" | "running" }
  | { id: string; name: string; state: "done" }
  | { id: string; name: string; state: "failed"; error: string };

function createRegistry(now: () => number = Date.now) {
  return createJobRegistry<TestJob>({
    isActive: (job) => job.state === "queued" || job.state === "running",
    fail: ({ id, name }, error) => ({
      id,
      name,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
    notifyChanged: () => {},
    now,
  });
}

describe("createJobRegistry", () => {
  it("runs one job at a time per lane and lanes side by side", async () => {
    const registry = createRegistry();
    const gates = new Map(
      ["a1", "a2", "b1"].map((name) => [name, createDeferredPromise<void>()]),
    );
    const start = (name: string, lane: string) =>
      registry.start({
        key: name,
        lane,
        create: (id) => ({ id, name, state: "queued" }),
        run: async ({ job, set }) => {
          set({ ...job, state: "running" });
          await gates.get(name)?.promise;
          return { id: job.id, name, state: "done" };
        },
      });

    const a1 = start("a1", "a");
    const a2 = start("a2", "a");
    const b1 = start("b1", "b");
    const states = () =>
      [a1, a2, b1].map((job) => registry.get(job.id)?.state);
    expect(states()).toEqual(["running", "queued", "running"]);

    gates.get("a1")?.resolve();
    await vi.waitFor(() =>
      expect(states()).toEqual(["done", "running", "running"]),
    );
  });

  it("returns the active job for a repeated key and keeps the error that failed it", async () => {
    let clock = 0;
    const registry = createRegistry(() => clock);
    const failure = new Error("machine offline");
    const gate = createDeferredPromise<void>();
    const start = () =>
      registry.start({
        key: "same",
        lane: "lane",
        create: (id) => ({ id, name: "same", state: "running" }),
        run: async () => {
          await gate.promise;
          throw failure;
        },
      });

    const first = start();
    expect(start().id).toBe(first.id);
    gate.resolve();
    await expect(registry.settled(first.id)).resolves.toEqual({
      job: { id: first.id, name: "same", state: "failed", error: "machine offline" },
      error: failure,
    });
    expect(start().id).not.toBe(first.id);

    clock += FINISHED_JOB_RETENTION_MS;
    expect(registry.get(first.id)).toBeUndefined();
  });
});
