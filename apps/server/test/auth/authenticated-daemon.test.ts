import { HOST_DAEMON_WEBSOCKET_PROTOCOL } from "@bb/host-daemon-contract";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  MACHINE_PRINCIPAL_DISPLAY_NAME,
  assertAuthenticatedHostMatches,
  getAuthenticatedDaemon,
  setAuthenticatedDaemon,
  verifyAuthenticatedDaemon,
  type AuthenticatedDaemon,
} from "../../src/internal/auth.js";
import { validateDaemonWebSocket } from "../../src/ws/daemon-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { initDb } from "../../src/db.js";
import { createTestDaemonHostKey } from "../helpers/test-app.js";
import { seedHostSession } from "../helpers/seed.js";

function createMachineAuthFake(args: {
  hostId?: string;
  hostType?: "persistent";
  keyId?: string;
  validToken?: string;
}) {
  const hostId = args.hostId ?? "host_machine_1";
  const hostType = args.hostType ?? "persistent";
  const keyId = args.keyId ?? "key_machine_1";
  const validToken = args.validToken ?? "valid-daemon-token";
  return {
    hostId,
    hostType,
    keyId,
    validToken,
    deps: {
      machineAuth: {
        async verifyDaemonHostKey(token: string) {
          if (token !== validToken) {
            return null;
          }
          return {
            keyId,
            metadata: { hostId, hostType },
          };
        },
      },
    },
  };
}

