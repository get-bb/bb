// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppToastContent, appToast } from "@/components/ui/app-toast";
import { createRecordingToast } from "./plugin-toast-recording";
import {
  getNotificationCenterState,
  getNotifications,
  resetNotificationStore,
} from "./notification-store";

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetNotificationStore();
});

describe("toast history", () => {
  it("collapses a toast that is replaced by its result into one entry", () => {
    appToast.message("Installing…", { id: "install" });
    appToast.error("Install failed", {
      id: "install",
      description: 'Could not resolve "@radix-ui/react-tabs"',
    });

    expect(getNotifications()).toHaveLength(1);
    expect(getNotifications()[0]?.tone).toBe("error");
    expect(getNotifications()[0]?.description).toBe(
      'Could not resolve "@radix-ui/react-tabs"',
    );
  });

  it("records plugin toasts without breaking the wrapped sonner methods", () => {
    const base = Object.assign(vi.fn(), {
      error: vi.fn((message?: unknown, data?: unknown) => {
        void message;
        void data;
        return "error";
      }),
      dismiss: vi.fn(() => "dismiss"),
    });
    const recording = createRecordingToast(base);

    recording.error("Sandbox boot failed", { description: "exit code 1" });

    expect(getNotifications()[0]?.title).toBe("Sandbox boot failed");
    expect(base.error).toHaveBeenCalledWith("Sandbox boot failed", {
      description: "exit code 1",
    });
    expect(recording.dismiss()).toBe("dismiss");
  });
});

describe("truncated toast descriptions", () => {
  function renderToast() {
    render(
      <AppToastContent
        title="Installing the plugin failed"
        description="a very long esbuild error"
        tone="error"
        notificationId="notification-7"
      />,
    );
  }

  function mockWidths(scrollWidth: number, clientWidth: number) {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "app-toast-description"
          ? scrollWidth
          : clientWidth;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      clientWidth,
    );
  }

  it("offers Show more only when the description does not fit", () => {
    mockWidths(300, 300);
    renderToast();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    cleanup();
    mockWidths(600, 300);
    renderToast();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeNull();
  });

  it("offers full details when wrapped text exceeds the visible height", () => {
    mockWidths(300, 300);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "app-toast-description" ? 160 : 20;
      },
    );
    renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(getNotificationCenterState().focusedId).toBe("notification-7");
  });

  it("opens the center on the matching entry from Show more", () => {
    mockWidths(600, 300);
    renderToast();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(getNotificationCenterState()).toEqual({
      open: true,
      focusedId: "notification-7",
    });
  });
});
