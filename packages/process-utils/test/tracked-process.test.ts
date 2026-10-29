import { expect, it, vi } from "vitest";

vi.mock("../src/process-start.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/process-start.js")>()),
  probeProcessStart: vi
    .fn()
    .mockResolvedValueOnce({ state: "unknown" })
    .mockResolvedValue({ state: "running", startId: "token" }),
}));

const { trackedChildProcess } = await import("../src/tracked-process.js");

it("probes a held child's start token again after a failed probe", async () => {
  const tracked = trackedChildProcess(
    { pid: 4242, exitCode: null, signalCode: null, once: () => undefined },
    { processGroup: false, label: "child" },
  );

  await expect(tracked!.startId()).resolves.toBeNull();
  await expect(tracked!.startId()).resolves.toBe("token");
});
