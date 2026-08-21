import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { echoProviderHostContract } from "./contract.js";

/**
 * The plugin's single `bb.host` artifact. It exports two independent things:
 *
 * - `experimental_providerBridge` — the provider bridge, imported and driven
 *   by the daemon's bridge bootstrap in its own process.
 * - `default` — the host RPC entry, imported and driven by the daemon's host
 *   worker in a different process.
 *
 * Nothing is shared but the bytes, which is the point: `bb.host` is the one
 * way a plugin ships code to a host, and each consumer attaches through its
 * own bootstrap and owns its own process lifecycle.
 */
export { experimental_providerBridge } from "./src/provider-bridge.js";

export default experimental_defineHostEntry({
  contract: echoProviderHostContract,
  handlers: {
    hostGreeting: (_input, context) => ({
      platform: process.platform,
      dataDir: context.experimental_paths.dataDir,
    }),
  },
});
