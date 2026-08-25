/**
 * The Claude Code plugin's `bb.host` artifact: the provider bridge (run by
 * the runtime's bridge bootstrap, which imports `experimental_providerBridge`)
 * and the host entry core calls to resolve this provider's native skill and
 * command roots on a host (the plugin host worker imports the default
 * export). One artifact, two consumers.
 */
import os from "node:os";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolveClaudeNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: experimental_nativeRootsHostContract,
  handlers: {
    resolveNativeRoots: (input) =>
      resolveClaudeNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
