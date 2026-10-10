import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createAccountClient } from "./account-client.js";
import { AccountLink } from "./account-link.js";
import { resolveDefaultConnectBaseUrl } from "./base-url.js";
import { registerConnectCli } from "./cli.js";
import { HostedConnectApi } from "./hosted.js";
import { ShareHostResolver } from "./hosts.js";
import {
  CredentialCopy,
  createCredentialCopyStore,
} from "./credential-copy.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import {
  connectRpcContract,
  createRpcHandlers,
  type RemoteAccessSwitch,
} from "./rpc.js";
import {
  createServerAccessCloud,
  createServerAccessRecheck,
  registerServerAccess,
} from "./server-access.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";
import { createDeviceCodeIssuer } from "./sealed/device-codes.js";
import { createKvDeviceRegistry } from "./sealed/devices.js";
import { createKvServerIdentityStore } from "./sealed/identity.js";
import { registerSealedRoutes } from "./sealed/route.js";
import { SealedAccess } from "./sealed/sealed-access.js";
import {
  SEALED_HTTP_PREFIX,
  SEALED_INFO_ROUTE_PATH,
  SEALED_REALTIME_CHANNEL,
} from "./sealed/types.js";

const ALIAS_PROBE_TIMEOUT_MS = 1_500;

async function portServesThisBb(
  port: number,
  info: () => Promise<{ publicKey: string }>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}${SEALED_HTTP_PREFIX}${SEALED_INFO_ROUTE_PATH}`,
      { signal: AbortSignal.timeout(ALIAS_PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { publicKey?: unknown };
    return (
      typeof body.publicKey === "string" &&
      body.publicKey === (await info()).publicKey
    );
  } catch {
    return false;
  }
}

export interface ConnectPluginOptions {
  accountRetryMinMs?: number;
}

export function createConnectPlugin(options: ConnectPluginOptions = {}) {
  return async function plugin(bb: BbPluginApi): Promise<void> {
    const settings = bb.settings.define({
      remoteAccess: {
        type: "boolean",
        label: "Remote access",
        description:
          "Keep this bb reachable at its getbb.app address while it is signed in to your bb account. Turning it off keeps the account signed in.",
        default: true,
      },
      sendRemoteInstructions: {
        type: "boolean",
        label: "Tell agents about remote access",
        description:
          "When you use BB remotely, tell agents to share servers through Connect. Applies to new agent sessions.",
        default: true,
      },
    });
    let currentSettings = await settings.get();
    const account = createAccountClient(() => bb.sdk);
    const hosted = new HostedConnectApi(account);
    let tunnel!: ConnectTunnel;
    let sealed!: SealedAccess;
    const hostResolver = new ShareHostResolver(() => bb.sdk);
    const getLoopbackBaseUrl = () =>
      resolveLocalCloudLoopbackUrl(
        tunnel.getIdentity()?.serverUrl,
        process.env.BB_DEV_APP_PORT,
      ) ?? bb.server.loopbackBaseUrl;

    const shares = new ShareRegistry({
      kv: bb.storage.kv,
      hosts: bb.hosts,
      hostResolver,
      getLoopbackBaseUrl,
      getIdentity: () => tunnel.getIdentity(),
      servesThisBb: (port) => portServesThisBb(port, () => sealed.info()),
      log: bb.log,
      onChange: () => {
        bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
      },
    });

    bb.events.on("experimental_host.deleted", async ({ host }) => {
      await shares.pruneHost(host.id);
    });

    const recheckServerAccess = createServerAccessRecheck(bb);
    tunnel = new ConnectTunnel({
      shares,
      readCredential: () => account.connectCredential(),
      confirmRefusedCredential: (credential) =>
        account.confirmRefusedCredential(credential),
      defaultBaseUrl: resolveDefaultConnectBaseUrl(process.env),
      enabled: currentSettings.remoteAccess,
      getLoopbackBaseUrl,
      log: bb.log,
      onStatusChange: (status) => {
        bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status);
        recheckServerAccess(status);
      },
      guardStream: (stream) => sealed.guardStream(stream),
      sealedRemoteClients: () => sealed.remoteClients,
      onPaired: async () => {
        if (await sealed.requireForNewPairing()) {
          bb.log.info(
            "sealed connections are required for this new pairing; approve devices with `bb connect approve-device` or a device code",
          );
        }
      },
    });

    let publishSealed = Promise.resolve();
    sealed = new SealedAccess({
      identity: createKvServerIdentityStore(bb.storage.kv),
      devices: createKvDeviceRegistry(bb.storage.kv),
      codes: createDeviceCodeIssuer(),
      policy: bb.storage.kv,
      log: bb.log,
      onChange: () => {
        publishSealed = publishSealed
          .then(() => sealed.status())
          .then((status) => {
            bb.realtime.publish(SEALED_REALTIME_CHANNEL, status);
          })
          .catch((error: unknown) => {
            bb.log.warn(
              `failed to publish sealed status: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        tunnel.republish();
      },
      onRequired: () => {
        const closed = tunnel.reguard();
        if (closed > 0) {
          bb.log.info(
            `closed ${closed} readable Connect stream${closed === 1 ? "" : "s"} because encryption is now required`,
          );
        }
      },
    });
    await sealed.load();

    registerSealedRoutes({
      bb,
      access: sealed,
      createMachineCode: () =>
        hosted.createMachineCode(AbortSignal.timeout(10_000)),
      getLoopbackBaseUrl,
      getPublicOrigin: () => {
        const url = tunnel.getIdentity()?.serverUrl;
        return url === undefined ? null : new URL(url).origin;
      },
      log: bb.log,
      onActivity: (at) => tunnel.noteRemoteActivity(at),
      onRemoteClientsChange: () => tunnel.republish(),
    });
    settings.onChange((next) => {
      currentSettings = next;
      tunnel.setEnabled(next.remoteAccess);
    });

    const remoteAccess: RemoteAccessSwitch = {
      async set(enabled) {
        await settings.experimental_set({ remoteAccess: enabled });
        tunnel.setEnabled(enabled);
        return tunnel.refreshStatus();
      },
    };

    await registerServerAccess(bb, {
      cloud: createServerAccessCloud(hosted),
      status: () => tunnel.status(),
    });

    bb.rpc.register(
      connectRpcContract,
      createRpcHandlers({
        tunnel,
        hosted,
        hostResolver,
        remoteAccess,
        sealed,
      }),
    );
    registerConnectCli({
      bb,
      tunnel,
      account,
      hosted,
      hostResolver,
      remoteAccess,
      sealed,
    });

    bb.agents.contributeInstructions(() => {
      if (!currentSettings.sendRemoteInstructions) return null;
      const status = tunnel.status();
      if (!status.paired || !status.enabled || status.url === null) return null;
      const recent =
        status.remoteClients > 0 ||
        (status.lastRemoteActivityAt !== null &&
          Date.now() - status.lastRemoteActivityAt <
            REMOTE_ACTIVITY_INSTRUCTIONS_MS);
      if (!recent) return null;
      return (
        `The user is currently viewing this bb remotely at ${status.url}. ` +
        "Port shares work from a thread on any enrolled host: when you start an HTTP server they should see, run `bb connect expose <port>` from that thread. " +
        "The command returns the correct public URL for the thread's host; give it to them as a markdown link because a localhost URL will not work remotely."
      );
    });

    const link = new AccountLink({
      account,
      copy: new CredentialCopy({
        account,
        store: createCredentialCopyStore(bb.storage.kv),
        log: bb.log,
      }),
      log: bb.log,
      onAccount: (next) => {
        const restored =
          next !== null &&
          tunnel.getIdentity() === null &&
          tunnel.status().state !== "pairing";
        tunnel.setAccount(next);
        if (restored && !sealed.hasPolicy) {
          bb.status.needsConfiguration(
            "This bb was paired before sealed connections existed. Decide whether to require them: Settings → Remote access, or `bb connect require-encryption on|off`. Until then the relay can still read API traffic.",
          );
        }
      },
      ...(options.accountRetryMinMs === undefined
        ? {}
        : { retryMinMs: options.accountRetryMinMs }),
    });

    bb.background.service("tunnel", {
      async start(signal) {
        await tunnel.start();
        await link.run(signal);
        tunnel.stop();
        sealed.disconnectAll();
      },
    });
  };
}
