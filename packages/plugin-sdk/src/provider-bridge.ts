/**
 * `@get-bb/plugin-sdk/provider-bridge` — the published authoring surface for a provider
 * bridge.
 *
 * A provider bridge ships inside its plugin's `bb.host` artifact, and a host
 * artifact may not import private `@bb/*` workspace packages: an external
 * plugin cannot resolve them. Everything a bridge needs therefore has to be
 * reachable through this package, which is why this module exists — it is the
 * bridge half of the same facade the root export already is for
 * `BbPluginApi`/`@bb/domain` types.
 *
 * Curated by hand, never `export *`. The list below is the surface bb promises
 * bridge authors; a name that is not here is bb-internal and may move. It is
 * grouped the way a bridge consumes it:
 *
 *   1. the bridge entry contract (how a module declares itself a bridge),
 *   2. the protocol — request/notification vocabulary, the `thread/delta`
 *      grammar, and param schemas,
 *   3. the bridge kit — the authoring helpers (JSON-RPC framing, tool-call and
 *      interaction codecs, visibility, dialect-parsing helpers),
 *   4. the domain vocabulary the protocol's payloads reference.
 *
 * On (4): the protocol owns its own timeline vocabulary (the delta grammar in
 * section 2) — bridges no longer construct `ThreadEvent`s, so the domain
 * event vocabulary is NOT re-exported here. What remains from `@bb/domain` is
 * the command-plane and interaction surface the protocol's params are made of
 * (PromptInput, permission/interaction payloads, dynamic tools, rate limits,
 * reasoning levels) plus the enum/status types the delta shapes reference
 * (item status, turn status, plan steps, usage breakdowns). Those live in
 * `@bb/domain` — bb's persisted vocabulary shared by the server, the app and
 * the runtime — so the SDK names them here and the published bundle inlines
 * them, exactly as the root export already does for `PromptInput` and
 * friends.
 *
 * Runtime, not stubs: unlike `@get-bb/plugin-sdk` and `@get-bb/plugin-sdk/host`
 * — whose host-artifact members are build-time stubs because their real
 * implementations belong to the server — everything here is pure schema and
 * pure helper code with no daemon-pinned behavior, so a bridge artifact simply
 * bundles it.
 */

// ---------------------------------------------------------------------------
// 1. The bridge entry contract
// ---------------------------------------------------------------------------

export {
  PROVIDER_BRIDGE_EXPORT_NAME,
  experimental_defineProviderBridge,
} from "@bb/provider-bridge-protocol/bridge-kit";
export type {
  ProviderBridgeContext,
  ProviderBridgeDefinition,
  ProviderBridgeEntry,
} from "@bb/provider-bridge-protocol/bridge-kit";

// ---------------------------------------------------------------------------
// 2. The Provider Bridge Protocol
// ---------------------------------------------------------------------------

