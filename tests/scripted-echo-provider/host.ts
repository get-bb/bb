/**
 * The plugin's `bb.host` artifact: the scripted echo bridge, imported and
 * driven by the daemon's bridge bootstrap in its own process. The integration
 * harness builds this artifact exactly as the plugin runtime does for a real
 * provider plugin; the runtime unit suites import the TypeScript source as the
 * artifact directly (the bootstrap runs under tsx from source).
 */
export { experimental_providerBridge } from "./src/provider-bridge.js";
