import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import { connectRpcContract, createRpcHandlers } from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { ShareHostResolver } from "./hosts.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import { resolveDefaultConnectBaseUrl } from "./redeem.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";

export default async function plugin(bb: BbPluginApi) {
  const store = createKvCredentialStore(bb.storage.kv);
  // Tunnel is assigned below; ShareRegistry reads the live credential via this.
  let tunnel!: ConnectTunnel;
  const hostResolver = new ShareHostResolver(() => bb.sdk);
  const getLoopbackBaseUrl = () =>
    resolveLocalCloudLoopbackUrl(
      tunnel.getCredential()?.serverUrl,
      process.env.BB_DEV_APP_PORT,
    ) ?? bb.server.loopbackBaseUrl;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    hosts: bb.hosts,
    hostResolver,
    getLoopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    log: bb.log,
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  tunnel = new ConnectTunnel({
    store,
    shares,
    defaultBaseUrl: resolveDefaultConnectBaseUrl(process.env),
    getLoopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) =>
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status),
  });

  bb.rpc.register(connectRpcContract, createRpcHandlers(tunnel, hostResolver));
  registerConnectCli({ bb, tunnel, hostResolver });

  bb.agents.contributeInstructions(() => {
    const status = tunnel.status();
    if (!status.paired || status.url === null) return null;
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

  // The tunnel lives inside this service: idle while unpaired, dialing when
  // a credential exists, torn down on abort (reload/disable/shutdown) —
  // disabling the plugin cuts off all remote access. The tunnel keeps its
  // own capped-backoff reconnect; the host's restart-with-backoff is crash
  // supervision on top.
  bb.background.service("tunnel", {
    async start(signal) {
      await tunnel.start();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      tunnel.stop();
    },
  });
}
