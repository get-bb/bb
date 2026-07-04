import { getTerminalSession } from "@bb/db";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import { projectRunCommandStateResponseSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface FakeDaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  sentMessages: string[];
}

type TerminalOpenMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>;

function createFakeDaemonSocket(): FakeDaemonSocket {
  const sentMessages: string[] = [];
  return {
    close: vi.fn(),
    send: vi.fn((data: string) => {
      sentMessages.push(data);
    }),
    sentMessages,
  };
}

async function waitForDaemonMessage(
  socket: FakeDaemonSocket,
  messageIndex: number,
): Promise<HostDaemonServerWsMessage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = socket.sentMessages[messageIndex];
    if (message !== undefined) {
      return hostDaemonServerWsMessageSchema.parse(JSON.parse(message));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for daemon message");
}

describe("public project run command routes", () => {
  it("starts a configured project run command once and can stop it", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "project-run-command-host",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-run-command",
      });
      const socket = createFakeDaemonSocket();
      harness.hub.registerDaemon(session.id, host.id, socket);

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runCommand: "  pnpm dev  " }),
        },
      );
      expect(updateResponse.status).toBe(200);
      await expect(readJson(updateResponse)).resolves.toMatchObject({
        runCommand: "pnpm dev",
      });

      const startResponsePromise = Promise.resolve(
        harness.app.request(
          `/api/v1/projects/${project.id}/run-command/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target: { kind: "project" } }),
          },
        ),
      );
      const openMessage = await waitForDaemonMessage(socket, 0);
      if (openMessage.type !== "terminal.open") {
        throw new Error(`Expected terminal.open, received ${openMessage.type}`);
      }
      expect(openMessage).toMatchObject({
        cols: 100,
        rows: 30,
        start: { mode: "command", command: "pnpm dev" },
        target: {
          kind: "host_path",
          cwd: "/tmp/project-run-command",
        },
      });
      expect(openMessage).not.toHaveProperty("threadId");
      expect(
        getTerminalSession(harness.db, {
          terminalId: openMessage.terminalId,
        }),
      ).toMatchObject({
        purpose: "project_run_command",
        runCommandProjectId: project.id,
        status: "starting",
        threadId: null,
      });

      acknowledgeTerminalOpen(harness, {
        hostId: host.id,
        sessionId: session.id,
        openMessage,
      });

      const startResponse = await startResponsePromise;
      expect(startResponse.status).toBe(200);
      expect(
        projectRunCommandStateResponseSchema.parse(
          await readJson(startResponse),
        ),
      ).toEqual({
        states: [
          {
            target: { kind: "project" },
            status: "running",
            terminalSessionId: openMessage.terminalId,
            terminalTarget: {
              kind: "host_path",
              hostId: host.id,
              cwd: "/tmp/project-run-command",
            },
            updatedAt: expect.any(Number),
          },
        ],
      });

      const secondStartResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/run-command/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: { kind: "project" } }),
        },
      );
      expect(secondStartResponse.status).toBe(200);
      expect(socket.sentMessages).toHaveLength(1);

      const stopResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/run-command/stop`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: { kind: "project" } }),
        },
      );
      expect(stopResponse.status).toBe(200);
      expect(
        projectRunCommandStateResponseSchema.parse(
          await readJson(stopResponse),
        ),
      ).toEqual({ states: [] });
      const closeMessage = await waitForDaemonMessage(socket, 1);
      expect(closeMessage).toMatchObject({
        type: "terminal.close",
        terminalId: openMessage.terminalId,
        reason: "user",
      });
    });
  });

  it("passes worktree port env to environment run commands", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "project-run-command-env-host",
      });
      seedPrimaryHost(harness.deps, host.id);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-run-command-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-run-command-env",
        managed: true,
        workspaceProvisionType: "managed-worktree",
        worktreePortBase: 43300,
      });
      const socket = createFakeDaemonSocket();
      harness.hub.registerDaemon(session.id, host.id, socket);

      const updateResponse = await harness.app.request(
        `/api/v1/projects/${project.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runCommand: "pnpm dev --port $BB_PORT" }),
        },
      );
      expect(updateResponse.status).toBe(200);

      const startResponsePromise = Promise.resolve(
        harness.app.request(
          `/api/v1/projects/${project.id}/run-command/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              target: { kind: "environment", environmentId: environment.id },
            }),
          },
        ),
      );
      const openMessage = await waitForDaemonMessage(socket, 0);
      if (openMessage.type !== "terminal.open") {
        throw new Error(`Expected terminal.open, received ${openMessage.type}`);
      }
      expect(openMessage).toMatchObject({
        env: {
          BB_PORT: "43300",
          BB_PORT_1: "43301",
          BB_PORT_9: "43309",
        },
        start: { mode: "command", command: "pnpm dev --port $BB_PORT" },
        target: {
          kind: "workspace",
          environmentId: environment.id,
        },
      });

      acknowledgeTerminalOpen(harness, {
        hostId: host.id,
        sessionId: session.id,
        openMessage,
      });
      const startResponse = await startResponsePromise;
      expect(startResponse.status).toBe(200);
    });
  });
});

function acknowledgeTerminalOpen(
  harness: TestAppHarness,
  args: {
    hostId: string;
    sessionId: string;
    openMessage: TerminalOpenMessage;
  },
): void {
  harness.deps.terminalSessions.handleDaemonTerminalMessage({
    hostId: args.hostId,
    sessionId: args.sessionId,
    message: {
      type: "terminal.opened",
      requestId: args.openMessage.requestId,
      terminalId: args.openMessage.terminalId,
      shell: "/bin/zsh",
      title: "pnpm dev",
      initialCwd: "/tmp/project-run-command",
      cols: 100,
      rows: 30,
    },
  });
}
