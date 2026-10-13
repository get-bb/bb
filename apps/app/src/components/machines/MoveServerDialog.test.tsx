// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { SERVER_MOVE_STEP_IDS } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type {
  ServerMoveCheckResponse,
  ServerMoveStatus,
} from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { MoveServerDialog } from "./MoveServerDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    experimental_server: {
      checkMove: vi.fn(),
      moveStatus: vi.fn(),
      startMove: vi.fn(),
    },
  },
}));

const TARGET = makeHost({ id: "host_desk", name: "desk" });

function checkResponse(
  overrides: Partial<ServerMoveCheckResponse> = {},
): ServerMoveCheckResponse {
  return {
    targetHostId: TARGET.id,
    targetHostName: TARGET.name,
    mode: "connect",
    serverUrl: null,
    requiresServerUrl: false,
    targetDataDir: "/home/sawyer/.bb-machines/laptop",
    existingTargetServerData: null,
    items: [],
    canMove: true,
    ...overrides,
  };
}

function startedMove(): ServerMoveStatus {
  return {
    moveId: "move_1",
    state: "preparing",
    mode: "connect",
    targetHostId: TARGET.id,
    targetHostName: TARGET.name,
    serverUrl: "https://sawyer.getbb.app",
    destinationStatusUrl: null,
    startedAt: 1,
    finishedAt: null,
    error: null,
    steps: SERVER_MOVE_STEP_IDS.map((id) => ({
      id,
      status: "pending",
      message: null,
    })),
    cancellable: true,
  };
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const { wrapper } = createQueryClientTestHarness();
  render(<MoveServerDialog target={TARGET} onOpenChange={onOpenChange} />, {
    wrapper,
  });
  return { onOpenChange };
}

