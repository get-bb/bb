/**
 * `@bb/agent-runtime/test`: what another package's suite needs to drive the
 * runtime against the scripted echo bridge (the host daemon's command tests),
 * and the first-party provider declarations as their plugins register them
 * (the server's test registries and this package's integration setup).
 */
export {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
  type CaptureFirstPartyProviderDeclarationsOptions,
} from "./first-party-provider-declarations.js";
export {
  createScriptedEchoLaunch,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  scriptedEchoBridgeModulePath,
  withBridgeLaunch,
  type CreateScriptedEchoLaunchOptions,
  type LaunchBoundAgentRuntime,
  type ScriptedEchoLaunchScript,
  type ScriptedEchoRequestRecord,
} from "./runtime-test-harness.js";
