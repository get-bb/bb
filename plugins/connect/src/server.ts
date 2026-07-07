import type { BbPluginApi } from "@bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import {
  dataDirFromDb,
  importLegacyConnectCredential,
} from "./migrate-legacy.js";
import { createRpcHandlers } from "./rpc.js";
import { ConnectTunnel } from "./tunnel.js";
import { CONNECT_REALTIME_CHANNEL } from "./types.js";

export default async function plugin(bb: BbPluginApi) {
  const store = createKvCredentialStore(bb.storage.kv);
  const tunnel = new ConnectTunnel({
    store,
    getLoopbackBaseUrl: () => bb.server.loopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) =>
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status),
  });

  // One-shot kernel-era migration: a bb that stored its credential at
  // <dataDir>/connect.json must come back paired after the upgrade. The
  // sqlite handle is only opened to locate the data dir (same trick as the
  // automations plugin).
  const dataDir = dataDirFromDb(bb.storage.sqlite(), bb.pluginId);
  if (dataDir !== null) {
    await importLegacyConnectCredential({
      kv: bb.storage.kv,
      store,
      dataDir,
      log: bb.log,
    });
  }

  bb.rpc.register(createRpcHandlers(tunnel));
  registerConnectCli({ bb, tunnel });

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
