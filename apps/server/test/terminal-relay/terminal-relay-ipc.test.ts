import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  mainToTerminalRelayMessageSchema,
  terminalRelayToMainMessageSchema,
} from "../../src/terminal-relay/terminal-relay-ipc.js";

const session = {
  id: "terminal-1",
  threadId: null,
  environmentId: null,
  hostId: "host-1",
  title: "Shell",
  initialCwd: "/tmp",
  cols: 80,
  rows: 24,
  status: "running",
  exitCode: null,
  closeReason: null,
  createdAt: 0,
  updatedAt: 0,
  lastUserInputAt: null,
};

describe("terminal relay IPC boundary", () => {
  it("preserves socket grants, attach decisions, and terminal snapshots across JSON IPC", () => {
    const messages = [
      {
        type: "accept-browser",
        grant: {
          kind: "browser",
          terminalId: session.id,
          sinceSeq: 3,
          outputAcks: true,
        },
        head: "AQID",
        headers: { origin: "http://localhost" },
        method: "GET",
        url: "/ws/terminals/terminal-1?sinceSeq=3",
      },
      {
        type: "attach-decision",
        socketId: "socket-1",
        decision: "running",
        session,
      },
      {
        type: "terminal-state",
        terminalId: session.id,
        state: {
          daemonSessionId: "daemon-1",
          hostId: session.hostId,
          session,
          status: "running",
        },
      },
      {
        type: "send-daemon-data",
        daemonSessionId: "daemon-1",
        message: {
          type: "terminal.input",
          terminalId: session.id,
          dataBase64: "YQ==",
        },
      },
    ];
    for (const message of messages) {
      expect(
        mainToTerminalRelayMessageSchema.parse(
          JSON.parse(JSON.stringify(message)),
        ),
      ).toEqual(message);
    }
    const reply = {
      type: "replay",
      daemonSessionId: "daemon-1",
      terminalId: session.id,
      requestId: "request-1",
      chunks: [{ seq: 3, dataBase64: "YQ==" }],
      replayStartSeq: 3,
      nextSeq: 4,
    };
    expect(
      terminalRelayToMainMessageSchema.parse(JSON.parse(JSON.stringify(reply))),
    ).toEqual(reply);
  });

  it("rejects unknown message types and fields at both process boundaries", () => {
    expect(
      mainToTerminalRelayMessageSchema.safeParse({
        type: "send-daemon-data",
        daemonSessionId: "daemon-1",
        message: { type: "terminal.close", terminalId: session.id },
      }).success,
    ).toBe(false);
    expect(
      mainToTerminalRelayMessageSchema.safeParse({
        type: "shutdown",
        surprise: true,
      }).success,
    ).toBe(false);
    expect(
      terminalRelayToMainMessageSchema.safeParse({
        type: "ready",
        pid: 1,
        token: "secret",
      }).success,
    ).toBe(false);
    expect(
      terminalRelayToMainMessageSchema.safeParse({ type: "terminal.output" })
        .success,
    ).toBe(false);
  });

  it("keeps database, ORM, and the Hono app out of the relay entry graph", async () => {
    const graph = await build({
      entryPoints: [
        fileURLToPath(
          new URL(
            "../../src/terminal-relay/terminal-relay-main.ts",
            import.meta.url,
          ),
        ),
      ],
      bundle: true,
      platform: "node",
      packages: "external",
      write: false,
      metafile: true,
    });
    const imports = Object.values(graph.metafile.inputs).flatMap((input) =>
      input.imports.map((dependency) => dependency.path),
    );
    expect(
      imports.filter(
        (path) =>
          path === "@bb/db" ||
          path.startsWith("@bb/db/") ||
          path === "drizzle-orm" ||
          path.startsWith("drizzle-orm/"),
      ),
    ).toEqual([]);
    expect(
      Object.keys(graph.metafile.inputs).filter(
        (path) =>
          path.endsWith("/src/server.ts") ||
          path.endsWith("/src/start-server.ts") ||
          path.includes("/packages/db/"),
      ),
    ).toEqual([]);
  });
});
