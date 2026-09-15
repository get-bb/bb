import { SERVER_MOVE_STEP_IDS } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type { ServerMoveStatus } from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  canMoveServerHere,
  movedServerUrlFromError,
  resolveServerMoveOverlay,
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
  it("keeps a base path and drops duplicate slashes", () => {
    expect(serverMoveDestinationUrl("https://example.com/bb/", LOCATION)).toBe(
      "https://example.com/bb/threads/thr_1?a=1#x",
    );
    expect(serverMoveDestinationUrl("http://10.0.0.5:38886", LOCATION)).toBe(
      "http://10.0.0.5:38886/threads/thr_1?a=1#x",
    );
  });

  it("replaces any query or fragment on the server address with the current ones", () => {
    expect(
      serverMoveDestinationUrl("https://example.com/?stale=1#old", {
        pathname: "/",
        search: "",
        hash: "",
      }),
    ).toBe("https://example.com/");
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

  it.each(["preparing", "switching", "completed"] as const)(
    "refuses while a move is %s",
    (state) => {
      expect(
        canMoveServerHere({
          host: eligible,
          primaryHostId: "host_laptop",
          move: move({ state }),
          serverMoveEnabled: true,
        }),
      ).toBe(false);
    },
  );

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
        location: LOCATION,
      })?.kind,
    ).toBe("arrived");
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
        location: LOCATION,
      }),
    ).toEqual({ kind: "progress", move: next });
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
