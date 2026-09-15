// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  SERVER_MOVE_STEP_IDS,
  type LastServerMove,
  type ServerMoveStepId,
} from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type {
  ServerMoveStatus,
  ServerMoveStep,
  ServerMoveStepStatus,
} from "@bb/server-contract";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { serverMoveStatusQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ServerMoveOverlay } from "./ServerMoveOverlay";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    experimental_server: {
      cancelMove: vi.fn(),
      moveStatus: vi.fn(),
    },
  },
}));

const realtime = vi.hoisted(() => ({
  state: "connected" as "connecting" | "connected" | "reconnecting",
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    getConnectionState: () => realtime.state,
    onConnectionStateChange: () => () => {},
  },
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: vi.fn(), error: vi.fn() },
}));

function steps(
  statuses: Partial<Record<ServerMoveStepId, ServerMoveStepStatus>> = {},
): ServerMoveStep[] {
  return SERVER_MOVE_STEP_IDS.map((id) => ({
    id,
    status: statuses[id] ?? "pending",
    message: null,
  }));
}

const ALL_DONE = steps({
  "stop-work": "done",
  "update-target": "done",
  export: "done",
  transfer: "done",
  "start-target": "done",
  "verify-address": "skipped",
  switch: "done",
});

function move(overrides: Partial<ServerMoveStatus> = {}): ServerMoveStatus {
  return {
    moveId: "move_1",
    state: "preparing",
    mode: "connect",
    targetHostId: "host_desk",
    targetHostName: "desk",
    serverUrl: "https://sawyer.getbb.app",
    startedAt: 1_000,
    finishedAt: null,
    error: null,
    steps: steps(),
    cancellable: true,
    ...overrides,
  };
}

function lastMove(overrides: Partial<LastServerMove> = {}): LastServerMove {
  return {
    moveId: "move_1",
    fromHostId: "host_laptop",
    fromHostName: "laptop",
    toHostId: "host_desk",
    toHostName: "desk",
    completedAt: 2_000,
    oldCopyDeletedAt: null,
    ...overrides,
  };
}

function renderOverlay(path = "/") {
  const navigateTo = vi.fn();
  const { queryClient, wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[path]}>
      <ServerMoveOverlay navigateTo={navigateTo} pollIntervalMs={20} />
    </MemoryRouter>,
    { wrapper },
  );
  return { navigateTo, queryClient };
}

function stepStatus(container: HTMLElement, label: string): string | null {
  return (
    within(container)
      .getByText(label)
      .closest("li")
      ?.getAttribute("data-status") ?? null
  );
}

