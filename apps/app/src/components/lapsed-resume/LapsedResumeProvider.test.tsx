// @vitest-environment jsdom
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import type { SystemLapsedResumeResponse } from "@bb/server-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { sdk } from "@/lib/sdk";
import { getThreadRoutePath } from "@/lib/route-paths";
import { LapsedResumeProvider } from "./LapsedResumeProvider";
import { LapsedResumeList } from "./LapsedResumeList";
import {
  recordLapsedResumeDismissed,
  recordLapsedResumeShown,
} from "./lapsed-resume-telemetry";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { experimental_openLapsedResume: vi.fn() } },
}));

vi.mock("./lapsed-resume-telemetry", () => ({
  recordLapsedResumeShown: vi.fn(),
  recordLapsedResumeDismissed: vi.fn(),
}));

const target = { threadId: "thread-unfinished", projectId: "project" };
const finished = { threadId: "thread-finished", projectId: "project" };
const targetPath = getThreadRoutePath(target);
const onNavigate = vi.fn();

function response(): SystemLapsedResumeResponse {
  return {
    lapsed: true,
    lastActivityAt: 1,
    target,
    threads: [
      {
        ...target,
        title: "Waiting for a decision",
        status: "idle",
        reason: "waiting",
      },
      {
        ...finished,
        title: "Completed result",
        status: "idle",
        reason: "finished",
      },
    ],
    suggestionAnalyticsId: "lapse-random-id",
  };
}

function RouteControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="path">{location.pathname}</output>
      <button onClick={() => void navigate("/settings")}>Settings</button>
      <button onClick={() => void navigate("/")}>Home</button>
      <button onClick={() => void navigate(-1)}>Back</button>
      <input aria-label="Message" />
      <LapsedResumeList onNavigate={onNavigate} />
    </>
  );
}

function renderApp({
  entries = ["/"],
  compact = false,
}: { entries?: string[]; compact?: boolean } = {}) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={entries}>
        <CompactViewportOverrideProvider isCompactViewport={compact}>
          <SidebarProvider>
            <RouteNavigationProvider>
              <LapsedResumeProvider>
                <RouteControls />
              </LapsedResumeProvider>
            </RouteNavigationProvider>
          </SidebarProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.mocked(sdk.system.experimental_openLapsedResume).mockResolvedValue(
    response(),
  );
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("lapsed reopen", () => {
  it("claims once under Strict Mode, replaces home, and honors navigating away", async () => {
    renderApp({ entries: ["/settings", "/"] });
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(targetPath),
    );
    expect(sdk.system.experimental_openLapsedResume).toHaveBeenCalledTimes(1);
    expect(recordLapsedResumeShown).toHaveBeenCalledExactlyOnceWith(
      "lapse-random-id",
    );
    expect(
      screen.getByRole("heading", { name: "While you were away" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/settings"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/"),
    );
    expect(sdk.system.experimental_openLapsedResume).toHaveBeenCalledTimes(1);
    expect(recordLapsedResumeShown).toHaveBeenCalledTimes(1);
  });

  it.each(["/settings", "/?compose=1", "/#message"])(
    "preserves the initial deep link %s",
    async (path) => {
      renderApp({ entries: [path] });
      await screen.findByRole("heading", { name: "While you were away" });
      expect(screen.getByTestId("path").textContent).toBe(
        path.split(/[?#]/)[0],
      );
      expect(recordLapsedResumeShown).not.toHaveBeenCalled();
    },
  );

  it("does not overwrite navigation while the open request is pending", async () => {
    const pending = createDeferredPromise<SystemLapsedResumeResponse>();
    vi.mocked(sdk.system.experimental_openLapsedResume).mockReturnValue(
      pending.promise,
    );
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => pending.resolve(response()));
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(recordLapsedResumeShown).not.toHaveBeenCalled();
  });

  it("does not interrupt composing while the open request is pending", async () => {
    const pending = createDeferredPromise<SystemLapsedResumeResponse>();
    vi.mocked(sdk.system.experimental_openLapsedResume).mockReturnValue(
      pending.promise,
    );
    renderApp();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), {
      key: "a",
    });
    await act(async () => pending.resolve(response()));
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(recordLapsedResumeShown).not.toHaveBeenCalled();
  });

  it("keeps home with no unfinished target and still lists finished results", async () => {
    const result = response();
    result.target = null;
    result.threads = result.threads.filter(
      (thread) => thread.reason === "finished",
    );
    vi.mocked(sdk.system.experimental_openLapsedResume).mockResolvedValue(
      result,
    );
    renderApp();
    await screen.findByRole("link", { name: /Completed result/ });
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(recordLapsedResumeShown).not.toHaveBeenCalled();
  });

  it("dismisses the list once without changing the resumed route", async () => {
    renderApp();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Dismiss while you were away",
      }),
    );
    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).toBeNull();
    expect(recordLapsedResumeDismissed).toHaveBeenCalledExactlyOnceWith(
      "lapse-random-id",
    );
    expect(screen.getByTestId("path").textContent).toBe(targetPath);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).toBeNull();
  });

  it("resumes on compact screens and closes their sidebar when a result is selected", async () => {
    renderApp({ compact: true });
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(targetPath),
    );
    fireEvent.click(screen.getByRole("link", { name: /Completed result/ }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        getThreadRoutePath(finished),
      ),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("leaves the current home usable when the request fails", async () => {
    vi.mocked(sdk.system.experimental_openLapsedResume).mockRejectedValue(
      new Error("offline"),
    );
    renderApp();
    await act(async () => {});
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(
      screen.queryByRole("heading", { name: "While you were away" }),
    ).toBeNull();
    expect(recordLapsedResumeShown).not.toHaveBeenCalled();
  });
});
