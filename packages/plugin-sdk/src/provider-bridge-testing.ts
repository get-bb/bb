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
 *   comparable across runs by interning minted ids;
 * - the **recorded-replay harness**: replay a recording bb made of the
 *   bridge (record mode, `BB_PROVIDER_BRIDGE_RECORD_DIR`) through the bridge
 *   again — the recorded runtime lane driven in, the recorded provider lanes
 *   played by the replay child the bridge spawns in place of its provider —
 *   and diff what it emits against the recording (`experimental_compareParity`),
 *   judge it with the recorded-cell conformance rules, or write the bridge's
 *   current output beside the recording (`experimental_rerecordCurrentBridgeLane`).
 *   Keyed by the caller's provider id and bridge module, never by a list of
 *   the providers bb ships.
 *
 * Framework-agnostic: nothing here imports a test runner. Curated by hand —
 * named exports only, never `export *`. Value exports carry the
 * `experimental_` prefix every new plugin API member ships with (see
 * docs/api_to_audit.md); types are unprefixed.
 */
export {
  CONFORMANCE_ASSEMBLED_EVENT_METHOD,
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

export {
  checkRecordedCellReplay as experimental_checkRecordedCellReplay,
  RECORDED_CONFORMANCE_CELLS,
} from "@bb/provider-bridge-protocol/conformance";
export type {
  RecordedCellReplay,
  RecordedConformanceCell,
} from "@bb/provider-bridge-protocol/conformance";

export {
  assembleRecordedEvents as experimental_assembleRecordedEvents,
  compareParity as experimental_compareParity,
  CURRENT_BRIDGE_LANE_FILE,
  DEFAULT_REPLAY_PROFILE,
  listRecordedCells as experimental_listRecordedCells,
  PARITY_INITIALIZE_ID,
  readBridgeRecording as experimental_readBridgeRecording,
  replayRecording as experimental_replayRecording,
  rerecordCurrentBridgeLane as experimental_rerecordCurrentBridgeLane,
  resolveProviderBridgeLaunch as experimental_resolveProviderBridgeLaunch,
  withCurrentBridgeLane as experimental_withCurrentBridgeLane,
} from "@bb/provider-bridge-protocol/testing";
export type {
  BridgeRecording,
  BridgeRecordingManifest,
  CreateParityAssembler,
  ParityAllowlistEntry,
  ParityAssembler,
  ParityComparison,
  ParityGrammarViolation,
  ParityInputs,
  ParityLayerDiff,
  ParityRowProjector,
  ParityRun,
  ProviderBridgeLaunch,
  RecordedCell,
  ReplayDialect,
  ReplayProviderProfile,
  ReplayRecordedCellsOptions,
  ReplayRecordingOptions,
  RerecordCurrentBridgeLaneOptions,
  RerecordCurrentBridgeLaneResult,
  ResolveProviderBridgeLaunchOptions,
} from "@bb/provider-bridge-protocol/testing";
export type {
  BridgeRecordingDirection,
  BridgeRecordingEntry,
} from "@bb/provider-bridge-protocol/bridge-kit";

// The canonical event vocabulary, by name. A bridge never constructs these
// (the assembler does), but a bridge's tests assert on what the assembler
// built — `ThreadEvent` is what every collector, replay and parity function
// here returns, and the item and presentation types are what an assertion
// narrows to. Re-exported from bb's domain package and inlined into the
// published declarations, like `PromptInput` on the root entry.
export type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventDelegationItem,
  ThreadEventExtensionItem,
  ThreadEventFileReadItem,
  ThreadEventItem,
  ThreadEventItemPresentation,
  ThreadEventItemPresentationIcon,
  ThreadEventItemPresentationLabel,
  ThreadEventItemPresentationTint,
  ThreadEventPlanStepsItem,
  ThreadEventSearchItem,
  ThreadEventWebFetchItem,
  ThreadEventWebSearchItem,
} from "@bb/domain";
