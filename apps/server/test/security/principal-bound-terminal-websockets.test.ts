/**
 * Real WebSocket transport integration for principal-bound terminal sockets.
 */
import {
  createEnvironment,
  createProject,
  createTerminalSession,
  createThread,
  ensurePersonalProject,
  upsertHost,
} from "@bb/db";
import type {
  PolicyAction,
  PolicyDecision,
  PolicyResource,
  Principal,
} from "@bb/domain";
import {
  WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER,
  WORK_TOGETHER_PRINCIPAL_JWT_ALG,
  WORK_TOGETHER_PRINCIPAL_JWT_TYP,
} from "@bb/server-contract";
import { CompactSign, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type ClientOptions } from "ws";
import { isRegistryIssuedTerminalWebsocketAuthorization } from "../../src/auth/terminal-websocket-authorization.js";
import { createWorkTogetherMembershipMemoryFake } from "../../src/auth/work-together-membership-memory.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createWorkTogetherPrincipalPolicy } from "../../src/auth/work-together-principal-policy.js";
import { TERMINAL_SOCKET_POLICY_CLOSE_REASON } from "../../src/ws/terminal-protocol.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "scoped-terminal-user",
  kind: "human",
  displayName: "Scoped Terminal User",
});

type MutablePolicyState = {
  allowAuthorize: boolean;
  expiresAtMs: number;
};

function createMutableScopedPolicy(state: MutablePolicyState): PrincipalPolicy {
  return {
    async resolve() {
      return {
        principal: PRINCIPAL,
        expiresAtMs: state.expiresAtMs,
        clientRealtimeScope: "scoped",
        async authorize(
          action: PolicyAction,
          resource: PolicyResource,
        ): Promise<PolicyDecision> {
          if (!state.allowAuthorize) {
            return { allowed: false, reason: "unauthenticated" };
          }
          if (
            !isRegistryIssuedTerminalWebsocketAuthorization(action, resource)
          ) {
            return { allowed: false, reason: "forbidden" };
          }
          return { allowed: true };
        },
      };
    },
  };
}

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

function openWebSocket(
  url: string,
  options?: ClientOptions,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

/**
 * Open a socket while buffering every message from construction. Terminal
 * open can send stock attach/error frames in the same tick as the open
 * event, so registering a listener only after open races and misses them.
 */
function openWebSocketCollecting(
  url: string,
  options?: ClientOptions,
): Promise<{ socket: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const messages: unknown[] = [];
    socket.on("message", (data) => {
      messages.push(JSON.parse(String(data)));
    });
    socket.once("open", () => resolve({ socket, messages }));
    socket.once("error", reject);
  });
}

function waitForClose(
  socket: WebSocket,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve({ code: 1006, reason: "" });
      return;
    }
    socket.once("close", (code, reasonBuffer) => {
      resolve({
        code,
        reason: reasonBuffer.toString("utf8"),
      });
    });
  });
}

