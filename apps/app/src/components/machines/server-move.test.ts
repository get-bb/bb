import { SERVER_MOVE_STEP_IDS } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type { ServerMoveStatus } from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  canMoveServerHere,
  movedServerUrlFromError,
  resolveServerMoveOverlay,
  serverMoveDestinationProbeUrl,
  serverMoveDestinationUrl,
  serverMoveOverlayPollIntervalMs,
} from "./server-move";

const LOCATION = { pathname: "/threads/thr_1", search: "?a=1", hash: "#x" };

function move(overrides: Partial<ServerMoveStatus> = {}): ServerMoveStatus {
  return {
    moveId: "move_1",
    state: "preparing",
    mode: "connect",
    targetHostId: "host_desk",
    targetHostName: "desk",
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
    ...overrides,
  };
}

describe("serverMoveDestinationUrl", () => {
  it("keeps a base path, drops duplicate slashes, and carries the move id", () => {
    expect(
      serverMoveDestinationUrl("https://example.com/bb/", LOCATION, "move_1"),
    ).toBe("https://example.com/bb/threads/thr_1?a=1&bbServerMove=move_1#x");
    expect(
      serverMoveDestinationUrl("http://10.0.0.5:38886", LOCATION, "move_1"),
    ).toBe("http://10.0.0.5:38886/threads/thr_1?a=1&bbServerMove=move_1#x");
  });

  it("replaces any query or fragment on the server address with the current ones", () => {
    expect(
      serverMoveDestinationUrl(
        "https://example.com/?stale=1#old",
        { pathname: "/", search: "?bbServerMove=move_0", hash: "" },
        "move_1",
      ),
    ).toBe("https://example.com/?bbServerMove=move_1");
  });
});