function startButton(): HTMLElement {
  return screen.getByRole("button", { name: "Stop all and move" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MoveServerDialog", () => {
  it("checks the machine, groups the results by severity, and starts a bb connect move", async () => {
    vi.mocked(sdk.experimental_server.checkMove).mockResolvedValue(
      checkResponse({
        items: [
          {
            id: "timezone",
            severity: "info",
            title: "desk uses Europe/Berlin",
            detail: "Core plugin schedules shift by 9 hours.",
          },
          {
            id: "running-turns",
            severity: "warning",
            title: "2 turns are running",
            detail: null,
          },
        ],
      }),
    );
    vi.mocked(sdk.experimental_server.startMove).mockResolvedValue(
      startedMove(),
    );
    const { onOpenChange } = renderDialog();

    expect(
      await screen.findByRole("heading", { name: "Move the server to desk" }),
    ).toBeDefined();
    const warnings = await screen.findByRole("region", {
      name: "Before you move",
    });
    expect(within(warnings).getByText("2 turns are running")).toBeDefined();
    const info = screen.getByRole("region", { name: "Good to know" });
    expect(within(info).getByText("desk uses Europe/Berlin")).toBeDefined();
    expect(
      within(info).getByText("Core plugin schedules shift by 9 hours."),
    ).toBeDefined();
    expect(screen.queryByRole("region", { name: "Fix before moving" })).toBe(
      null,
    );
    expect(screen.queryByLabelText("New server address")).toBeNull();
    expect(vi.mocked(sdk.experimental_server.checkMove)).toHaveBeenCalledTimes(
      1,
    );
    expect(vi.mocked(sdk.experimental_server.checkMove)).toHaveBeenCalledWith({
      targetHostId: TARGET.id,
      serverUrl: null,
    });

    fireEvent.click(startButton());

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(vi.mocked(sdk.experimental_server.startMove)).toHaveBeenCalledWith({
      targetHostId: TARGET.id,
      serverUrl: null,
      stopRunningWork: true,
      archiveExistingTargetServerData: false,
    });
  });

  it("asks for the new address when the server has no bb connect handle and re-checks with it", async () => {
    vi.mocked(sdk.experimental_server.checkMove)
      .mockResolvedValueOnce(
        checkResponse({
          mode: "direct",
          requiresServerUrl: true,
          canMove: false,
          items: [
            {
              id: "server-url",
              severity: "blocker",
              title: "Enter the address machines should use",
              detail: null,
            },
          ],
        }),
      )
      .mockResolvedValue(
        checkResponse({
          mode: "direct",
          requiresServerUrl: true,
          serverUrl: "https://desk.example.com",
        }),
      );
    vi.mocked(sdk.experimental_server.startMove).mockResolvedValue(
      startedMove(),
    );
    renderDialog();

    const address = await screen.findByLabelText("New server address");
    expect(
      await screen.findByRole("region", { name: "Fix before moving" }),
    ).toBeDefined();
    expect(startButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(address, {
      target: { value: "  https://desk.example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check address" }));

    await waitFor(() => {
      expect(
        vi.mocked(sdk.experimental_server.checkMove),
      ).toHaveBeenLastCalledWith({
        targetHostId: TARGET.id,
        serverUrl: "https://desk.example.com",
      });
    });
    await waitFor(() => {
      expect(startButton().hasAttribute("disabled")).toBe(false);
    });
    expect(screen.queryByRole("region", { name: "Fix before moving" })).toBe(
      null,
    );

    fireEvent.change(address, {
      target: { value: "https://other.example.com" },
    });
    expect(startButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(startButton());
    expect(vi.mocked(sdk.experimental_server.startMove)).not.toHaveBeenCalled();

    fireEvent.change(address, {
      target: { value: "https://desk.example.com" },
    });
    fireEvent.click(startButton());

    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.startMove)).toHaveBeenCalledWith(
        {
          targetHostId: TARGET.id,
          serverUrl: "https://desk.example.com",
          stopRunningWork: true,
          archiveExistingTargetServerData: false,
        },
      );
    });
  });

  it("keeps Stop all and move disabled while any blocker remains, even if canMove disagrees", async () => {
    vi.mocked(sdk.experimental_server.checkMove)
      .mockResolvedValueOnce(
        checkResponse({
          canMove: true,
          items: [
            {
              id: "port",
              severity: "blocker",
              title: "Port 38886 is in use on desk",
              detail: "Stop whatever is listening there, then check again.",
            },
            {
              id: "offline-machines",
              severity: "warning",
              title: "1 machine is offline",
              detail: null,
            },
          ],
        }),
      )
      .mockResolvedValue(checkResponse());
    renderDialog();

    const blockers = await screen.findByRole("region", {
      name: "Fix before moving",
    });
    expect(
      within(blockers).getByText("Port 38886 is in use on desk"),
    ).toBeDefined();
    expect(startButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(startButton());
    expect(vi.mocked(sdk.experimental_server.startMove)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => {
      expect(startButton().hasAttribute("disabled")).toBe(false);
    });
    expect(vi.mocked(sdk.experimental_server.checkMove)).toHaveBeenCalledTimes(
      2,
    );
    expect(
      vi.mocked(sdk.experimental_server.checkMove),
    ).toHaveBeenLastCalledWith({ targetHostId: TARGET.id, serverUrl: null });
  });

  it("requires confirming that the existing bb data on the machine gets archived", async () => {
    vi.mocked(sdk.experimental_server.checkMove).mockResolvedValue(
      checkResponse({
        existingTargetServerData: {
          path: "/Users/sawyer/.bb",
          sizeBytes: 5 * 1024 * 1024,
        },
        items: [
          {
            id: "existing-server-data",
            severity: "warning",
            title: "desk already has bb server data",
            detail: null,
          },
        ],
      }),
    );
    vi.mocked(sdk.experimental_server.startMove).mockResolvedValue(
      startedMove(),
    );
    renderDialog();

    const confirmation = await screen.findByRole("checkbox", {
      name: /Archive the existing bb data at \/Users\/sawyer\/\.bb/u,
    });
    expect(screen.getByText(/^5\.0 MB\./u)).toBeDefined();
    expect(startButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(confirmation);
    expect(startButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(startButton());

    await waitFor(() => {
      expect(vi.mocked(sdk.experimental_server.startMove)).toHaveBeenCalledWith(
        {
          targetHostId: TARGET.id,
          serverUrl: null,
          stopRunningWork: true,
          archiveExistingTargetServerData: true,
        },
      );
    });
  });

  it("surfaces a failed check inline and lets the user check again", async () => {
    vi.mocked(sdk.experimental_server.checkMove)
      .mockRejectedValueOnce(
        new BbHttpError({
          status: 500,
          code: "host_rpc_timeout",
          message: "desk did not answer in time",
          body: {
            code: "host_rpc_timeout",
            message: "desk did not answer in time",
          },
        }),
      )
      .mockResolvedValue(checkResponse());
    renderDialog();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "desk did not answer in time",
    );
    expect(startButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => {
      expect(startButton().hasAttribute("disabled")).toBe(false);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText("Nothing needs attention before the move."),
    ).toBeDefined();
  });

  it("shows the blockers the server reports when starting is refused and keeps the dialog open", async () => {
    vi.mocked(sdk.experimental_server.checkMove).mockResolvedValue(
      checkResponse(),
    );
    vi.mocked(sdk.experimental_server.startMove).mockRejectedValue(
      new BbHttpError({
        status: 400,
        code: "server_move_blocked",
        message: "The move is blocked",
        body: {
          code: "server_move_blocked",
          message: "The move is blocked",
          details: {
            items: [
              {
                id: "lifecycle",
                severity: "blocker",
                title: "desk is suspending",
                detail: null,
              },
            ],
          },
        },
      }),
    );
    const { onOpenChange } = renderDialog();

    await waitFor(() => {
      expect(startButton().hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(startButton());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The move is blocked",
    );
    const blockers = screen.getByRole("region", { name: "Fix before moving" });
    expect(within(blockers).getByText("desk is suspending")).toBeDefined();
    expect(startButton().hasAttribute("disabled")).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
