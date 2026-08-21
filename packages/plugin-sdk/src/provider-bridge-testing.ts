/**
 * `@get-bb/plugin-sdk/provider-bridge/testing` — the published testing kit
 * for provider bridges.
 *
 * A bridge author needs three things to prove a bridge before shipping it,
 * none of which should require bb's private workspace packages:
 *
 * - the **conformance kit**: drive the bridge through the canonical protocol
 *   scenarios (JSON-RPC hygiene, the initialize handshake, a full session
 *   lifecycle, the event grammar) and get a pass/fail report per rule;
 * - the **delta assembler** itself, so a test can see the canonical
 *   `ThreadEvent`s the runtime would build from the bridge's `thread/delta`
 *   stream — the exact code the daemon runs, not a re-implementation;
 * - the **JSON-RPC harness** (capture stdout, send requests, await responses)
 *   and the **calibration normalizer** that makes whole-session goldens
 *   comparable across runs by interning minted ids.
 *
 * Framework-agnostic: nothing here imports a test runner. Curated by hand —
 * named exports only, never `export *`. Value exports carry the
 * `experimental_` prefix every new plugin API member ships with (see
 * docs/api_to_audit.md); types are unprefixed.
 */
export {
  CONFORMANCE_ASSEMBLED_EVENT_METHOD,
  ConformanceClient as experimental_ConformanceClient,
  checkItemOpensBeforeDelta as experimental_checkItemOpensBeforeDelta,
  formatConformanceReport as experimental_formatConformanceReport,
  runBridgeConformance as experimental_runBridgeConformance,
} from "@bb/provider-bridge-protocol/conformance";
export type {
  BridgeConformanceTransport,
  ConformanceCheckResult,
  ConformanceReport,
  ConformanceSessionFixture,
  RunBridgeConformanceOptions,
} from "@bb/provider-bridge-protocol/conformance";

export {
  ASSEMBLER_GRAMMAR_VERSIONS,
  createDeltaAssembler as experimental_createDeltaAssembler,
  diffCumulativeText as experimental_diffCumulativeText,
} from "@bb/provider-bridge-protocol/assembler";
export type {
  AssembleDeltasArgs,
  CreateDeltaAssemblerOptions,
  DeltaAssembler,
  DiffCumulativeTextArgs,
  DiffCumulativeTextResult,
} from "@bb/provider-bridge-protocol/assembler";

export {
  assembleCapturedThreadEvents as experimental_assembleCapturedThreadEvents,
  captureBridgeJsonRpcOutput as experimental_captureBridgeJsonRpcOutput,
  createBridgeDeltaEventCollector as experimental_createBridgeDeltaEventCollector,
  createBridgeJsonRpcTestHarness as experimental_createBridgeJsonRpcTestHarness,
  describeCalibrationEvents as experimental_describeCalibrationEvents,
  normalizeCalibrationEvents as experimental_normalizeCalibrationEvents,
  toConformanceMessages as experimental_toConformanceMessages,
} from "@bb/provider-bridge-protocol/testing";
export type {
  BridgeDeltaEventCollector,
  BridgeJsonRpcId,
  BridgeJsonRpcLineHandler,
  BridgeJsonRpcObject,
  BridgeJsonRpcOutputMessage,
  BridgeJsonRpcTestHarness,
  CapturedBridgeJsonRpcOutput,
  CapturedBridgeNotification,
  NormalizeCalibrationEventsOptions,
} from "@bb/provider-bridge-protocol/testing";