describe("authenticated daemon machine Principal projection", () => {
  it("mints a frozen machine Principal matching the verified host id", async () => {
    const fake = createMachineAuthFake({});
    const daemon = await verifyAuthenticatedDaemon(
      fake.deps,
      `Bearer ${fake.validToken}`,
    );

    expect(daemon).toEqual({
      hostId: fake.hostId,
      hostType: fake.hostType,
      keyId: fake.keyId,
      principal: {
        id: fake.hostId,
        kind: "machine",
        displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
      },
    });
    expect(Object.isFrozen(daemon)).toBe(true);
    expect(Object.isFrozen(daemon.principal)).toBe(true);
    expect(daemon.principal.id).toBe(daemon.hostId);
  });

  it("resists mutation of the issued daemon and Principal", async () => {
    const fake = createMachineAuthFake({});
    const daemon = await verifyAuthenticatedDaemon(
      fake.deps,
      `Bearer ${fake.validToken}`,
    );

    expect(() => {
      (daemon as { hostId: string }).hostId = "mutated-host";
    }).toThrow();
    expect(() => {
      (daemon.principal as { kind: string }).kind = "human";
    }).toThrow();
    expect(() => {
      (daemon.principal as { displayName: string }).displayName = "Attacker";
    }).toThrow();
    expect(daemon.hostId).toBe(fake.hostId);
    expect(daemon.principal).toEqual({
      id: fake.hostId,
      kind: "machine",
      displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
    });
  });

  it("rejects structurally forged daemon objects on attach", async () => {
    const context = {};
    const forged = Object.freeze({
      hostId: "host_forged",
      hostType: "persistent",
      keyId: "key_forged",
      principal: Object.freeze({
        id: "host_forged",
        kind: "machine",
        displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
      }),
    }) as AuthenticatedDaemon;

    expect(() => setAuthenticatedDaemon(context, forged)).toThrow(
      /not issued by verifyAuthenticatedDaemon/i,
    );
    expect(() => getAuthenticatedDaemon(context)).toThrow(ApiError);
  });

  it("rejects forged human Principal-shaped daemon objects on attach", async () => {
    const context = {};
    const forgedHuman = Object.freeze({
      hostId: "host_forged",
      hostType: "persistent",
      keyId: "key_forged",
      principal: Object.freeze({
        id: "attacker",
        kind: "human",
        displayName: "Attacker",
      }),
    }) as AuthenticatedDaemon;

    expect(() => setAuthenticatedDaemon(context, forgedHuman)).toThrow(
      /not issued by verifyAuthenticatedDaemon/i,
    );
  });

  it("attaches exactly once and rejects duplicate replacement", async () => {
    const fake = createMachineAuthFake({});
    const first = await verifyAuthenticatedDaemon(
      fake.deps,
      `Bearer ${fake.validToken}`,
    );
    const second = await verifyAuthenticatedDaemon(
      fake.deps,
      `Bearer ${fake.validToken}`,
    );
    const context = {};

    setAuthenticatedDaemon(context, first);
    expect(getAuthenticatedDaemon(context)).toBe(first);
    expect(() => setAuthenticatedDaemon(context, second)).toThrow(
      /already attached/i,
    );
    expect(getAuthenticatedDaemon(context)).toBe(first);
  });

  it("ignores Hono variable replacement attempts for daemon authority", async () => {
    const fake = createMachineAuthFake({});
    const app = new Hono();
    app.use("*", async (context, next) => {
      const daemon = await verifyAuthenticatedDaemon(
        fake.deps,
        `Bearer ${fake.validToken}`,
      );
      setAuthenticatedDaemon(context, daemon);
      await next();
    });
    app.get("/", (context) => {
      const unsafeContext = context as unknown as {
        set(key: string, value: unknown): void;
      };
      unsafeContext.set("authenticatedDaemon", {
        hostId: "attacker-host",
        hostType: "persistent",
        keyId: "attacker-key",
        principal: {
          id: "attacker",
          kind: "human",
          displayName: "Attacker",
        },
      });
      const attached = getAuthenticatedDaemon(context);
      return context.json({
        hostId: attached.hostId,
        principal: attached.principal,
      });
    });

    const response = await app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hostId: fake.hostId,
      principal: {
        id: fake.hostId,
        kind: "machine",
        displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
      },
    });
  });

  it("rejects missing and invalid bearer tokens", async () => {
    const fake = createMachineAuthFake({});

    await expect(
      verifyAuthenticatedDaemon(fake.deps, undefined),
    ).rejects.toMatchObject({
      status: 401,
      body: { code: "unauthorized" },
    });
    await expect(
      verifyAuthenticatedDaemon(fake.deps, "Bearer "),
    ).rejects.toMatchObject({
      status: 401,
      body: { code: "unauthorized" },
    });
    await expect(
      verifyAuthenticatedDaemon(fake.deps, "Bearer not-the-token"),
    ).rejects.toMatchObject({
      status: 401,
      body: { code: "unauthorized" },
    });
    await expect(
      verifyAuthenticatedDaemon(fake.deps, "Basic abc"),
    ).rejects.toMatchObject({
      status: 401,
      body: { code: "unauthorized" },
    });
  });

  it("preserves host-match semantics", async () => {
    const fake = createMachineAuthFake({});
    const daemon = await verifyAuthenticatedDaemon(
      fake.deps,
      `Bearer ${fake.validToken}`,
    );

    expect(() =>
      assertAuthenticatedHostMatches(daemon, {
        hostId: fake.hostId,
        hostType: fake.hostType,
      }),
    ).not.toThrow();
    expect(() =>
      assertAuthenticatedHostMatches(daemon, {
        hostId: "other-host",
        hostType: fake.hostType,
      }),
    ).toThrow(ApiError);
  });

  it("projects the verified machine Principal into daemon WebSocket context", async () => {
    const db = initDb(":memory:");
    const hub = new NotificationHub();
    const hostId = "host_ws_machine";
    const { session } = seedHostSession(
      { db, hub },
      { id: hostId, name: "WS Host" },
    );
    const token = createTestDaemonHostKey({ hostId });
    const deps = {
      db,
      machineAuth: {
        async verifyDaemonHostKey(candidate: string) {
          if (candidate !== token) {
            return null;
          }
          return {
            keyId: `test:persistent:${hostId}`,
            metadata: { hostId, hostType: "persistent" as const },
          };
        },
      },
    };

    const context = await validateDaemonWebSocket(deps, {
      authorizationHeader: `Bearer ${token}`,
      protocolHeader: HOST_DAEMON_WEBSOCKET_PROTOCOL,
      sessionId: session.id,
    });

    expect(Object.isFrozen(context)).toBe(true);
    expect(context).toEqual({
      hostId,
      sessionId: session.id,
      principal: {
        id: hostId,
        kind: "machine",
        displayName: MACHINE_PRINCIPAL_DISPLAY_NAME,
      },
    });
    expect(Object.isFrozen(context.principal)).toBe(true);
    expect(() => {
      (context as { hostId: string }).hostId = "mutated";
    }).toThrow();
  });
});
