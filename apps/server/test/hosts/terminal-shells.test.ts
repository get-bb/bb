// bb-fork(windows): the host terminal shell list route.
import { describe, expect, it } from "vitest";
import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type TerminalShellListResponse,
} from "@bb/host-daemon-contract";
import type { NotificationHub } from "../../src/ws/hub.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const SHELLS: TerminalShellListResponse = {
  shells: [
    {
      id: "pwsh",
      isDefault: true,
      label: "PowerShell 7",
      path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    },
    {
      id: "git-bash",
      isDefault: false,
      label: "Git Bash",
      path: "C:\\Program Files\\Git\\bin\\bash.exe",
    },
  ],
};

function registerShellsDaemon(args: {
  hub: NotificationHub;
  hostId: string;
  sessionId: string;
  result: TerminalShellListResponse;
}): HostDaemonOnlineRpcRequestMessage[] {
  const requests: HostDaemonOnlineRpcRequestMessage[] = [];
  args.hub.registerDaemon(args.sessionId, args.hostId, {
    close() {},
    send(data) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type !== "host-rpc.request") {
        return;
      }
      requests.push(message);
      args.hub.recordHostOnlineRpcResponse({
        sessionId: args.sessionId,
        message: hostDaemonOnlineRpcResponseMessageSchema.parse({
          type: "host-rpc.response",
          requestId: message.requestId,
          commandType: message.command.type,
          ok: true,
          result: args.result,
        }),
      });
    },
  });
  return requests;
}

describe("host terminal shells route", () => {
  it("returns the shells the daemon reports", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "terminal-shells-host",
      });
      const requests = registerShellsDaemon({
        hub: harness.hub,
        hostId: host.id,
        sessionId: session.id,
        result: SHELLS,
      });
      const response = await harness.app.request(
        `/api/v1/hosts/${host.id}/terminal-shells`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(SHELLS);
      expect(requests.map((request) => request.command.type)).toEqual([
        "host.list_terminal_shells",
      ]);
    });
  });

  it("rejects an unknown host before asking any daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "terminal-shells-known-host",
      });
      const requests = registerShellsDaemon({
        hub: harness.hub,
        hostId: host.id,
        sessionId: session.id,
        result: SHELLS,
      });

      const response = await harness.app.request(
        "/api/v1/hosts/host-missing/terminal-shells",
      );

      expect(response.status).toBe(404);
      expect(requests).toEqual([]);
    });
  });

  it("keeps an empty list meaningful when the host has no choice", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "terminal-shells-empty-host",
      });
      registerShellsDaemon({
        hub: harness.hub,
        hostId: host.id,
        sessionId: session.id,
        result: { shells: [] },
      });

      const response = await harness.app.request(
        `/api/v1/hosts/${host.id}/terminal-shells`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ shells: [] });
    });
  });
});
