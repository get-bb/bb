import { describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_SELECT_ALL_CHANNEL } from "../src/desktop-window-command-ipc.js";
import {
  handleDesktopSelectAllFallback,
  requestDesktopSelectAll,
} from "../src/desktop-select-all.js";

function target(id: number) {
  return {
    id,
    isDestroyed: vi.fn(() => false),
    selectAll: vi.fn(),
    send: vi.fn(),
  };
}

describe("desktop Select All routing", () => {
  it("requests scoped selection from a registered application renderer", () => {
    const application = target(1);

    requestDesktopSelectAll(application, new Set([application.id]));

    expect(application.send).toHaveBeenCalledWith(
      BB_DESKTOP_SELECT_ALL_CHANNEL,
      null,
    );
    expect(application.selectAll).not.toHaveBeenCalled();
  });

  it("uses native selection for non-application web contents", () => {
    const browserView = target(2);

    requestDesktopSelectAll(browserView, new Set());

    expect(browserView.selectAll).toHaveBeenCalledOnce();
    expect(browserView.send).not.toHaveBeenCalled();
  });

  it("ignores a destroyed web contents target", () => {
    const destroyedTarget = target(5);
    destroyedTarget.isDestroyed.mockReturnValue(true);

    requestDesktopSelectAll(destroyedTarget, new Set());

    expect(destroyedTarget.selectAll).not.toHaveBeenCalled();
    expect(destroyedTarget.send).not.toHaveBeenCalled();
  });

  it("uses native selection for a fallback from a registered renderer", () => {
    const application = target(3);

    expect(
      handleDesktopSelectAllFallback(application, new Set([application.id])),
    ).toBe(true);
    expect(application.selectAll).toHaveBeenCalledOnce();
  });

  it("ignores fallback requests from unregistered web contents", () => {
    const untrustedContents = target(4);

    expect(handleDesktopSelectAllFallback(untrustedContents, new Set())).toBe(
      false,
    );
    expect(untrustedContents.selectAll).not.toHaveBeenCalled();
  });
});
