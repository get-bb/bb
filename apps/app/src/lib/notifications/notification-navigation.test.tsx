// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Toaster, toast } from "sonner";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { RouteAnchor, RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { appToast } from "@/components/ui/app-toast";
import {
  getNotifications,
  openNotificationCenter,
  resetNotificationStore,
} from "./notification-store";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: vi.fn(),
}));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

afterEach(() => {
  cleanup();
  toast.dismiss();
  resetNotificationStore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(surface: "toast" | "center", href: string, prevented = false) {
  vi.useFakeTimers();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <RouteNavigationProvider>
        <Location />
        <Toaster />
        <NotificationCenter />
      </RouteNavigationProvider>
    </MemoryRouter>,
  );
  act(() => {
    appToast.message("Other notification", { id: "other", duration: Infinity });
    appToast.success("Thread finished", {
      id: "thread-ready",
      duration: Infinity,
      description: (
        <RouteAnchor
          href={href}
          onClick={prevented ? (event) => event.preventDefault() : undefined}
        >
          Open thread
        </RouteAnchor>
      ),
    });
    if (surface === "center") openNotificationCenter();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

it.each([
  ["toast", "/threads/thr_ready"],
  ["toast", "/projects/proj_work/threads/thr_ready"],
  ["center", "/threads/thr_ready"],
  ["center", "/projects/proj_work/threads/thr_ready"],
] as const)("dismisses only the %s notification used to open %s", async (surface, path) => {
  await setup(surface, `${path}?from=notification#latest`);

  fireEvent.click(screen.getByRole("link", { name: "Open thread" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });

  expect(screen.getByTestId("location").textContent).toBe(path);
  expect(screen.queryByText("Thread finished")).toBeNull();
  expect(getNotifications().map((notification) => notification.toastId)).toEqual(["other"]);
});

it("keeps the notification when its link cancels navigation", async () => {
  await setup("toast", "/threads/thr_ready", true);
  fireEvent.click(screen.getByRole("link", { name: "Open thread" }));

  expect(screen.getByTestId("location").textContent).toBe("/");
  expect(getNotifications()).toHaveLength(2);
  expect(screen.queryByText("Thread finished")).not.toBeNull();
});

it("keeps the notification when navigating to a non-thread route", async () => {
  await setup("center", "/settings");
  fireEvent.click(screen.getByRole("link", { name: "Open thread" }));

  expect(screen.getByTestId("location").textContent).toBe("/settings");
  expect(getNotifications()).toHaveLength(2);
});
