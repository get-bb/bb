import { describe, expect, it, vi } from "vitest";
import { createDesktopQuitController } from "../src/desktop-quit.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const deps = {
    readStatus: vi.fn(async () => ({
      confirmDesktopQuit: true,
      runningAgentCount: 2,
    })),
    confirm: vi.fn(async (_count: number | null) => ({
      quit: false,
      dontAskAgain: false,
    })),
    disableConfirmation: vi.fn(async () => {}),
    finishQuit: vi.fn(async () => {}),
    quitApplication: vi.fn(),
    requestQuit: vi.fn(),
    onError: vi.fn(),
  };
  const controller = createDesktopQuitController(deps);
  deps.requestQuit.mockImplementation(() =>
    controller.beforeQuit({ preventDefault() {} }),
  );
  const request = () => {
    const event = { preventDefault: vi.fn() };
    controller.beforeQuit(event);
    return event;
  };
  return { deps, controller, request };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("desktop quit confirmation", () => {
  it.each(["win32", "linux"] as const)(
    "keeps the last %s window open on Cancel and releases it after confirmed teardown",
    async (platform) => {
      const { deps, controller } = setup();
      expect(controller.shouldCloseWindow(platform, true)).toBe(false);
      await settle();
      expect(deps.confirm).toHaveBeenCalledWith(2);
      expect(deps.finishQuit).not.toHaveBeenCalled();
      deps.confirm.mockResolvedValue({ quit: true, dontAskAgain: false });
      expect(controller.shouldCloseWindow(platform, true)).toBe(false);
      await settle();
      expect(controller.shouldCloseWindow(platform, true)).toBe(true);
      expect(deps.finishQuit).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["darwin", true],
    ["win32", false],
    ["linux", false],
  ] as const)(
    "allows %s window close (last=%s) without quitting",
    async (platform, last) => {
      const { deps, controller } = setup();
      expect(controller.shouldCloseWindow(platform, last)).toBe(true);
      await settle();
      expect(deps.requestQuit).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
    },
  );

  it("Cancel preserves runtime and permits a later quit request", async () => {
    const { deps, request } = setup();
    expect(request().preventDefault).toHaveBeenCalledOnce();
    await settle();
    expect(deps.confirm).toHaveBeenCalledWith(2);
    expect(deps.finishQuit).not.toHaveBeenCalled();
    expect(deps.quitApplication).not.toHaveBeenCalled();
    deps.confirm.mockResolvedValue({ quit: true, dontAskAgain: false });
    request();
    await settle();
    expect(deps.finishQuit).toHaveBeenCalledOnce();
    expect(deps.quitApplication).toHaveBeenCalledOnce();
    expect(request().preventDefault).not.toHaveBeenCalled();
  });

  it("coalesces repeated quits during both confirmation and runtime teardown", async () => {
    const { deps, request } = setup();
    const decision = deferred<{ quit: boolean; dontAskAgain: boolean }>();
    const stopped = deferred<void>();
    deps.confirm.mockReturnValue(decision.promise);
    deps.finishQuit.mockReturnValue(stopped.promise);
    request();
    request();
    await settle();
    expect(deps.confirm).toHaveBeenCalledOnce();
    decision.resolve({ quit: true, dontAskAgain: true });
    await settle();
    expect(deps.disableConfirmation).toHaveBeenCalledOnce();
    expect(request().preventDefault).toHaveBeenCalledOnce();
    expect(deps.quitApplication).not.toHaveBeenCalled();
    stopped.resolve();
    await settle();
    expect(deps.finishQuit).toHaveBeenCalledOnce();
    expect(deps.quitApplication).toHaveBeenCalledOnce();
  });

  it("does not persist Don't ask again when cancelling", async () => {
    const { deps, request } = setup();
    deps.confirm.mockResolvedValue({ quit: false, dontAskAgain: true });
    request();
    await settle();
    expect(deps.disableConfirmation).not.toHaveBeenCalled();
    expect(deps.finishQuit).not.toHaveBeenCalled();
  });

  it.each([
    { confirmDesktopQuit: true, runningAgentCount: 0 },
    { confirmDesktopQuit: false, runningAgentCount: 3 },
  ])("quits without prompting for %j", async (status) => {
    const { deps, request } = setup();
    deps.readStatus.mockResolvedValue(status);
    request();
    await settle();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.finishQuit).toHaveBeenCalledOnce();
  });

  it("asks conservatively when the server is unavailable", async () => {
    const { deps, request } = setup();
    deps.readStatus.mockRejectedValue(new Error("offline"));
    request();
    await settle();
    expect(deps.confirm).toHaveBeenCalledWith(null);
    expect(deps.finishQuit).not.toHaveBeenCalled();
  });

  it.each(["lookup", "dialog"])(
    "system shutdown or update supersedes a pending %s",
    async (pending) => {
      const { deps, controller, request } = setup();
      const status = deferred<{
        confirmDesktopQuit: boolean;
        runningAgentCount: number;
      }>();
      const decision = deferred<{ quit: boolean; dontAskAgain: boolean }>();
      if (pending === "lookup") deps.readStatus.mockReturnValue(status.promise);
      else deps.confirm.mockReturnValue(decision.promise);
      request();
      await settle();
      controller.bypassConfirmation();
      request();
      await settle();
      expect(deps.finishQuit).toHaveBeenCalledOnce();
      expect(deps.quitApplication).toHaveBeenCalledOnce();
      status.resolve({ confirmDesktopQuit: true, runningAgentCount: 2 });
      decision.resolve({ quit: true, dontAskAgain: true });
      await settle();
      expect(deps.finishQuit).toHaveBeenCalledOnce();
      expect(deps.disableConfirmation).not.toHaveBeenCalled();
    },
  );

  it("restores the guard after a failed updater restart", async () => {
    const { deps, controller, request } = setup();
    controller.bypassConfirmation();
    controller.restoreConfirmation();
    request();
    await settle();
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.finishQuit).not.toHaveBeenCalled();
  });

  it("finishes quitting if preference persistence or runtime teardown fails", async () => {
    const { deps, request } = setup();
    deps.confirm.mockResolvedValue({ quit: true, dontAskAgain: true });
    deps.disableConfirmation.mockRejectedValue(new Error("write failed"));
    deps.finishQuit.mockRejectedValue(new Error("stop failed"));
    request();
    await settle();
    expect(deps.quitApplication).toHaveBeenCalledOnce();
    expect(deps.onError).toHaveBeenCalledTimes(2);
  });
});
