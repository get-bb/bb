// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  SystemAppUpdateResult,
  SystemAppUpdateStatus,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { systemAppUpdateQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AppUpdateHost } from "./AppUpdateHost";
import {
  closeAppUpdateResultDetails,
  openAppUpdateResultDetails,
} from "./app-update-details-store";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      acknowledgeAppUpdate: vi.fn(),
      appUpdate: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getConnectionState: () => "connected",
    onConnectionStateChange: () => () => {},
  },
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn(), success: vi.fn() },
}));

function status(
  overrides: Partial<SystemAppUpdateStatus> = {},
): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available: null,
    blocked: null,
    current: { commit: null, version: "1.1.0" },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
    ...overrides,
  };
}

function result(
  overrides: Partial<SystemAppUpdateResult> = {},
): SystemAppUpdateResult {
  return {
    acknowledged: false,
    finishedAt: "2026-09-23T00:00:00.000Z",
    from: { commit: null, version: "1.0.0" },
    id: "update-1",
    logTail: [],
    message: null,
    outcome: "updated",
    phase: null,
    to: { commit: null, version: "1.1.0" },
    ...overrides,
  };
}

function renderHost(props: Parameters<typeof AppUpdateHost>[0] = {}) {
  const harness = createQueryClientTestHarness();
  render(<AppUpdateHost {...props} />, { wrapper: harness.wrapper });
  return harness;
}

afterEach(() => {
  act(() => closeAppUpdateResultDetails());
  cleanup();
  vi.clearAllMocks();
});

describe("AppUpdateHost", () => {
  it("announces a successful update once and marks it seen", async () => {
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({ lastResult: result() }),
    );
    vi.mocked(sdk.system.acknowledgeAppUpdate).mockResolvedValue(
      status({ lastResult: result({ acknowledged: true }) }),
    );

    renderHost();

    await waitFor(() => {
      expect(appToast.success).toHaveBeenCalledWith("Updated bb to 1.1.0");
    });
    await waitFor(() => {
      expect(sdk.system.acknowledgeAppUpdate).toHaveBeenCalledWith({
        id: "update-1",
      });
    });
    expect(appToast.success).toHaveBeenCalledOnce();
  });

  it("keeps a failure visible until dismissed from its details", async () => {
    const failed = result({
      logTail: ["npm error code E404"],
      message: "npm install failed",
      outcome: "failed",
      phase: "install",
    });
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({
        current: { commit: null, version: "1.0.0" },
        lastResult: failed,
      }),
    );
    vi.mocked(sdk.system.acknowledgeAppUpdate).mockResolvedValue(
      status({ lastResult: { ...failed, acknowledged: true } }),
    );

    renderHost();

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith(
        "Update to 1.1.0 failed",
        expect.objectContaining({ description: "npm install failed" }),
      );
    });
    expect(sdk.system.acknowledgeAppUpdate).not.toHaveBeenCalled();

    expect(vi.mocked(appToast.error).mock.calls[0]?.[1]?.action).toMatchObject({
      label: "Details",
    });
    act(() => openAppUpdateResultDetails(failed));
    expect(await screen.findByText("npm error code E404")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(sdk.system.acknowledgeAppUpdate).toHaveBeenCalledWith({
        id: "update-1",
      });
    });
  });

  it("covers the app while bb restarts into the new version", async () => {
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({
        activity: {
          phase: "restarting",
          startedAt: "2026-09-23T00:00:00.000Z",
          targetVersion: "1.2.0",
        },
      }),
    );

    renderHost();

    expect(await screen.findByText("Updating bb to 1.2.0")).toBeDefined();
    expect(
      document.querySelector("[data-app-update-overlay]")?.getAttribute("role"),
    ).toBe("dialog");
  });

  it("stays quiet when there is nothing to report", async () => {
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({ lastResult: result({ acknowledged: true }) }),
    );

    renderHost();

    await waitFor(() => expect(sdk.system.appUpdate).toHaveBeenCalled());
    expect(appToast.success).not.toHaveBeenCalled();
    expect(appToast.error).not.toHaveBeenCalled();
    expect(document.querySelector("[data-app-update-overlay]")).toBeNull();
  });

  it("reloads the page once the server comes back on a new revision", async () => {
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({ current: { commit: null, version: "1.0.0" } }),
    );
    const onRevisionChanged = vi.fn();
    const { queryClient } = renderHost({ onRevisionChanged });
    await waitFor(() =>
      expect(queryClient.getQueryData(systemAppUpdateQueryKey())).toBeDefined(),
    );

    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({ lastResult: result() }),
    );
    await act(() => queryClient.invalidateQueries());

    await waitFor(() => expect(onRevisionChanged).toHaveBeenCalledOnce());
    expect(appToast.success).not.toHaveBeenCalled();
    expect(sdk.system.acknowledgeAppUpdate).not.toHaveBeenCalled();
  });

  it("lets the user dismiss a restart overlay that outlasts its patience", async () => {
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({
        activity: {
          phase: "restarting",
          startedAt: "2026-09-23T00:00:00.000Z",
          targetVersion: "1.2.0",
        },
      }),
    );

    renderHost({ restartPatienceMs: 10 });

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(document.querySelector("[data-app-update-overlay]")).toBeNull();
  });

  it("keeps the details open when dismissing the result fails", async () => {
    const failed = result({
      message: "Server failed to start",
      outcome: "failed",
    });
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      status({ lastResult: failed }),
    );
    vi.mocked(sdk.system.acknowledgeAppUpdate).mockRejectedValue(
      new Error("The bb-app launcher did not respond."),
    );
    renderHost();
    await waitFor(() => expect(appToast.error).toHaveBeenCalled());

    act(() => openAppUpdateResultDetails(failed));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith(
        "Couldn't dismiss the update result",
        expect.objectContaining({
          description: "The bb-app launcher did not respond.",
        }),
      );
    });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
