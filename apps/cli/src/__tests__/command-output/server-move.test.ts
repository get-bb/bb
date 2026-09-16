import { describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import type {
  ServerMoveCheckResponse,
  ServerMoveStatus,
  ServerMoveStatusResponse,
  ServerMoveStep,
} from "@bb/server-contract";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";

const sleepMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("node:timers/promises", () => ({ setTimeout: sleepMock }));

const desktop: Host = {
  id: "host-desktop",
  name: "desktop",
  type: "persistent",
  status: "connected",
  machineProviderId: "manual",
  lifecycle: {
    phase: "active",
    suspendedAt: null,
    message: null,
    pendingLog: "",
    teardown: null,
  },
  maxPermissionMode: "full",
  lastSeenAt: 1_700_000_000_000,
  lastRejectedProtocolVersion: null,
  createdAt: 1,
  updatedAt: 2,
};

function check(
  overrides: Partial<ServerMoveCheckResponse> = {},
): ServerMoveCheckResponse {
  return {
    targetHostId: desktop.id,
    targetHostName: desktop.name,
    mode: "connect",
    serverUrl: null,
    requiresServerUrl: false,
    targetDataDir: "/home/me/.bb-machines/laptop",
    existingTargetServerData: null,
    items: [
      {
        id: "running-turns",
        severity: "warning",
        title: "2 turns are running",
        detail: "They stop when the move starts.",
      },
      {
        id: "timezone",
        severity: "info",
        title: "desktop uses a different timezone",
        detail: null,
      },
    ],
    canMove: true,
    ...overrides,
  };
}

type StepStatuses = Partial<Record<ServerMoveStep["id"], ServerMoveStep>>;

function moveStatus(
  state: ServerMoveStatus["state"],
  steps: StepStatuses = {},
  overrides: Partial<ServerMoveStatus> = {},
): ServerMoveStatus {
  const ids: ServerMoveStep["id"][] = [
    "stop-work",
    "update-target",
    "export",
    "transfer",
    "start-target",
    "verify-address",
    "switch",
  ];
  return {
    moveId: "move-1",
    state,
    mode: "connect",
    targetHostId: desktop.id,
    targetHostName: desktop.name,
    serverUrl: "https://me.getbb.app",
    destinationStatusUrl: null,
    startedAt: 1_700_000_000_000,
    finishedAt: null,
    error: null,
    steps: ids.map(
      (id) => steps[id] ?? { id, status: "pending", message: null },
    ),
    cancellable: state === "preparing",
    ...overrides,
  };
}

function step(
  id: ServerMoveStep["id"],
  status: ServerMoveStep["status"],
  message: string | null = null,
): ServerMoveStep {
  return { id, status, message };
}

function recovering(): ServerMoveStatus {
  return moveStatus(
    "recovery_required",
    {
      "stop-work": step("stop-work", "done"),
      "update-target": step("update-target", "skipped"),
      export: step("export", "done"),
      transfer: step("transfer", "done"),
      "start-target": step("start-target", "done"),
      "verify-address": step("verify-address", "skipped"),
      switch: step(
        "switch",
        "running",
        "Waiting for desktop to confirm it took over",
      ),
    },
    {
      cancellable: true,
      error: {
        step: "switch",
        message: "desktop disconnected before confirming",
      },
    },
  );
}

const RECOVERY_GUIDANCE = [
  "bb couldn't confirm that desktop took over (desktop disconnected before confirming).",
  "This server stays up but read-only, and bb finishes the move on its own as soon as desktop answers.",
  "If desktop isn't running the server, run bb server move cancel --yes to abandon the move and keep the server here.",
  "If this server stops, run bb server unlock on this computer.",
];

function statusResponse(
  move: ServerMoveStatus | null,
  lastMove: ServerMoveStatusResponse["lastMove"] = null,
): ServerMoveStatusResponse {
  return { move, lastMove };
}

function errorResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bb server move", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerServerCommands(
      program.enablePositionalOptions(),
      () => "http://server",
    );

  it("--check prints the checklist grouped by severity and exits 0 when the move can go ahead", async () => {
    const checkMove = vi.fn(async () => check());
    const startMove = vi.fn();
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": checkMove,
      "v1.server.move.$post": startMove,
    });

    await runCommand(
      ["server", "move", "--to", "desktop", "--check"],
      register,
    );

    expect(checkMove).toHaveBeenCalledWith({
      json: { targetHostId: desktop.id, serverUrl: null },
    });
    expect(startMove).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Moving the bb server to desktop (bb connect)",
      "Target data directory: /home/me/.bb-machines/laptop",
      "",
      "Warnings",
      "  - 2 turns are running",
      "    They stop when the move starts.",
      "",
      "Notes",
      "  - desktop uses a different timezone",
      "",
      "The server can move to desktop.",
    ]);
  });

  it("--check exits nonzero when a blocker prevents the move", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () =>
        check({
          canMove: false,
          items: [
            {
              id: "offline",
              severity: "blocker",
              title: "desktop is offline",
              detail: null,
            },
          ],
        }),
      ),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--check"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toContain(
      "  - desktop is offline",
    );
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The server can't move to desktop yet. Resolve the blockers above and try again.",
    ]);
  });

  it("--check --json prints the check response and keeps the blocked exit code", async () => {
    const response = check({ canMove: false });
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => response),
    });

    await expect(
      runCommand(
        ["server", "move", "--to", "desktop", "--check", "--json"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!)).toEqual(response);
  });

  it("asks for --address when a direct-address server has none, without starting", async () => {
    const startMove = vi.fn();
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () =>
        check({ mode: "direct", requiresServerUrl: true, canMove: false }),
      ),
      "v1.server.move.$post": startMove,
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(startMove).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: This bb server uses a direct address, so the new server needs one too. Re-run with --address <url>: the URL every machine and app will use to reach bb on desktop, such as a Tailscale Serve URL.",
    ]);
  });

  it("refuses to replace existing server data on the target without --archive-existing-data", async () => {
    const startMove = vi.fn();
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () =>
        check({
          existingTargetServerData: {
            path: "/home/me/.bb",
            sizeBytes: 5 * 1024 * 1024,
          },
        }),
      ),
      "v1.server.move.$post": startMove,
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(startMove).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: desktop already has bb server data at /home/me/.bb (5.0 MB). Re-run with --archive-existing-data to move it aside to a .before-move-<date> directory; it is never merged.",
    ]);
  });

  it("starts with the archive flag and address, follows step changes, and reports the new server", async () => {
    const direct = {
      mode: "direct" as const,
      serverUrl: "https://desk.ts.net",
    };
    const startMove = vi.fn(async () =>
      moveStatus(
        "preparing",
        { "stop-work": step("stop-work", "running") },
        direct,
      ),
    );
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(
        statusResponse(
          moveStatus(
            "preparing",
            {
              "stop-work": step("stop-work", "done"),
              "update-target": step("update-target", "skipped"),
              export: step("export", "done"),
              transfer: step("transfer", "running", "Sent 212 MB of 480 MB"),
            },
            direct,
          ),
        ),
      )
      .mockResolvedValueOnce(
        statusResponse(
          moveStatus(
            "preparing",
            {
              "stop-work": step("stop-work", "done"),
              "update-target": step("update-target", "skipped"),
              export: step("export", "done"),
              transfer: step("transfer", "running", "Sent 212 MB of 480 MB"),
            },
            direct,
          ),
        ),
      )
      .mockResolvedValueOnce(
        statusResponse(
          moveStatus(
            "completed",
            {
              "stop-work": step("stop-work", "done"),
              "update-target": step("update-target", "skipped"),
              export: step("export", "done"),
              transfer: step("transfer", "done"),
              "start-target": step("start-target", "done"),
              "verify-address": step("verify-address", "done"),
              switch: step("switch", "done"),
            },
            { ...direct, finishedAt: 1_700_000_100_000 },
          ),
        ),
      );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () =>
        check({
          mode: "direct",
          requiresServerUrl: true,
          serverUrl: direct.serverUrl,
          existingTargetServerData: { path: "/home/me/.bb", sizeBytes: 10 },
        }),
      ),
      "v1.server.move.$post": startMove,
      "v1.server.move.$get": getStatus,
    });
    readlineMocks.question.mockResolvedValue("y");

    await runCommand(
      [
        "server",
        "move",
        "--to",
        "desktop",
        "--address",
        " https://desk.ts.net ",
        "--archive-existing-data",
      ],
      register,
    );

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Stop all running work and move the bb server to desktop? [y/N] ",
    );
    expect(startMove).toHaveBeenCalledWith({
      json: {
        targetHostId: desktop.id,
        serverUrl: "https://desk.ts.net",
        stopRunningWork: true,
        archiveExistingTargetServerData: true,
      },
    });
    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledWith(1_000, undefined, {
      signal: expect.any(AbortSignal),
    });
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "[running] Stop running work",
      "[done] Stop running work",
      "[skipped] Update bb on desktop",
      "[done] Export server data",
      "[running] Send data to desktop: Sent 212 MB of 480 MB",
      "[done] Send data to desktop",
      "[done] Start the new server",
      "[done] Check that machines can reach the new address",
      "[done] Switch machines over",
    ]);
    expect(collectLogPayloads(vi.mocked(console.log)).at(-1)).toBe(
      "The server moved to desktop: https://desk.ts.net",
    );
  });

  it("does not start when the confirmation is declined", async () => {
    const startMove = vi.fn();
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": startMove,
    });
    readlineMocks.question.mockResolvedValue("n");

    await runCommand(["server", "move", "--to", "desktop"], register);

    expect(startMove).not.toHaveBeenCalled();
  });

  it("refuses to start without --yes outside an interactive terminal", async () => {
    const startMove = vi.fn();
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": startMove,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop"], register),
    ).rejects.toThrow("process.exit:1");

    expect(startMove).not.toHaveBeenCalled();
    expect(readlineMocks.question).not.toHaveBeenCalled();
  });

  it("treats the server going away during the switch as a completed move", async () => {
    const switching = moveStatus("switching", {
      "stop-work": step("stop-work", "done"),
      switch: step("switch", "running"),
    });
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(switching))
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        }),
      );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": getStatus,
    });

    await runCommand(
      ["server", "move", "--to", "desktop", "--yes", "--json"],
      register,
    );

    expect(getStatus).toHaveBeenCalledTimes(2);
    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!)).toEqual(switching);
  });

  it("recognizes the new server answering at the same connect URL with the finished move", async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValueOnce(
        statusResponse(
          moveStatus("switching", { switch: step("switch", "running") }),
        ),
      )
      .mockResolvedValueOnce(
        statusResponse(null, {
          moveId: "move-1",
          fromHostId: "host-laptop",
          fromHostName: "laptop",
          toHostId: desktop.id,
          toHostName: desktop.name,
          completedAt: 1_700_000_100_000,
          oldCopyDeletedAt: null,
        }),
      );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": getStatus,
    });

    await runCommand(["server", "move", "--to", "desktop", "--yes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).at(-1)).toBe(
      "The server moved to desktop: https://me.getbb.app",
    );
  });

  it("follows the moved responder's 410 as a completed move", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": vi.fn(async () =>
        errorResponse(410, {
          code: "server_moved",
          message: "This bb server moved to desktop",
          details: {
            serverUrl: "https://me.getbb.app",
            toHostName: "desktop",
            movedAt: 1_700_000_100_000,
          },
        }),
      ),
    });

    await runCommand(["server", "move", "--to", "desktop", "--yes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).at(-1)).toBe(
      "The server moved to desktop: https://me.getbb.app",
    );
  });

  it("exits nonzero with the failing step when the move fails", async () => {
    const failed = moveStatus(
      "failed",
      {
        "stop-work": step("stop-work", "done"),
        transfer: step("transfer", "failed", "Download digest mismatch"),
      },
      {
        error: { step: "transfer", message: "Download digest mismatch" },
        finishedAt: 1_700_000_100_000,
      },
    );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": vi.fn(async () => statusResponse(failed)),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      'Error: The server move failed at "Send data to desktop": Download digest mismatch',
    );
    expect(collectLogPayloads(vi.mocked(console.log))).not.toContain(
      "The server moved to desktop: https://me.getbb.app",
    );
  });

  it("exits nonzero when the move is cancelled elsewhere", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": vi.fn(async () =>
        statusResponse(
          moveStatus(
            "cancelled",
            {},
            { error: { step: "export", message: "The move was cancelled" } },
          ),
        ),
      ),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: The server move was cancelled.",
    );
  });

  it("exits 2 with the recovery exits when the switch is not confirmed", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": vi.fn(async () => statusResponse(recovering())),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:2");

    expect(collectLogPayloads(vi.mocked(console.log)).slice(-4)).toEqual(
      RECOVERY_GUIDANCE,
    );
    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: The move to desktop wasn't confirmed and needs recovery.",
    );
  });

  it("fails when the server forgets the move before the switch", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": vi.fn(async () => statusResponse(null)),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: The bb server no longer reports this move. A server restart before the switch abandons the move and keeps the server where it was.",
    );
  });

  it("retries transient status failures before the switch, then gives up", async () => {
    const getStatus = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () => moveStatus("preparing")),
      "v1.server.move.$get": getStatus,
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(getStatus).toHaveBeenCalledTimes(5);
    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: Lost contact with the bb server before the switch (socket hang up). Run bb server move status once it answers again.",
    );
  });

  it("prints the blockers the server returns when the start is refused", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [desktop]),
      "v1.server.move.check.$post": vi.fn(async () => check()),
      "v1.server.move.$post": vi.fn(async () =>
        errorResponse(400, {
          code: "server_move_blocked",
          message: "desktop went offline",
          details: {
            items: [
              {
                id: "offline",
                severity: "blocker",
                title: "desktop went offline",
                detail: null,
              },
            ],
          },
        }),
      ),
    });

    await expect(
      runCommand(["server", "move", "--to", "desktop", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toContain(
      "  - desktop went offline",
    );
  });

  it.each([[[] as string[]], [["--check"]], [["--json"]]])(
    "prints the server's experiment message and exits nonzero while server move is off (%j)",
    async (extraArgs) => {
      const startMove = vi.fn();
      stubServerApi({
        "v1.hosts.$get": vi.fn(async () => [desktop]),
        "v1.server.move.check.$post": vi.fn(async () =>
          errorResponse(403, {
            code: "server_move_experiment_disabled",
            message:
              'Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.',
          }),
        ),
        "v1.server.move.$post": startMove,
      });

      await expect(
        runCommand(
          ["server", "move", "--to", "desktop", "--yes", ...extraArgs],
          register,
        ),
      ).rejects.toThrow("process.exit:1");

      expect(startMove).not.toHaveBeenCalled();
      expect(collectLogPayloads(vi.mocked(console.log))).toEqual([]);
      expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
        'Error: Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.',
      ]);
    },
  );

  it("requires --to", async () => {
    const checkMove = vi.fn();
    stubServerApi({ "v1.server.move.check.$post": checkMove });

    await expect(runCommand(["server", "move"], register)).rejects.toThrow(
      "process.exit:1",
    );

    expect(checkMove).not.toHaveBeenCalled();
  });
});

