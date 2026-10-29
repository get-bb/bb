import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/windows-process-tree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/windows-process-tree.js")>()),
  terminateWindowsProcessTrees: vi.fn(async () => true),
}));

const { stopRecordedProcess } = await import("../src/recorded-process.js");
const { terminateWindowsProcessTrees } =
  await import("../src/windows-process-tree.js");
const platform = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
});

it("keeps a live Windows record unverified without signalling it", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });

  await expect(
    stopRecordedProcess(
      { pid: process.pid, processGroup: false, startId: "1761700000000" },
      { graceMs: 100 },
    ),
  ).resolves.toBe("unverified");
  expect(terminateWindowsProcessTrees).not.toHaveBeenCalled();
});
