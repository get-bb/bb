/**
 * Real WebSocket transport integration for principal-bound client sockets.
 *
 * Covers transport behavior with a strict mutable policy and one complete
 * signed Work Together upgrade/replay/revocation path.
 */
import {
  createEnvironment,
  createProject,
  createThread,
  ensurePersonalProject,
  upsertHost,
  upsertInstalledPlugin,
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
import { isRegistryIssuedClientWebsocketAuthorization } from "../../src/auth/client-websocket-authorization.js";
import { createWorkTogetherMembershipMemoryFake } from "../../src/auth/work-together-membership-memory.js";
import type { PrincipalPolicy } from "../../src/auth/principal-policy.js";
import { createWorkTogetherPrincipalPolicy } from "../../src/auth/work-together-principal-policy.js";
import { CLIENT_SOCKET_POLICY_CLOSE_REASON } from "../../src/ws/client-protocol.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

const PRINCIPAL: Principal = Object.freeze({
  id: "scoped-user",
  kind: "human",
  displayName: "Scoped User",
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
          if (!isRegistryIssuedClientWebsocketAuthorization(action, resource)) {
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

function rejectedWebSocketStatus(
  url: string,
  options?: ClientOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    sockets.add(socket);
    socket.once("open", () =>
      reject(new Error("WebSocket unexpectedly passed signed replay gate")),
    );
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode === undefined) {
        reject(new Error("WebSocket rejection omitted status"));
        return;
      }
      resolve(response.statusCode);
    });
    socket.once("error", () => {
      // The status-bearing unexpected-response event is asserted above.
    });
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

function waitForMessage(
  socket: WebSocket,
  timeoutMs = 2_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for websocket message"));
    }, timeoutMs);
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

function seedWorkspace(server: RunningTestServer) {
  const host = upsertHost(server.db, server.hub, {
    id: "host-ws-security",
    name: "WS Security Host",
    type: "persistent",
  });
  const { project } = createProject(server.db, server.hub, {
    name: "WS Project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/ws-security-project",
    },
  });
  const thread = createThread(server.db, server.hub, {
    projectId: project.id,
    providerId: "test",
    status: "idle",
  });
  const environment = createEnvironment(server.db, server.hub, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const personal = ensurePersonalProject(server.db);
  const personalThread = createThread(server.db, server.hub, {
    projectId: personal.id,
    providerId: "test",
    status: "idle",
  });
  return { project, thread, environment, personalThread };
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

describe("principal-bound client WebSockets (real transport)", () => {
  it("receives changed events for exact standard detail subscriptions", async () => {
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
    const { thread } = seedWorkspace(server);
    const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(socket);

    socket.send(
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    // Allow the serialized authorize chain to complete.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messagePromise = waitForMessage(socket);
    server.hub.notifyThread(thread.id, ["events-appended"]);
    await expect(messagePromise).resolves.toMatchObject({
      type: "changed",
      entity: "thread",
      id: thread.id,
      changes: ["events-appended"],
    });
  });

  it("closes on broad/personal targets without registering or delivering events", async () => {
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
    const { personalThread } = seedWorkspace(server);

    for (const target of [
      { kind: "thread-list" as const },
      { kind: "system" as const },
      { kind: "thread-detail" as const, threadId: personalThread.id },
      { kind: "host-list" as const },
    ]) {
      const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
      sockets.add(socket);
      const closed = waitForClose(socket);
      socket.send(JSON.stringify({ type: "subscribe", target }));
      await expect(closed).resolves.toEqual({
        code: 1008,
        reason: CLIENT_SOCKET_POLICY_CLOSE_REASON,
      });
      server.hub.notifyThread(personalThread.id, ["events-appended"]);
      server.hub.notifySystem(["config-changed"]);
      // No buffered messages after policy close.
      expect(
        await new Promise<number>((resolve) => {
          let count = 0;
          socket.on("message", () => {
            count += 1;
          });
          setTimeout(() => resolve(count), 30);
        }),
      ).toBe(0);
    }
  });

  it("closes within injected short recheck after authorization revocation", async () => {
    const policyState: MutablePolicyState = {
      allowAuthorize: true,
      expiresAtMs: Date.now() + 60_000,
    };
    server = await startTestServer(
      {},
      {
        principalPolicy: createMutableScopedPolicy(policyState),
        principalMode: "work-together",
        clientSocketRuntime: {
          membershipRecheckIntervalMs: 50,
        },
      },
    );
    const { thread } = seedWorkspace(server);
    const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    policyState.allowAuthorize = false;
    const closed = waitForClose(socket);
    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: CLIENT_SOCKET_POLICY_CLOSE_REASON,
    });
  });

  it("closes at assertion expiry and allows a fresh reconnect", async () => {
    let nowMs = Date.now();
    const policyState: MutablePolicyState = {
      allowAuthorize: true,
      expiresAtMs: nowMs + 80,
    };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    server = await startTestServer(
      {},
      {
        principalPolicy: createMutableScopedPolicy(policyState),
        principalMode: "work-together",
        clientSocketRuntime: {
          clock: {
            now: () => nowMs,
            setTimeout: (callback, delayMs) => {
              const handle = setTimeout(callback, delayMs);
              timers.add(handle);
              return handle;
            },
            clearTimeout: (handle) => {
              timers.delete(handle);
              clearTimeout(handle);
            },
          },
          membershipRecheckIntervalMs: 10_000,
        },
      },
    );
    const { thread } = seedWorkspace(server);
    const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const closed = waitForClose(socket);
    // Advance the injected clock past expiry and fire the real timer.
    nowMs = policyState.expiresAtMs;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: CLIENT_SOCKET_POLICY_CLOSE_REASON,
    });

    // Fresh reconnect with a new session works.
    policyState.expiresAtMs = Date.now() + 60_000;
    nowMs = Date.now();
    const reconnected = await openWebSocket(
      websocketUrl(server.baseUrl, "/ws"),
    );
    sockets.add(reconnected);
    reconnected.send(
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const messagePromise = waitForMessage(reconnected);
    server.hub.notifyThread(thread.id, ["events-appended"]);
    await expect(messagePromise).resolves.toMatchObject({
      type: "changed",
      id: thread.id,
    });

    for (const timer of timers) {
      clearTimeout(timer);
    }
  });

  it("duplicate subscribe does not duplicate delivery", async () => {
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
    const { thread } = seedWorkspace(server);
    const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(socket);
    const target = { kind: "thread-detail" as const, threadId: thread.id };
    socket.send(JSON.stringify({ type: "subscribe", target }));
    socket.send(JSON.stringify({ type: "subscribe", target }));
    socket.send(JSON.stringify({ type: "subscribe", target }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messages: unknown[] = [];
    socket.on("message", (data) => {
      messages.push(JSON.parse(String(data)));
    });
    server.hub.notifyThread(thread.id, ["events-appended"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(messages).toHaveLength(1);
  });

  it("delivers scoped plugin signals only for exact plugin-channel and closes missing plugin subscribe", async () => {
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
    seedWorkspace(server);
    upsertInstalledPlugin(server.db, {
      id: "linear",
      source: "path:/plugins/linear",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/linear" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.0.0",
      enabled: true,
    });

    const socket = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        target: {
          kind: "plugin-channel",
          pluginId: "linear",
          channel: "issues",
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));

    const messagePromise = waitForMessage(socket);
    server.hub.notifyPluginSignal("linear", "issues", { n: 1 });
    await expect(messagePromise).resolves.toMatchObject({
      type: "plugin-signal",
      pluginId: "linear",
      channel: "issues",
    });

    // Cross channel/plugin must not deliver.
    const leaked: unknown[] = [];
    socket.on("message", (data) => {
      leaked.push(JSON.parse(String(data)));
    });
    server.hub.notifyPluginSignal("linear", "other", { n: 2 });
    server.hub.notifyPluginSignal("other", "issues", { n: 3 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(leaked).toHaveLength(0);

    const denied = await openWebSocket(websocketUrl(server.baseUrl, "/ws"));
    sockets.add(denied);
    const closed = waitForClose(denied);
    denied.send(
      JSON.stringify({
        type: "subscribe",
        target: {
          kind: "plugin-channel",
          pluginId: "missing-plugin",
          channel: "issues",
        },
      }),
    );
    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: CLIENT_SOCKET_POLICY_CLOSE_REASON,
    });
  });

  it("binds a signed WT assertion, rejects its replay, and closes after membership removal", async () => {
    const issuer = "https://work-together.example/issuer";
    const cellId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const workspaceId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const subject = "user_2abcDEF0123456789";
    const kid = "wt-cell-1";
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
    const { thread } = seedWorkspace(server);
    const nowSec = Math.floor(Date.now() / 1_000);
    const token = await new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({
          iss: issuer,
          aud: cellId,
          sub: subject,
          jti: "11111111-1111-4111-8111-111111111111",
          iat: nowSec,
          nbf: nowSec,
          exp: nowSec + 30,
          workspace_id: workspaceId,
          membership_revision: "1",
          principal_kind: "human",
          display_name: "Ada Lovelace",
          request_method: "GET",
          request_target: "/ws",
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
    const options = {
      headers: { [WORK_TOGETHER_PRINCIPAL_ASSERTION_HEADER]: token },
    };
    const url = websocketUrl(server.baseUrl, "/ws");
    const socket = await openWebSocket(url, options);
    sockets.add(socket);
    socket.send(
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: thread.id },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const message = waitForMessage(socket);
    server.hub.notifyThread(thread.id, ["events-appended"]);
    await expect(message).resolves.toMatchObject({ id: thread.id });
    await expect(rejectedWebSocketStatus(url, options)).resolves.toBe(401);

    const closed = waitForClose(socket);
    membership.removeMembership({ cellId, subject });
    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: CLIENT_SOCKET_POLICY_CLOSE_REASON,
    });
  });
});
