import {
  acceptSealedChannel,
  type EstablishedSealedChannel,
} from "@bb/sealed-channel";
import {
  CONNECT_TUNNEL_HEADER,
  GATE_AUTH_HEADER,
  SEALED_DEVICE_HEADER,
  TunnelSession,
} from "@bb/tunnel-client";
import { z } from "zod";
import type {
  BbPluginApi,
  ExperimentalPluginWebSocket,
  PluginLogger,
} from "@get-bb/plugin-sdk";
import type { SealedAccess } from "./sealed-access.js";
import { SEALED_INFO_ROUTE_PATH, SEALED_ROUTE_PATH } from "./types.js";

const HANDSHAKE_TIMEOUT_MS = 15_000;

export interface SealedRouteOptions {
  bb: Pick<BbPluginApi, "http">;
  access: SealedAccess;
  createMachineCode: () => Promise<{
    code: string;
    expiresAt: number;
    serverUrl: string;
  }>;
  getLoopbackBaseUrl: () => string;
  getPublicOrigin: () => string | null;
  log: PluginLogger;
  onActivity?: (at: number) => void;
  onRemoteClientsChange?: () => void;
}

export const REMOTE_CALLER_ERROR =
  "device management is only available from the computer running bb";

export function isRemoteCaller(headers: Headers): boolean {
  return (
    headers.get(GATE_AUTH_HEADER) !== null ||
    headers.get(CONNECT_TUNNEL_HEADER) !== null ||
    headers.get(SEALED_DEVICE_HEADER) !== null
  );
}

const deviceIdBodySchema = z.object({ deviceId: z.string().min(1) }).strict();
const requiredBodySchema = z.object({ required: z.boolean() }).strict();

export function registerSealedRoutes(options: SealedRouteOptions): void {
  const { bb, access, log } = options;

  const local = (
    run: (body: unknown) => Promise<unknown>,
  ): Parameters<typeof bb.http.route>[2] => {
    return async (context) => {
      if (isRemoteCaller(context.req.raw.headers)) {
        return context.json(
          { ok: false, error: REMOTE_CALLER_ERROR, code: "local_only" },
          403,
        );
      }
      let body: unknown = null;
      const raw = await context.req.text();
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          return context.json({ ok: false, error: "invalid JSON body" }, 400);
        }
      }
      try {
        return context.json({ ok: true, result: await run(body) });
      } catch (error) {
        return context.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          400,
        );
      }
    };
  };

  bb.http.route(
    "POST",
    "/sealed/devices/approve",
    local(async (body) => {
      const { deviceId } = deviceIdBodySchema.parse(body);
      return access.approveDevice(deviceId);
    }),
  );
  bb.http.route(
    "POST",
    "/sealed/devices/revoke",
    local(async (body) => {
      const { deviceId } = deviceIdBodySchema.parse(body);
      return access.revokeDevice(deviceId);
    }),
  );
  bb.http.route(
    "POST",
    "/sealed/devices/remove",
    local(async (body) => {
      const { deviceId } = deviceIdBodySchema.parse(body);
      return { removed: await access.removeDevice(deviceId) };
    }),
  );
  bb.http.route(
    "POST",
    "/sealed/require",
    local(async (body) => {
      const { required } = requiredBodySchema.parse(body);
      return access.setRequired(required);
    }),
  );
  bb.http.route(
    "POST",
    "/sealed/device-codes",
    local(() => access.createDeviceCode()),
  );
  bb.http.route(
    "POST",
    "/sealed/rotate-key",
    local(() => access.rotateIdentity()),
  );
  bb.http.route(
    "POST",
    "/sealed/mobile-pairing",
    local(async () => {
      const machineCode = await options.createMachineCode();
      const deviceCode = await access.createDeviceCode();
      return {
        ...machineCode,
        sealed: {
          serverKey: deviceCode.serverKey,
          fingerprint: deviceCode.fingerprint,
          deviceCode: deviceCode.code,
        },
      };
    }),
  );

  bb.http.route("GET", SEALED_INFO_ROUTE_PATH, async (context) => {
    const info = await access.info();
    const publicOrigin = options.getPublicOrigin();
    return context.json(
      {
        ...info,
        ...(publicOrigin === null
          ? {}
          : { connectHost: new URL(publicOrigin).host }),
      },
      200,
      { "cache-control": "no-store" },
    );
  });

  bb.http.experimental_websocket(SEALED_ROUTE_PATH, () => {
    let acceptor: ReturnType<typeof acceptSealedChannel> | null = null;
    let established: EstablishedSealedChannel | null = null;
    let session: TunnelSession | null = null;
    const handle = {};

    const teardown = () => {
      if (established === null) return;
      session?.dispose();
      session = null;
      established = null;
      access.channelClosed(handle);
      options.onRemoteClientsChange?.();
    };

    let handshakeDeadline: ReturnType<typeof setTimeout> | null = null;
    return {
      async onOpen(socket: ExperimentalPluginWebSocket) {
        handshakeDeadline = setTimeout(() => {
          if (established === null)
            socket.close(1002, "sealed handshake timed out");
        }, HANDSHAKE_TIMEOUT_MS);
        const identity = await access.serverIdentity();
        acceptor = acceptSealedChannel({
          socket,
          identity,
          authorize: (request) => access.authorize(request),
          onRejected(request, outcome) {
            log.info(
              `sealed handshake ${outcome.status} for device ${request.deviceId} (${request.device.name})`,
            );
          },
          onProtocolError(error) {
            log.warn(`sealed handshake failed: ${error.message}`);
          },
          onEstablished(channel) {
            if (handshakeDeadline !== null) clearTimeout(handshakeDeadline);
            established = channel;
            void access
              .channelOpened(
                handle,
                channel.deviceId,
                identity.publicKey,
                (code, reason) => {
                  channel.close(code, reason);
                  teardown();
                },
              )
              .then((admitted) => {
                if (!admitted || established !== channel) return;
                startSession(channel);
              });
          },
        });
      },
      async onMessage(_socket, data) {
        await acceptor?.onMessage(data);
      },
      onClose(_socket, event) {
        if (handshakeDeadline !== null) clearTimeout(handshakeDeadline);
        acceptor?.onClose(event.code, event.reason);
        teardown();
      },
      onError(_socket, error) {
        log.warn(`sealed socket error: ${error.message}`);
      },
    };

    function startSession(channel: EstablishedSealedChannel): void {
      session = new TunnelSession({
        tunnel: channel.transport,
        log,
        stripRequestHeaders: [
          SEALED_DEVICE_HEADER,
          GATE_AUTH_HEADER,
          CONNECT_TUNNEL_HEADER,
        ],
        injectRequestHeaders: () => ({
          [SEALED_DEVICE_HEADER]: channel.deviceId,
        }),
        resolveOrigin: () => ({
          kind: "ok",
          resolved: {
            origin: options.getLoopbackBaseUrl().replace(/\/$/u, ""),
            publicOrigin:
              options.getPublicOrigin() ?? options.getLoopbackBaseUrl(),
          },
        }),
        onRemoteClientsChange: (count) => {
          access.channelRealtimeStreams(handle, count);
          options.onRemoteClientsChange?.();
        },
        ...(options.onActivity ? { onActivity: options.onActivity } : {}),
      });
      session.start();
      channel.transport.on("close", teardown);
      options.onRemoteClientsChange?.();
    }
  });
}
