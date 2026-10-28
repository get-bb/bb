import path from "node:path";
import { internal_DO_NOT_USE_providerPathsHostContract } from "@get-bb/plugin-sdk/host";
import { resolveClaudeConfigDir } from "./config-home.js";
import os from "node:os";
import {
  experimental_defineHostEntry,
  experimental_nativeRootsHostContract,
} from "@get-bb/plugin-sdk/host";
import { resolveClaudeNativeRoots } from "./native-roots.js";

export { experimental_providerBridge } from "./bridge/bridge.js";

export default experimental_defineHostEntry({
  contract: {
    ...experimental_nativeRootsHostContract,
    ...internal_DO_NOT_USE_providerPathsHostContract,
  },
  handlers: {
    resolveProviderPaths: () => {
      const configDir = resolveClaudeConfigDir({
        cwd: process.cwd(),
        homeDir: os.homedir(),
        env: process.env,
      });
      return {
        skillInstallRoots: [path.join(configDir, "skills")],
        credentialFiles: [],
      };
    },
    resolveNativeRoots: (input) =>
      resolveClaudeNativeRoots({
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
