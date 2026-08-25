/**
 * The plugin's `bb.host` artifact, two surfaces in one file: the provider
 * bridge (the runtime's bridge bootstrap imports `experimental_providerBridge`)
 * and the host entry core calls to resolve this provider's native skill roots
 * on a host — the skills directories pi's own settings name here.
 */
import { homedir } from "node:os";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolvePiNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: experimental_nativeRootsHostContract,
  handlers: {
    // Pi keeps every host-only root in the user's settings; the workspace
    // does not change the answer.
    resolveNativeRoots: () =>
      resolvePiNativeRoots({ homeDir: homedir(), env: process.env }),
  },
});
