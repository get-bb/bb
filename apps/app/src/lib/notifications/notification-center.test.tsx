// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { appToast } from "@/components/ui/app-toast";
import {
  getNotificationCenterState,
  openNotificationCenter,
  resetNotificationStore,
} from "./notification-store";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: vi.fn(),
}));

afterEach(() => {
  cleanup();
  resetNotificationStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("renders recorded Markdown in notification history", async () => {
  render(<NotificationCenter />);
  act(() => {
    appToast.error("**Install failed**", {
      description: "Retry `build` or read the [docs](https://example.com/docs).",
    });
    openNotificationCenter();
  });

  const docs = await screen.findByRole("link", { name: "docs" });
  expect(screen.getByText("Install failed").tagName).toBe("STRONG");
  expect(screen.getByText("build").tagName).toBe("CODE");
  expect(docs.getAttribute("href")).toBe("https://example.com/docs");
});

it("keeps notification details open when dismissing the toast restores composer focus", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
  render(
    <>
      <textarea aria-label="Composer" />
      <Toaster />
      <NotificationCenter />
    </>,
  );
  const composer = screen.getByRole("textbox", { name: "Composer" });
  act(() => {
    composer.focus();
    appToast.error(
      "Cannot submit the thread because the workspace is occupied",
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  const showMore = screen.getByRole("button", { name: "Show more" });
  act(() => {
    showMore.focus();
  });
  fireEvent.click(showMore);
  expect(getNotificationCenterState().open).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  expect(document.activeElement).toBe(composer);
  expect(getNotificationCenterState().open).toBe(true);
  expect(screen.getByTestId("notification-center").textContent).toContain(
    "Cannot submit the thread",
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(getNotificationCenterState().open).toBe(false);
});

it.each([false, true])(
  "requires manual close or Escape (compact: %s)",
  async (compact) => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <button type="button">Outside</button>
        <NotificationCenter />
      </CompactViewportOverrideProvider>,
    );
    act(() => {
      openNotificationCenter();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const outside = screen.getByRole("button", { name: "Outside" });
    const close = screen.getByRole("button", { name: "Hide notifications" });
    act(() => {
      close.focus();
    });
    act(() => {
      outside.focus();
    });
    expect(getNotificationCenterState().open).toBe(true);
    fireEvent(
      outside,
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    fireEvent.click(outside);
    if (compact) {
      const backdrop = document.querySelector(
        "[data-persistent-drawer-backdrop]",
      );
      if (!backdrop) throw new Error("Missing drawer backdrop");
      fireEvent.click(backdrop);
    }
    expect(getNotificationCenterState().open).toBe(true);
    fireEvent.click(close);
    expect(getNotificationCenterState().open).toBe(false);
    act(() => {
      openNotificationCenter();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(getNotificationCenterState().open).toBe(false);
  },
);
