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

describe("truncated toast text", () => {
  const FITTING_WIDTH = 300;
  const OVERFLOWING_WIDTH = 600;
  const LONG_TITLE =
    "Cannot checkout branch while another thread is using this workspace";
  const SHORT_TITLE = "Installing the plugin failed";
  const DESCRIPTION = "a very long esbuild error";

  function mockOverflowingText(overflowingText: string | null) {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.textContent === overflowingText
          ? OVERFLOWING_WIDTH
          : FITTING_WIDTH;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      FITTING_WIDTH,
    );
  }

  function showMoreButton() {
    return screen.queryByRole("button", { name: "Show more" });
  }

  it("offers Show more when only the title does not fit", () => {
    mockOverflowingText(LONG_TITLE);
    render(
      <AppToastContent
        title={LONG_TITLE}
        description={DESCRIPTION}
        tone="error"
        notificationId="notification-7"
      />,
    );

    expect(showMoreButton()).not.toBeNull();
  });

  it("offers Show more when only the description does not fit", () => {
    mockOverflowingText(DESCRIPTION);
    render(
      <AppToastContent
        title={SHORT_TITLE}
        description={DESCRIPTION}
        tone="error"
        notificationId="notification-7"
      />,
    );

    expect(showMoreButton()).not.toBeNull();
  });

  it("hides Show more when the title and the description both fit", () => {
    mockOverflowingText(null);
    render(
      <AppToastContent
        title={SHORT_TITLE}
        description={DESCRIPTION}
        tone="error"
        notificationId="notification-7"
      />,
    );

    expect(showMoreButton()).toBeNull();
  });

  it("recovers a title-only toast whose title does not fit", () => {
    mockOverflowingText(LONG_TITLE);
    render(
      <AppToastContent
        title={LONG_TITLE}
        tone="error"
        notificationId="notification-9"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(getNotificationCenterState()).toEqual({
      open: true,
      focusedId: "notification-9",
    });
  });
});