export {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V2,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  bridgeCapabilitiesSchema,
  bridgeGrammarVersionsSchema,
  bridgeSteerModeSchema,
  deltaBackgroundTaskShapeSchema,
  deltaDelegationShapeSchema,
  deltaExtensionShapeSchema,
  deltaFileChangeSchema,
  deltaFileReadShapeSchema,
  deltaItemKeySchema,
  deltaItemShapeSchema,
  deltaNoTurnFallbackSchema,
  deltaOutputChannelSchema,
  deltaPlanStepsShapeSchema,
  deltaPresentationSchema,
  deltaProgressSnapshotSchema,
  deltaSearchShapeSchema,
  deltaTextChannelSchema,
  providerRecoveryNotificationSchema,
  threadDeltaNotificationParamsSchema,
  threadDeltaSchema,
  initializeParamsSchema,
  modelListParamsSchema,
  experimental_providerHealthResultSchema,
  experimental_providerHealthSchema,
  experimental_providerInstallationActionKindSchema,
  experimental_providerInstallationActionSchema,
  experimental_providerInstallationCommandSchema,
  experimental_providerInstallationRunParamsSchema,
  experimental_providerInstallationStatusParamsSchema,
  experimental_providerInstallationRequirementSchema,
  experimental_providerInstallationRunResultSchema,
  experimental_providerInstallationSourceSchema,
  experimental_providerInstallationStatusSchema,
  experimental_providerInstallationVerificationSchema,
  experimental_providerMaintenanceParamsSchema,
  experimental_providerUsageResultSchema,
  experimental_providerUsageSchema,
  experimental_providerUsageWindowSchema,
  skillsConfigureParamsSchema,
  threadArchiveParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadGoalClearParamsSchema,
  threadNameSetParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  threadUnarchiveParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
} from "@bb/provider-bridge-protocol";
export type {
  BridgeCapabilities,
  BridgeExecutionOptions,
  BridgeGrammarVersions,
  BridgeSteerMode,
  DeltaBackgroundTaskShape,
  DeltaDelegationShape,
  DeltaExtensionShape,
  DeltaFileChange,
  DeltaFileReadShape,
  DeltaItemKey,
  DeltaItemShape,
  DeltaItemShapeType,
  DeltaNoTurnFallback,
  DeltaOutputChannel,
  DeltaPlanStepsShape,
  DeltaPresentation,
  DeltaProgressSnapshot,
  DeltaSearchShape,
  DeltaTextChannel,
  ProviderRecoveryNotification,
  ExperimentalProviderHealth,
  ExperimentalProviderHealthResult,
  ExperimentalProviderInstallationAction,
  ExperimentalProviderInstallationActionKind,
  ExperimentalProviderInstallationCommand,
  ExperimentalProviderInstallationRunParams,
  ExperimentalProviderInstallationRunResult,
  ExperimentalProviderInstallationRequirement,
  ExperimentalProviderInstallationSource,
  ExperimentalProviderInstallationStatus,
  ExperimentalProviderInstallationStatusParams,
  ExperimentalProviderInstallationVerification,
  ExperimentalProviderMaintenanceParams,
  ExperimentalProviderUsage,
  ExperimentalProviderUsageResult,
  ExperimentalProviderUsageWindow,
  InitializeResult,
  ThreadDelta,
  ThreadDeltaKind,
  ThreadDeltaNotificationParams,
} from "@bb/provider-bridge-protocol";

// ---------------------------------------------------------------------------
// 3. The bridge kit
// ---------------------------------------------------------------------------

export {
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  bashArgsSchema,
  bridgeRequestEnvelopeSchema,
  buildBridgeToolCallContent as experimental_buildBridgeToolCallContent,
  buildShellEnvOverrides,
  createBridgeIo,
  createBridgeLineHandler,
  createPendingToolCallTracker,
  createProviderVisibilityMetadata,
  decodeBridgeJsonRpcResponse,
  decodeToolCallResponsePayload,
  errorEnvelopeSchema,
  experimental_isProviderBridgeRecording,
  experimental_recordProviderChildIo,
  extractResultText,
  getRawSdkMessage,
  getRecordProperty,
  getStringProperty,
  isRecord,
  jsonRpcEnvelopeSchema,
  mimeTypeFromExtension,
  normalizeProviderCommandOutput,
  runBridgeRequest,
  sdkMessageEnvelopeSchema,
  shouldAutoDenyInteractiveRequest,
  textBlockSchema,
  threadContextWindowUsageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toNonNegativeNumber,
  toOptionalRecord,
  toOptionalString,
  withoutBridgeRuntimeEnv,
  ProviderRequestDecodeError,
  ProviderResponseEncodeError,
} from "@bb/provider-bridge-protocol/bridge-kit";
export type {
  BridgeJsonRpcResponse,
  BridgeToolCallRequest,
  BuildInteractiveResponseArgs,
  DecodedInteractiveRequest,
  JsonRpcMessage,
  PreparedProviderCommandDispatch,
  ProviderInboundRequest,
  ProviderPostInitializeRequest,
  ProviderRawEventCoverage,
  ProviderRawEventDescription,
  ProviderRuntimeEvent,
  ProviderVisibilityMetadata,
} from "@bb/provider-bridge-protocol/bridge-kit";