describe("bb server move status and cancel", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerServerCommands(
      program.enablePositionalOptions(),
      () => "http://server",
    );

  it("status prints every step of the move in progress", async () => {
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () =>
        statusResponse(
          moveStatus("preparing", {
            "stop-work": step("stop-work", "done"),
            export: step("export", "running", "Snapshotting bb.db"),
          }),
        ),
      ),
    });

    await runCommand(["server", "move", "status"], register);

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads[0]).toBe("Moving the bb server to desktop (preparing)");
    expect(payloads).toContain("  done     Stop running work");
    expect(payloads).toContain(
      "  running  Export server data: Snapshotting bb.db",
    );
    expect(payloads).toContain("  pending  Switch machines over");
    expect(payloads.at(-1)).toBe("Cancel it with bb server move cancel.");
  });

  it("status --json passes the subcommand's own flag through to JSON output", async () => {
    const response = statusResponse(null);
    stubServerApi({ "v1.server.move.$get": vi.fn(async () => response) });

    await runCommand(["server", "move", "status", "--json"], register);

    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual(
      response,
    );
  });

  it("status reports the last completed move when none is in progress", async () => {
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () =>
        statusResponse(null, {
          moveId: "move-1",
          fromHostId: "host-laptop",
          fromHostName: "laptop",
          toHostId: desktop.id,
          toHostName: desktop.name,
          completedAt: 1_700_000_100_000,
          oldCopyDeletedAt: null,
        }),
      ),
    });

    await runCommand(["server", "move", "status"], register);

    expect(collectLogPayloads(vi.mocked(console.log))[0]).toMatch(
      /^No server move in progress\. The server last moved from laptop to desktop on /u,
    );
  });

  it("status explains a move that needs recovery and exits 2", async () => {
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () => statusResponse(recovering())),
    });

    await expect(
      runCommand(["server", "move", "status"], register),
    ).rejects.toThrow("process.exit:2");

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads[0]).toBe(
      "Moving the bb server to desktop (recovery required)",
    );
    expect(payloads).toContain(
      "  running  Switch machines over: Waiting for desktop to confirm it took over",
    );
    expect(payloads.slice(-4)).toEqual(RECOVERY_GUIDANCE);
    expect(payloads).not.toContain("Cancel it with bb server move cancel.");
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The move to desktop wasn't confirmed and needs recovery.",
    ]);
  });

  it("status --json prints the move that needs recovery and still exits 2", async () => {
    const response = statusResponse(recovering());
    stubServerApi({ "v1.server.move.$get": vi.fn(async () => response) });

    await expect(
      runCommand(["server", "move", "status", "--json"], register),
    ).rejects.toThrow("process.exit:2");

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0]!)).toEqual(response);
  });

  it("cancel reports the cancelled move", async () => {
    const cancel = vi.fn(async () =>
      moveStatus(
        "cancelled",
        {},
        { error: { step: "export", message: "The move was cancelled" } },
      ),
    );
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () =>
        statusResponse(moveStatus("preparing")),
      ),
      "v1.server.move.cancel.$post": cancel,
    });

    await runCommand(["server", "move", "cancel"], register);

    expect(cancel).toHaveBeenCalledOnce();
    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Cancelled the server move to desktop. The server stays where it is.",
    ]);
  });

  it("cancel warns and asks before abandoning a move that needs recovery", async () => {
    const cancel = vi.fn();
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () => statusResponse(recovering())),
      "v1.server.move.cancel.$post": cancel,
    });
    readlineMocks.question.mockResolvedValue("n");

    await runCommand(["server", "move", "cancel"], register);

    expect(cancel).not.toHaveBeenCalled();
    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Abandon the server move to desktop? [y/N] ",
    );
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "The move to desktop wasn't confirmed. Abandoning rolls back the switch and keeps the server on this computer.",
      "If desktop already took over, two servers will run with the same data and bb connect credential. Stop the server on desktop first.",
    ]);
  });

  it("cancel --yes abandons a move that needs recovery", async () => {
    const cancel = vi.fn(async () =>
      moveStatus(
        "cancelled",
        {},
        {
          error: {
            step: "switch",
            message:
              "The move was abandoned before desktop confirmed it took over",
          },
        },
      ),
    );
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () => statusResponse(recovering())),
      "v1.server.move.cancel.$post": cancel,
    });

    await runCommand(["server", "move", "cancel", "--yes"], register);

    expect(cancel).toHaveBeenCalledOnce();
    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Abandoned the server move to desktop. The server stays on this computer.",
    ]);
  });

  it("cancel surfaces the server's refusal after the switch starts", async () => {
    stubServerApi({
      "v1.server.move.$get": vi.fn(async () =>
        statusResponse(moveStatus("switching")),
      ),
      "v1.server.move.cancel.$post": vi.fn(async () =>
        errorResponse(409, {
          code: "server_move_not_cancellable",
          message: "The move can't be cancelled after the switch starts",
        }),
      ),
    });

    await expect(
      runCommand(["server", "move", "cancel", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: HTTP 409: The move can't be cancelled after the switch starts",
    ]);
  });
});