async function waitForCollectedMessage(
  messages: unknown[],
  timeoutMs = 2_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (messages.length > 0) {
      return messages[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for websocket message");
}

function seedTerminalWorkspace(server: RunningTestServer) {
  const host = upsertHost(server.db, server.hub, {
    id: "host-terminal-ws-security",
    name: "Terminal WS Security Host",
    type: "persistent",
  });
  const { project } = createProject(server.db, server.hub, {
    name: "Terminal WS Project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/terminal-ws-security-project",
    },
  });
  const environment = createEnvironment(server.db, server.hub, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const thread = createThread(server.db, server.hub, {
    projectId: project.id,
    providerId: "test",
    status: "idle",
    environmentId: environment.id,
  });
  const terminal = createTerminalSession(server.db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: environment.id,
    hostId: host.id,
    initialCwd: "/tmp",
    rows: 24,
    status: "disconnected",
    threadId: thread.id,
    title: "security-term",
  });
  const hostPath = createTerminalSession(server.db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: null,
    hostId: host.id,
    initialCwd: "/tmp",
    rows: 24,
    status: "disconnected",
    threadId: null,
    title: "host-path",
  });
  const personal = ensurePersonalProject(server.db);
  const personalEnv = createEnvironment(server.db, server.hub, {
    projectId: personal.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const personalTerminal = createTerminalSession(server.db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: personalEnv.id,
    hostId: host.id,
    initialCwd: "/tmp",
    rows: 24,
    status: "disconnected",
    threadId: null,
    title: "personal-term",
  });
  return { terminal, hostPath, personalTerminal };
}

const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

describe("principal-bound terminal WebSockets (real transport)", () => {
  it("attaches a scoped standard terminal and delivers attached/error stock messages", async () => {
    const policyState: MutablePolicyState = {
      allowAuthorize: true,
      expiresAtMs: Date.now() + 60_000,
    };
    server = await startTestServer(
      {},
      {
        principalPolicy: createMutableScopedPolicy(policyState),
        principalMode: "work-together",
      },
    );
    const { terminal } = seedTerminalWorkspace(server);
    const { socket, messages } = await openWebSocketCollecting(
      websocketUrl(server.baseUrl, `/ws/terminals/${terminal.id}`),
    );
    sockets.add(socket);
    const first = await waitForCollectedMessage(messages);
    expect(first).toMatchObject({
      type: "attached",
      session: { id: terminal.id },
    });
  });

  it("closes unauthorized for missing/personal/host-path without stock not-found enumeration", async () => {
    const policyState: MutablePolicyState = {
      allowAuthorize: true,
      expiresAtMs: Date.now() + 60_000,
    };
    server = await startTestServer(
      {},
      {
        principalPolicy: createMutableScopedPolicy(policyState),
        principalMode: "work-together",
      },
    );
    const { hostPath, personalTerminal } = seedTerminalWorkspace(server);

    for (const terminalId of [
      "missing-terminal",
      hostPath.id,
      personalTerminal.id,
    ]) {
      const socket = await openWebSocket(
        websocketUrl(server.baseUrl, `/ws/terminals/${terminalId}`),
      );
      sockets.add(socket);
      await expect(waitForClose(socket)).resolves.toEqual({
        code: 1008,
        reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON,
      });
    }
  });

  it("closes after membership recheck revocation once attached", async () => {
    const policyState: MutablePolicyState = {
      allowAuthorize: true,
      expiresAtMs: Date.now() + 60_000,
    };
    server = await startTestServer(
      {},
      {
        principalPolicy: createMutableScopedPolicy(policyState),
        principalMode: "work-together",
        clientSocketRuntime: { membershipRecheckIntervalMs: 50 },
      },
    );
    const { terminal } = seedTerminalWorkspace(server);
    const { socket, messages } = await openWebSocketCollecting(
      websocketUrl(server.baseUrl, `/ws/terminals/${terminal.id}`),
    );
    sockets.add(socket);
    await waitForCollectedMessage(messages);

    policyState.allowAuthorize = false;
    await expect(waitForClose(socket)).resolves.toEqual({
      code: 1008,
      reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON,
    });
  });

  it("binds a signed WT assertion on the exact terminal path and closes after membership removal", async () => {
    const issuer = "https://work-together.example/issuer";
    const cellId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const workspaceId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const subject = "user_2abcDEF0123456789term";
    const kid = "wt-cell-term-1";
    const membership = createWorkTogetherMembershipMemoryFake();
    membership.setMembership({
      cellId,
      subject,
      role: "member",
      membershipRevision: "1",
    });
    const pair = await generateKeyPair("EdDSA");
    const consumed = new Set<string>();
    const principalPolicy = createWorkTogetherPrincipalPolicy({
      issuer,
      cellId,
      workspaceId,
      verificationKeys: new Map([[kid, pair.publicKey]]),
      membershipVerifier: membership,
      replayGuard: {
        async consume({ jti }) {
          if (consumed.has(jti)) {
            return "replayed";
          }
          consumed.add(jti);
          return "consumed";
        },
      },
    });
    server = await startTestServer(
      {},
      {
        principalPolicy,
        principalMode: "work-together",
        clientSocketRuntime: { membershipRecheckIntervalMs: 50 },
      },
    );
    const { terminal } = seedTerminalWorkspace(server);
    const requestTarget = `/ws/terminals/${terminal.id}`;
    const nowSec = Math.floor(Date.now() / 1_000);
    const token = await new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          iss: issuer,
          aud: cellId,
          sub: subject,
          jti: "22222222-2222-4222-8222-222222222222",
          iat: nowSec,
          nbf: nowSec,
          exp: nowSec + 30,
          workspace_id: workspaceId,
          membership_revision: "1",
          principal_kind: "human",
          display_name: "Terminal Ada",
          request_method: "GET",
          request_target: requestTarget,
          transport: "websocket",
        }),
      ),
    )
      .setProtectedHeader({
        alg: WORK_TOGETHER_PRINCIPAL_JWT_ALG,
        typ: WORK_TOGETHER_PRINCIPAL_JWT_TYP,
        kid,
      })
      .sign(pair.privateKey);

    const { socket, messages } = await openWebSocketCollecting(
      websocketUrl(server.baseUrl, requestTarget),
      {
        headers: { [WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER]: token },
      },
    );
    sockets.add(socket);
    await expect(waitForCollectedMessage(messages)).resolves.toMatchObject({
      type: "attached",
      session: { id: terminal.id },
    });

    const closed = waitForClose(socket);
    membership.removeMembership({ cellId, subject });
    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: TERMINAL_SOCKET_POLICY_CLOSE_REASON,
    });
  });

  it("unrestricted local-owner preserves stock missing terminal error", async () => {
    server = await startTestServer();
    const { socket, messages } = await openWebSocketCollecting(
      websocketUrl(server.baseUrl, "/ws/terminals/missing-terminal"),
    );
    sockets.add(socket);
    const first = await waitForCollectedMessage(messages);
    expect(first).toMatchObject({
      type: "error",
      code: "terminal_not_found",
    });
    await expect(waitForClose(socket)).resolves.toMatchObject({
      code: 1008,
      reason: "terminal_not_found",
    });
  });
});
