import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createAccountClient,
  watchAccount,
} from "bb-plugin-bb-account/src/client.js";
import { resolveDefaultConnectBaseUrl } from "@bb/connect-client";
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
import { NextAddress } from "./next-address.js";
import {
  RemoteAccessFeed,
  connectRemoteAccessRpcContract,
  createRemoteAccessHandlers,
} from "./remote-access-feed.js";
import {
  RevisionFeed,
  connectServerSharesRpcContract,
  createServerSharesHandlers,
} from "./server-shares.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";

export interface ConnectPluginOptions {
  accountRetryMinMs?: number;
  serverSharesLongPollMs?: number;
  remoteAccessLongPollMs?: number;
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
    const hostResolver = new ShareHostResolver(() => bb.sdk);
    const getLoopbackBaseUrl = () =>
      resolveLocalCloudLoopbackUrl(
        tunnel.getIdentity()?.serverUrl,
        process.env.BB_DEV_APP_PORT,
      ) ?? bb.server.loopbackBaseUrl;

    const shareChanges = new RevisionFeed();
    const remoteAccessFeed = new RemoteAccessFeed(currentSettings.remoteAccess);
    bb.onDispose(() => {
      remoteAccessFeed.set(false);
      remoteAccessFeed.dispose();
      shareChanges.dispose();
    });
    const nextAddress = new NextAddress(() => bb.sdk);
    const shares = new ShareRegistry({
      kv: bb.storage.kv,
      hosts: bb.hosts,
      hostResolver,
      getLoopbackBaseUrl,
      getIdentity: () => tunnel.getIdentity(),
      log: bb.log,
      onChange: () => {
        shareChanges.bump();
        bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
      },
      nextOrigin: () => nextAddress.refresh(),
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
    });
    settings.onChange((next) => {
      currentSettings = next;
      tunnel.setEnabled(next.remoteAccess);
      remoteAccessFeed.set(next.remoteAccess);
    });

    const remoteAccess: RemoteAccessSwitch = {
      async set(enabled) {
        await settings.experimental_set({ remoteAccess: enabled });
        tunnel.setEnabled(enabled);
        remoteAccessFeed.set(enabled);
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
      }),
    );
    bb.rpc.register(
      connectServerSharesRpcContract,
      createServerSharesHandlers({
        changes: shareChanges,
        serverPorts: () => shares.serverPorts(),
        ...(options.serverSharesLongPollMs === undefined
          ? {}
          : { longPollMs: options.serverSharesLongPollMs }),
      }),
    );
    bb.rpc.register(
      connectRemoteAccessRpcContract,
      createRemoteAccessHandlers({
        feed: remoteAccessFeed,
        ...(options.remoteAccessLongPollMs === undefined
          ? {}
          : { longPollMs: options.remoteAccessLongPollMs }),
      }),
    );
    registerConnectCli({
      bb,
      tunnel,
      account,
      hosted,
      hostResolver,
      remoteAccess,
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

    const copy = new CredentialCopy({
      account,
      store: createCredentialCopyStore(bb.storage.kv),
      log: bb.log,
    });

    bb.background.service("tunnel", {
      async start(signal) {
        await tunnel.start();
        await watchAccount(
          {
            account,
            log: bb.log,
            onAccount: (next) => tunnel.setAccount(next),
            sync: (status) => copy.sync(status),
            ...(options.accountRetryMinMs === undefined
              ? {}
              : { retryMinMs: options.accountRetryMinMs }),
          },
          signal,
        );
        tunnel.stop();
      },
    });
  };
}
