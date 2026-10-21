import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createAccountClient, watchAccount } from "./account.js";
import { registerConnectNextCli } from "./cli.js";
import {
  NEXT_SERVER_OVERRIDE_ENV,
  defaultTrustedCertificates,
  parseTunnelServer,
  resolveFrpc,
  type DownloadArchive,
} from "@bb/frp-client";
import { serverTunnelIngress, type OpenTunnelIngress } from "./ingress.js";
import {
  connectNextRpcContract,
  createRpcHandlers,
  type ConnectNextControls,
} from "./rpc.js";
import { createSharesClient, watchServerShares } from "./shares.js";
import { NextTunnel, type NextTunnelTiming } from "./tunnel.js";
import { CONNECT_NEXT_REALTIME_CHANNEL } from "./types.js";

export interface ConnectNextPluginOptions {
  env?: NodeJS.ProcessEnv;
  openIngress?: OpenTunnelIngress;
  download?: DownloadArchive;
  trustedCertificates?: () => Promise<string[]>;
  timing?: Partial<NextTunnelTiming>;
  accountRetryMinMs?: number;
  onTunnel?: (tunnel: NextTunnel) => void;
}

export function createConnectNextPlugin(
  options: ConnectNextPluginOptions = {},
) {
  return async function plugin(bb: BbPluginApi): Promise<void> {
    const env = options.env ?? process.env;
    const settings = bb.settings.define({
      enabled: {
        type: "boolean",
        label: "Reach this bb at its next address (beta)",
        description:
          "Also make this bb reachable at https://<label>.next.<your bb account's domain> through bb's new Fly gate while it is signed in to your bb account. Your bb connect address keeps working.",
        default: true,
      },
    });
    const initial = await settings.get();
    const serverOverride = parseTunnelServer(env[NEXT_SERVER_OVERRIDE_ENV]);
    const dataDir = () =>
      path.join(bb.server.experimental_dataDir, "plugins", bb.pluginId);
    const account = createAccountClient(() => bb.sdk);
    const sharesClient = createSharesClient(() => bb.sdk);
    const tunnel = new NextTunnel({
      frpDir: path.join(dataDir(), "frp"),
      serverOverride,
      enabled: initial.enabled,
      resolveBinary: () =>
        resolveFrpc({
          dataDir: dataDir(),
          env,
          ...(options.download === undefined
            ? {}
            : { download: options.download }),
        }),
      readCredential: () => account.credential(),
      openIngress: options.openIngress ?? serverTunnelIngress(bb.server),
      trustedCertificates:
        options.trustedCertificates ?? (() => defaultTrustedCertificates(env)),
      log: bb.log,
      onStatusChange: (status) => {
        bb.realtime.publish(CONNECT_NEXT_REALTIME_CHANNEL, status);
      },
      setMachineTunnels: (config) =>
        bb.hosts.internal_DO_NOT_USE_setNextTunnels(config),
      machineStatuses: () => bb.hosts.internal_DO_NOT_USE_nextTunnelStatuses(),
      ...(options.timing === undefined ? {} : { timing: options.timing }),
    });
    options.onTunnel?.(tunnel);
    bb.hosts.internal_DO_NOT_USE_onNextTunnelStatusChange(() => {
      tunnel.machinesChanged();
    });

    settings.onChange((next) => {
      void tunnel.setEnabled(next.enabled);
    });

    const controls: ConnectNextControls = {
      status: () => tunnel.status(),
      async setEnabled(enabled) {
        await settings.experimental_set({ enabled });
        await tunnel.setEnabled(enabled);
        return tunnel.status();
      },
    };

    bb.rpc.register(connectNextRpcContract, createRpcHandlers(controls));
    registerConnectNextCli(bb, controls);

    bb.background.service("tunnel", {
      async start(signal) {
        await tunnel.start();
        const retry =
          options.accountRetryMinMs === undefined
            ? {}
            : { retryMinMs: options.accountRetryMinMs };
        try {
          await Promise.all([
            watchAccount(
              {
                account,
                log: bb.log,
                onIdentity: (identity) => {
                  void tunnel.setIdentity(identity);
                },
                ...retry,
              },
              signal,
            ),
            watchServerShares(
              {
                shares: sharesClient,
                log: bb.log,
                onPorts: (ports) => {
                  void tunnel.setSharePorts(ports);
                },
                ...retry,
              },
              signal,
            ),
          ]);
        } finally {
          await tunnel.stop();
        }
      },
    });
  };
}
