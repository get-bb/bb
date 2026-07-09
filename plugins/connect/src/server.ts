import type { BbPluginApi } from "@bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import { createRpcHandlers } from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";

export default async function plugin(bb: BbPluginApi) {
  const store = createKvCredentialStore(bb.storage.kv);
  // Tunnel is assigned below; ShareRegistry reads the live credential via this.
  let tunnel!: ConnectTunnel;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    getLoopbackBaseUrl: () => bb.server.loopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  tunnel = new ConnectTunnel({
    store,
    shares,
    getLoopbackBaseUrl: () => bb.server.loopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) =>
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status),
  });

  bb.rpc.register(createRpcHandlers(tunnel));
  registerConnectCli({ bb, tunnel });

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
      "When you start a local HTTP server they should see, run `bb connect expose <port>` " +
      "and give them the printed share URL as a markdown link — a localhost URL will not work for them."
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