describe("canMoveServerHere", () => {
  const eligible = makeHost({ id: "host_desk" });

  it("accepts a connected, active, persistent machine that is not the server", () => {
    expect(
      canMoveServerHere({
        host: eligible,
        primaryHostId: "host_laptop",
        move: null,
        serverMoveEnabled: true,
      }),
    ).toBe(true);
  });

  it("refuses every machine while the serverMove experiment is off", () => {
    expect(
      canMoveServerHere({
        host: eligible,
        primaryHostId: "host_laptop",
        move: null,
        serverMoveEnabled: false,
      }),
    ).toBe(false);
  });

  it.each([
    ["the server machine", { host: eligible, primaryHostId: "host_desk" }],
    [
      "an offline machine",
      {
        host: makeHost({ id: "host_desk", status: "disconnected" }),
        primaryHostId: "host_laptop",
      },
    ],
    [
      "an ephemeral sandbox",
      {
        host: makeHost({ id: "host_desk", type: "ephemeral" }),
        primaryHostId: "host_laptop",
      },
    ],
    [
      "a suspended machine",
      {
        host: makeHost({
          id: "host_desk",
          lifecycle: {
            phase: "suspended",
            suspendedAt: 1,
            message: null,
            pendingLog: "",
            teardown: null,
          },
        }),
        primaryHostId: "host_laptop",
      },
    ],
  ])("refuses %s", (_label, args) => {
    expect(
      canMoveServerHere({ ...args, move: null, serverMoveEnabled: true }),
    ).toBe(false);
  });

  it.each([
    "preparing",
    "switching",
    "recovery_required",
    "completed",
  ] as const)("refuses while a move is %s", (state) => {
    expect(
      canMoveServerHere({
        host: eligible,
        primaryHostId: "host_laptop",
        move: move({ state }),
        serverMoveEnabled: true,
      }),
    ).toBe(false);
  });

  it("allows a new move after the previous one failed", () => {
    expect(
      canMoveServerHere({
        host: eligible,
        primaryHostId: "host_laptop",
        move: move({ state: "failed" }),
        serverMoveEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("movedServerUrlFromError", () => {
  function httpError(status: number, body: unknown): BbHttpError {
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? String(body.code)
        : null;
    return new BbHttpError({ status, code, message: "moved", body });
  }

  it("reads the new address from a server_moved answer", () => {
    expect(
      movedServerUrlFromError(
        httpError(410, {
          code: "server_moved",
          message: "moved",
          details: {
            serverUrl: "https://desk.example.com",
            toHostName: "desk",
            movedAt: 1,
          },
        }),
      ),
    ).toBe("https://desk.example.com");
  });

  it("ignores other gone answers and malformed details", () => {
    expect(
      movedServerUrlFromError(
        httpError(410, { code: "thread_deleted", message: "gone" }),
      ),
    ).toBeNull();
    expect(
      movedServerUrlFromError(
        httpError(410, {
          code: "server_moved",
          message: "moved",
          details: { serverUrl: "" },
        }),
      ),
    ).toBeNull();
    expect(movedServerUrlFromError(new TypeError("Failed to fetch"))).toBe(
      null,
    );
  });
});

describe("resolveServerMoveOverlay", () => {
  it("treats a new server answering with the followed move as arrived, not abandoned", () => {
    const followed = move({ state: "switching", cancellable: false });
    expect(
      resolveServerMoveOverlay({
        response: {
          move: null,
          lastMove: {
            moveId: "move_1",
            fromHostId: "host_laptop",
            fromHostName: "laptop",
            toHostId: "host_desk",
            toHostName: "desk",
            completedAt: 2,
            oldCopyDeletedAt: null,
          },
        },
        error: null,
        followed,
        dismissedMoveId: null,
        destination: null,
        arrivalMoveId: null,
        location: LOCATION,
      })?.kind,
    ).toBe("arrived");
  });

  it("announces an arrival on the new origin from the move id in the address", () => {
    const lastMove = {
      moveId: "move_1",
      fromHostId: "host_laptop",
      fromHostName: "laptop",
      toHostId: "host_desk",
      toHostName: "desk",
      completedAt: 2,
      oldCopyDeletedAt: null,
    };
    const args = {
      response: { move: null, lastMove },
      error: null,
      followed: null,
      dismissedMoveId: null,
      destination: null,
      location: LOCATION,
    };
    expect(
      resolveServerMoveOverlay({ ...args, arrivalMoveId: "move_1" }),
    ).toEqual({ kind: "arrived", lastMove });
    expect(
      resolveServerMoveOverlay({ ...args, arrivalMoveId: "move_0" }),
    ).toBeNull();
    expect(
      resolveServerMoveOverlay({ ...args, arrivalMoveId: null }),
    ).toBeNull();
  });

  it("waits for a direct move's destination to report ready before redirecting once the old server stops answering", () => {
    const switching = move({
      state: "switching",
      mode: "direct",
      serverUrl: "https://desk.example.com",
      destinationStatusUrl: "https://desk.example.com/health",
      cancellable: false,
    });
    const args = {
      response: { move: switching, lastMove: null },
      error: new TypeError("Failed to fetch"),
      followed: switching,
      dismissedMoveId: null,
      arrivalMoveId: null,
      location: LOCATION,
    };

    expect(resolveServerMoveOverlay({ ...args, destination: null })).toEqual({
      kind: "waiting",
      move: switching,
      destinationState: null,
    });
    expect(
      resolveServerMoveOverlay({
        ...args,
        destination: { moveId: "move_1", state: "activating" },
      }),
    ).toEqual({
      kind: "waiting",
      move: switching,
      destinationState: "activating",
    });
    expect(
      resolveServerMoveOverlay({
        ...args,
        destination: { moveId: "move_0", state: "ready" },
      })?.kind,
    ).toBe("waiting");
    expect(
      resolveServerMoveOverlay({
        ...args,
        destination: { moveId: "move_1", state: "ready" },
      }),
    ).toEqual({
      kind: "redirecting",
      move: switching,
      destination:
        "https://desk.example.com/threads/thr_1?a=1&bbServerMove=move_1#x",
    });
    expect(
      resolveServerMoveOverlay({ ...args, error: null, destination: null })
        ?.kind,
    ).toBe("progress");
    expect(
      serverMoveOverlayPollIntervalMs({
        content: { kind: "waiting", move: switching, destinationState: null },
        realtimeConnected: false,
        intervalMs: 500,
      }),
    ).toBe(500);
    expect(
      serverMoveDestinationProbeUrl({ move: switching, error: args.error }),
    ).toBe("https://desk.example.com/health");
    expect(
      serverMoveDestinationProbeUrl({ move: switching, error: null }),
    ).toBe(null);
    expect(
      serverMoveDestinationProbeUrl({
        move: { ...switching, state: "completed" },
        error: null,
      }),
    ).toBe("https://desk.example.com/health");
    expect(
      serverMoveDestinationProbeUrl({
        move: { ...switching, destinationStatusUrl: null, state: "completed" },
        error: args.error,
      }),
    ).toBeNull();
  });

  it("follows a new move even after an earlier failure was dismissed", () => {
    const dismissed = move({ moveId: "move_0", state: "failed" });
    const next = move({ moveId: "move_2" });
    expect(
      resolveServerMoveOverlay({
        response: { move: next, lastMove: null },
        error: null,
        followed: dismissed,
        dismissedMoveId: "move_0",
        destination: null,
        arrivalMoveId: null,
        location: LOCATION,
      }),
    ).toEqual({ kind: "progress", move: next });
  });

  it("shows the recovery arm for a move that needs recovery, polling only without realtime", () => {
    const recovering = move({
      state: "recovery_required",
      error: { step: "switch", message: "desk disconnected before confirming" },
    });
    const content = resolveServerMoveOverlay({
      response: { move: recovering, lastMove: null },
      error: null,
      followed: null,
      dismissedMoveId: null,
      destination: null,
      arrivalMoveId: null,
      location: LOCATION,
    });
    expect(content).toEqual({ kind: "recovery", move: recovering });
    expect(
      serverMoveOverlayPollIntervalMs({
        content,
        realtimeConnected: true,
        intervalMs: 500,
      }),
    ).toBeNull();
    expect(
      serverMoveOverlayPollIntervalMs({
        content,
        realtimeConnected: false,
        intervalMs: 500,
      }),
    ).toBe(500);
  });

  it("polls while switching or reconnecting, and while preparing only without realtime", () => {
    const progress = { kind: "progress" as const, move: move() };
    expect(
      serverMoveOverlayPollIntervalMs({
        content: progress,
        realtimeConnected: true,
        intervalMs: 500,
      }),
    ).toBeNull();
    expect(
      serverMoveOverlayPollIntervalMs({
        content: progress,
        realtimeConnected: false,
        intervalMs: 500,
      }),
    ).toBe(500);
    expect(
      serverMoveOverlayPollIntervalMs({
        content: {
          kind: "progress",
          move: move({ state: "switching", cancellable: false }),
        },
        realtimeConnected: true,
        intervalMs: 500,
      }),
    ).toBe(500);
    expect(
      serverMoveOverlayPollIntervalMs({
        content: { kind: "reconnecting", move: move({ state: "completed" }) },
        realtimeConnected: true,
        intervalMs: 500,
      }),
    ).toBe(500);
  });
});
