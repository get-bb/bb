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
 *   2. the protocol — request/notification vocabulary and param schemas,
 *   3. the bridge kit — the authoring helpers (JSON-RPC framing, tool-call and
 *      interaction codecs, id scoping, visibility, translation helpers),
 *   4. the event vocabulary the protocol's payloads are made of.
 *
 * On (4): those shapes live in `@bb/domain`, which is bb's persisted-thread
 * vocabulary shared by the server, the app and the runtime — moving it into
 * this package would invert the dependency and make the plugin SDK own the
 * product's core domain. So the SDK names them here instead, and the published
 * bundle inlines them, exactly as the root export already does for
 * `PromptInput` and friends. See `docs/api_to_audit.md` for the audit this
 * owes before the surface stabilizes.
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
  initializeParamsSchema,
  modelListParamsSchema,
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
  threadEventNotificationSchema,
} from "@bb/provider-bridge-protocol";
export type {
  BridgeExecutionOptions,
  InitializeResult,
} from "@bb/provider-bridge-protocol";

// ---------------------------------------------------------------------------
// 3. The bridge kit
// ---------------------------------------------------------------------------

export {
  UNSTAMPED_THREAD_ID,
  bashArgsSchema,
  bridgeRequestEnvelopeSchema,
  buildAcceptedUserMessageEvent,
  buildEditDiff,
  buildShellEnvOverrides,
  buildFileChangeItem,
  buildGenericToolCallItem,
  buildToolResultItem,
  buildUnhandledProviderEvents,
  completeStartedToolItem,
  createBridgeIo,
  createBridgeLineHandler,
  createPendingToolCallTracker,
  createProviderTurnStateRegistry,
  createProviderVisibilityMetadata,
  createScopedItemIdFactory,
  createUnhandledProviderEvent,
  decodeBridgeJsonRpcResponse,
  decodeToolCallResponsePayload,
  errorEnvelopeSchema,
  extractResultText,
  getRawSdkMessage,
  getRecordProperty,
  getStringProperty,
  isRecord,
  jsonRpcEnvelopeSchema,
  mimeTypeFromExtension,
  normalizeProviderCommandOutput,
  queueAcceptedUserMessage,
  resolveProviderTerminalTurn,
  runBridgeRequest,
  sdkMessageEnvelopeSchema,
  shouldAutoDenyInteractiveRequest,
  textBlockSchema,
  threadContextWindowUsageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
  toNonNegativeNumber,
  toOptionalRecord,
  toOptionalString,
  withParentToolCallId,
  withoutBridgeRuntimeEnv,
  ProviderRequestDecodeError,
  ProviderResponseEncodeError,
} from "@bb/provider-bridge-protocol/bridge-kit";
export type {
  AcceptedUserMessageState,
  BridgeJsonRpcResponse,
  BridgeToolCallRequest,
  BuildInteractiveResponseArgs,
  DecodedInteractiveRequest,
  EnsureProviderTurnStartedArgs,
  JsonRpcMessage,
  PreparedProviderCommandDispatch,
  ProviderInboundRequest,
  ProviderPostInitializeRequest,
  ProviderRawEventCoverage,
  ProviderRawEventDescription,
  ProviderRuntimeEvent,
  ProviderTurnStateRegistry,
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
// 4. The event vocabulary
// ---------------------------------------------------------------------------

export {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  HIGH_REASONING_EFFORT,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  LOW_REASONING_EFFORT,
  MAX_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  NONE_REASONING_EFFORT,
  ULTRACODE_REASONING_EFFORT,
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  XHIGH_REASONING_EFFORT,
  acpNativeReasoningSchema,
  acpPermissionCliSchema,
  acpReasoningCliSchema,
  backgroundTaskItemStatus,
  claudeCodeMockCliTrafficConfigSchema,
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
  createStandaloneBuiltinCompactCommandInput,
  dynamicToolSchema,
  getThreadEventScopeTurnId,
  instructionModeValues,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isBackgroundAgentTaskType,
  isClaudeCodeMockCliTrafficEndpoint,
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
  reasoningEffortsForLevels,
  reasoningLevelSchema,
  reasoningLevelValues,
  removeCommandMentionsFromPromptInput,
  requireThreadEventScopeTurnId,
  runtimePermissionScopeValues,
  threadScope,
  toPositiveNumber,
  turnScope,
} from "@bb/domain";
export type {
  ApprovalPendingInteractionPayload,
  AvailableModel,
  BackgroundTaskStatus,
  BackgroundTaskUsage,
  ClaudeCodeMockCliTrafficConfig,
  ClaudeTaskToolOutput,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
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
  ProviderRateLimitState,
  ProviderRateLimitStatus,
  ProviderRateLimitWindow,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimePermissionScope,
  ServiceTier,
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventContextWindowUsage,
  ThreadEventItem,
  ThreadEventItemApprovalStatus,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
  ThreadEventScope,
  ThreadEventTokenUsage,
  ThreadEventTokenUsageBreakdown,
  ThreadEventTurnStatus,
  ThreadEventUserContent,
  ThreadEventWebFetchItem,
  ThreadEventWebSearchItem,
  UserQuestionPendingInteractionPayload,
  UserQuestionPendingInteractionResolution,
  WorkflowAgentSnapshot,
  WorkflowAgentState,
  WorkflowPhaseSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
