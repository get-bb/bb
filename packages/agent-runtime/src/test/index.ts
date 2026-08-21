/**
 * `@bb/agent-runtime/test`: what another package's suite needs to drive the
 * runtime against the scripted echo bridge (the host daemon's command tests).
 */
export {
  createScriptedEchoLaunch,
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  scriptedEchoBridgeModulePath,
  withBridgeLaunch,
  type CreateScriptedEchoLaunchOptions,
  type ScriptedEchoLaunchScript,
  type ScriptedEchoRequestRecord,
} from "./runtime-test-harness.js";