/**
 * A bridge that supervises child processes builds their environment with this
 * one allowlist function rather than handing them the daemon's own env
 * (incident rule: ambient env leaks).
 */
export { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";

/**
 * The ACP launch spec: the one core wire shape a bridge parses directly. It
 * arrives as provider-scoped static options (opaque to the runtime, meaningful
 * only to the bridge that declares the ACP tier), so its schema has to be
 * reachable from bridge code.
 */
export {
  hostDaemonAcpLaunchSpecSchema,
  normalizeHostDaemonAcpLaunchSpec,
} from "@bb/host-daemon-contract";
export type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";

// ---------------------------------------------------------------------------
// 4. The domain vocabulary the protocol's payloads reference
// ---------------------------------------------------------------------------

export {
  HIGH_REASONING_EFFORT,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  XHIGH_REASONING_EFFORT,
  acpNativeReasoningSchema,
  acpPermissionCliSchema,
  acpReasoningCliSchema,
  backgroundTaskItemStatus,
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
  dynamicToolSchema,
  instructionModeValues,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isBackgroundAgentTaskType,
  isSettledBackgroundTaskStatus,
  isStandaloneBuiltinCompactCommand,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
  jsonValueSchema,
  pendingInteractionCommandActionSchema,
  pendingInteractionFileSystemPermissionsSchema,
  pendingInteractionMacOsPermissionsSchema,
  pendingInteractionNetworkPermissionsSchema,
  pendingInteractionRequestedPermissionProfileSchema,
  pendingInteractionResolutionSchema,
  permissionEscalationValues,
  extensionKindSchema,
  interactionRequestPayloadSchema,
  isExtensionKind,
  providerRawEventSchema,
  providerRecoveryKindSchema,
  providerRecoveryKindValues,
  threadEventItemPresentationSchema,
  threadEventSearchModeSchema,
  reasoningEffortsForLevels,
  reasoningLevelSchema,
  reasoningLevelValues,
  removeCommandMentionsFromPromptInput,
  runtimePermissionScopeValues,
  toPositiveNumber,
} from "@bb/domain";
export type {
  ApprovalPendingInteractionPayload,
  AvailableModel,
  BackgroundTaskStatus,
  BackgroundTaskUsage,
  ClaudeTaskToolOutput,
  ClientTurnRequestId,
  DynamicTool,
  ExtensionKind,
  InstructionMode,
  InteractionRequestPayload,
  JsonObject,
  JsonValue,
  ModelReasoningEffort,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionCommandAction,
  PendingInteractionGrantablePermissionProfile,
  PendingInteractionGrantedPermissionProfile,
  PendingInteractionPayload,
  PendingInteractionRequestedPermissionProfile,
  PendingInteractionResolution,
  PendingInteractionUserQuestionQuestion,
  PermissionEscalation,
  PermissionMode,
  PromptInput,
  ProviderErrorCategory,
  ProviderErrorInfo,
  ProviderRawEvent,
  ProviderRateLimitState,
  ProviderRateLimitStatus,
  ProviderRateLimitWindow,
  ProviderRecoveryKind,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimePermissionScope,
  ServiceTier,
  ThreadEventContextWindowUsage,
  ThreadEventItemPresentation,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
  ThreadEventSearchMode,
  ThreadEventTokenUsageBreakdown,
  ThreadEventTurnStatus,
  ThreadEventUserContent,
  UserQuestionPendingInteractionPayload,
  UserQuestionPendingInteractionResolution,
  WorkflowAgentSnapshot,
  WorkflowAgentState,
  WorkflowPhaseSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
