import { describe, expect, it, vi } from "vitest";
import {
  closeLastDesktopWindow,
  hasPendingDesktopWork,
} from "../src/desktop-background-work.js";

function responses(queue: unknown, automations: unknown, status = 200) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(queue))
    .mockResolvedValueOnce(
      Response.json({ ok: true, result: { automations } }, { status }),
    );
}

it("keeps scheduled sends alive even when the automation plugin is absent", async () => {
  expect(
    await hasPendingDesktopWork(
      "http://localhost:3000",
      responses([{ sendAt: 100 }], [], 404),
    ),
  ).toBe(true);
});

it.each([
  { enabled: true, nextRunAt: 123, lastRunStatus: null, pending: true },
  { enabled: false, nextRunAt: 123, lastRunStatus: null, pending: false },
  { enabled: true, nextRunAt: null, lastRunStatus: "running", pending: true },
  { enabled: false, nextRunAt: null, lastRunStatus: "running", pending: true },
  { enabled: true, nextRunAt: null, lastRunStatus: "ok", pending: false },
])(
  "detects pending automation work: $enabled/$nextRunAt/$lastRunStatus",
  async ({ pending, ...automation }) => {
    expect(
      await hasPendingDesktopWork(
        "http://localhost:3000",
        responses([], [{ automation }]),
      ),
    ).toBe(pending);
  },
);

it("distinguishes no work from unavailable or malformed schedule state", async () => {
  expect(
    await hasPendingDesktopWork(
      "http://localhost:3000",
      responses([], [], 404),
    ),
  ).toBe(false);
  await expect(
    hasPendingDesktopWork("http://localhost:3000", responses([], [], 503)),
  ).rejects.toThrow();
  await expect(
    hasPendingDesktopWork("http://localhost:3000", responses({}, [])),
  ).rejects.toThrow();
});

function lifecycle(platform: NodeJS.Platform = "win32") {
  return {
    platform,
    isQuitting: vi.fn(() => false),
    hasOpenWindows: vi.fn(() => false),
    hasPendingWork: vi.fn(async () => true),
    quit: vi.fn(),
    onError: vi.fn(),
  };
}

describe("last window closes", () => {
  it("keeps Windows running for pending work and quits with no pending work", async () => {
    const args = lifecycle();
    await closeLastDesktopWindow(args);
    expect(args.quit).not.toHaveBeenCalled();
    args.hasPendingWork.mockResolvedValue(false);
    await closeLastDesktopWindow(args);
    expect(args.quit).toHaveBeenCalledOnce();
  });

  it("does not interfere with explicit Quit or OS shutdown", async () => {
    const args = lifecycle();
    args.isQuitting.mockReturnValue(true);
    await closeLastDesktopWindow(args);
    expect(args.hasPendingWork).not.toHaveBeenCalled();
    expect(args.quit).not.toHaveBeenCalled();
  });

  it("keeps the runtime alive if schedule lookup fails", async () => {
    const args = lifecycle();
    args.hasPendingWork.mockRejectedValue(new Error("offline"));
    await closeLastDesktopWindow(args);
    expect(args.quit).not.toHaveBeenCalled();
    expect(args.onError).toHaveBeenCalledOnce();
  });

  it("does not quit a window reopened during lookup", async () => {
    const args = lifecycle();
    args.hasPendingWork.mockImplementation(async () => {
      args.hasOpenWindows.mockReturnValue(true);
      return false;
    });
    await closeLastDesktopWindow(args);
    expect(args.quit).not.toHaveBeenCalled();
  });

  it("preserves Mac keep-alive and Linux close behavior", async () => {
    const mac = lifecycle("darwin");
    const linux = lifecycle("linux");
    await closeLastDesktopWindow(mac);
    await closeLastDesktopWindow(linux);
    expect(mac.quit).not.toHaveBeenCalled();
    expect(linux.quit).toHaveBeenCalledOnce();
    expect(mac.hasPendingWork).not.toHaveBeenCalled();
    expect(linux.hasPendingWork).not.toHaveBeenCalled();
  });
});
