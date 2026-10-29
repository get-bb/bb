import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/process-start.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/process-start.js")>()),
  probeProcessStart: vi.fn(async () => ({ state: "unknown" })),
}));
vi.mock("../src/windows-process-tree.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/windows-process-tree.js")>()),
  terminateWindowsProcessTrees: vi.fn(async () => true),
}));

const { stopRecordedProcess } = await import("../src/recorded-process.js");
const platform = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform);
});

it("reports a Windows stop as unverified when the process cannot be inspected", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });

  await expect(
    stopRecordedProcess(
      { pid: 4242, processGroup: false, startId: "1761700000000" },
      { graceMs: 100 },
    ),
  ).resolves.toBe("unverified");
});