beforeEach(() => {
  realtime.state = "connected";
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ServerMoveOverlay", () => {
  it("renders nothing when no move is running", async () => {
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: null,
      lastMove: lastMove(),
    });
    const { queryClient } = renderOverlay();

    await waitFor(() => {
      expect(
        queryClient.getQueryData(serverMoveStatusQueryKey()),
      ).toBeDefined();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(appToast.success)).not.toHaveBeenCalled();
  });

  it("blocks the app with the step list and offers Cancel only while the move is cancellable", async () => {
    const cancelled = move({
      state: "cancelled",
      cancellable: false,
      finishedAt: 3_000,
      steps: steps({ "stop-work": "done", "update-target": "skipped" }),
    });
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: move({
        steps: steps({
          "stop-work": "done",
          "update-target": "skipped",
          export: "running",
        }),
      }),
      lastMove: null,
    });
    vi.mocked(sdk.experimental_server.cancelMove).mockImplementation(
      async () => {
        vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
          move: cancelled,
          lastMove: null,
        });
        return cancelled;
      },
    );
    renderOverlay();

    const overlay = await screen.findByRole("dialog", {
      name: "Moving server to desk",
    });
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("inset-0");
    expect(stepStatus(overlay, "Stopping running work")).toBe("done");
    expect(stepStatus(overlay, "Updating bb on desk")).toBe("skipped");
    expect(stepStatus(overlay, "Exporting server data")).toBe("running");
    expect(stepStatus(overlay, "Sending data to desk")).toBe("pending");
    expect(stepStatus(overlay, "Starting the new server")).toBe("pending");
    expect(stepStatus(overlay, "Checking the new address")).toBe("pending");
    expect(stepStatus(overlay, "Switching machines over")).toBe("pending");
    expect(document.body.hasAttribute("aria-hidden")).toBe(false);

    fireEvent.click(
      within(overlay).getByRole("button", { name: "Cancel move" }),
    );

    const ended = await screen.findByRole("dialog", {
      name: "Server move cancelled",
    });
    expect(vi.mocked(sdk.experimental_server.cancelMove)).toHaveBeenCalledTimes(
      1,
    );
    expect(
      within(ended).queryByRole("button", { name: "Cancel move" }),
    ).toBeNull();
    fireEvent.click(within(ended).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("hides Cancel once the move is switching machines over", async () => {
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: move({
        state: "switching",
        cancellable: false,
        steps: steps({
          "stop-work": "done",
          "update-target": "done",
          export: "done",
          transfer: "done",
          "start-target": "done",
          "verify-address": "done",
          switch: "running",
        }),
      }),
      lastMove: null,
    });
    renderOverlay();

    const overlay = await screen.findByRole("dialog", {
      name: "Moving server to desk",
    });
    expect(stepStatus(overlay, "Switching machines over")).toBe("running");
    expect(within(overlay).queryByRole("button")).toBeNull();
  });

  it("sends a direct-address move to the new server at the current path", async () => {
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: move({
        state: "completed",
        mode: "direct",
        serverUrl: "https://desk.example.com/",
        cancellable: false,
        finishedAt: 2_000,
        steps: ALL_DONE,
      }),
      lastMove: null,
    });
    const { navigateTo } = renderOverlay(
      "/projects/proj_1/threads/thr_1?panel=diff#turn-3",
    );

    const destination =
      "https://desk.example.com/projects/proj_1/threads/thr_1?panel=diff#turn-3";
    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith(destination);
    });
    const overlay = screen.getByRole("dialog", {
      name: "Server moved to desk",
    });
    expect(
      within(overlay)
        .getByRole("link", { name: "Open the new address" })
        .getAttribute("href"),
    ).toBe(destination);
    expect(navigateTo).toHaveBeenCalledTimes(1);
  });

  it("waits for a bb connect move to answer on the same address, then dismisses with a toast", async () => {
    vi.mocked(sdk.experimental_server.moveStatus)
      .mockResolvedValueOnce({
        move: move({
          state: "completed",
          cancellable: false,
          finishedAt: 2_000,
          steps: ALL_DONE,
        }),
        lastMove: null,
      })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({
        move: null,
        lastMove: lastMove({ moveId: "move_0", toHostName: "old-desk" }),
      })
      .mockResolvedValue({ move: null, lastMove: lastMove() });
    realtime.state = "reconnecting";
    const { navigateTo } = renderOverlay();

    expect(
      await screen.findByRole("dialog", { name: "Reconnecting to desk…" }),
    ).toBeDefined();

    await waitFor(() => {
      expect(vi.mocked(appToast.success)).toHaveBeenCalledWith(
        "Server moved to desk",
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(vi.mocked(appToast.success)).toHaveBeenCalledTimes(1);
  });

  it("shows why a followed move failed and stays dismissed after Close", async () => {
    vi.mocked(sdk.experimental_server.moveStatus)
      .mockResolvedValueOnce({
        move: move({ steps: steps({ "stop-work": "running" }) }),
        lastMove: null,
      })
      .mockResolvedValue({
        move: move({
          state: "failed",
          cancellable: false,
          finishedAt: 3_000,
          error: { step: "transfer", message: "desk ran out of disk space" },
          steps: steps({
            "stop-work": "done",
            "update-target": "done",
            export: "done",
            transfer: "failed",
          }),
        }),
        lastMove: null,
      });
    const { queryClient } = renderOverlay();

    await screen.findByRole("dialog", { name: "Moving server to desk" });
    await queryClient.invalidateQueries({
      queryKey: serverMoveStatusQueryKey(),
    });

    const overlay = await screen.findByRole("dialog", {
      name: "Couldn't move the server to desk",
    });
    expect(
      within(overlay).getByText("desk ran out of disk space"),
    ).toBeDefined();
    expect(
      within(overlay).getByText("The server keeps running where it was."),
    ).toBeDefined();
    expect(stepStatus(overlay, "Sending data to desk")).toBe("failed");

    fireEvent.click(within(overlay).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await queryClient.invalidateQueries({
      queryKey: serverMoveStatusQueryKey(),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not block the app for a failure that finished before this app was open", async () => {
    vi.mocked(sdk.experimental_server.moveStatus).mockResolvedValue({
      move: move({
        state: "failed",
        cancellable: false,
        finishedAt: 3_000,
        error: { step: "export", message: "Disk full" },
      }),
      lastMove: null,
    });
    const { queryClient } = renderOverlay();

    await waitFor(() => {
      expect(
        queryClient.getQueryData(serverMoveStatusQueryKey()),
      ).toBeDefined();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains a move the server forgot by restarting", async () => {
    vi.mocked(sdk.experimental_server.moveStatus)
      .mockResolvedValueOnce({ move: move(), lastMove: null })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ move: null, lastMove: null });
    realtime.state = "reconnecting";
    renderOverlay();

    await screen.findByRole("dialog", { name: "Moving server to desk" });
    const overlay = await screen.findByRole("dialog", {
      name: "Server move stopped",
    });
    fireEvent.click(within(overlay).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("follows the old address's server_moved answer to the new server", async () => {
    vi.mocked(sdk.experimental_server.moveStatus)
      .mockResolvedValueOnce({
        move: move({
          state: "switching",
          mode: "direct",
          serverUrl: "https://desk.example.com",
          cancellable: false,
        }),
        lastMove: null,
      })
      .mockRejectedValue(
        new BbHttpError({
          status: 410,
          code: "server_moved",
          message: "This bb server moved to desk",
          body: {
            code: "server_moved",
            message: "This bb server moved to desk",
            details: {
              serverUrl: "https://desk.tailnet.example",
              toHostName: "desk",
              movedAt: 2_000,
            },
          },
        }),
      );
    const { navigateTo } = renderOverlay("/settings/machines?tab=all");

    await waitFor(() => {
      expect(navigateTo).toHaveBeenCalledWith(
        "https://desk.tailnet.example/settings/machines?tab=all",
      );
    });
  });
});
