// @bb/workflow-runtime — the deterministic workflow script runtime (omegacode's
// mined core with injected Worker/JournalStore/onRunEvent seams). Pure of bb
// server/daemon machinery by design: embedders inject providers and storage.

export {
  runInSandbox,
  WorkflowAbortedError,
  WorkflowTimeoutError,
} from "./sandbox.js";
export type { RunInSandboxOptions } from "./sandbox.js";

export {
  parseMeta,
  parseMetaLiteral,
  parseWorkflow,
  WorkflowSyntaxError,
} from "./meta-parser.js";
export type { MetaLiteralValue, ParsedWorkflow } from "./meta-parser.js";

export {
  KEY_VERSION,
  ROOT_KEY,
  branchKey,
  canonical,
  chainKey,
  determinismLint,
  explicitKey,
  keyedSpec,
} from "./keys.js";
export type { KeyedFields, KeyedSpecInput, LintFinding } from "./keys.js";

export {
  addUsage,
  agentStatusSchema,
  agentStatusValues,
  emptyUsage,
  metaPhaseSchema,
  metaSchema,
  permissionModeForWorkflowSandbox,
  workflowSandboxSchema,
  workflowSandboxValues,
} from "./dsl-types.js";
export type {
  AgentOpts,
  AgentResult,
  AgentSpec,
  AgentStatus,
  AgentUsage,
  JSONSchema,
  Meta,
  MetaPhase,
  PipelineStage,
  RunDefaults,
  WorkflowBudget,
  WorkflowGlobals,
  WorkflowSandbox,
} from "./dsl-types.js";

export { AgentError, AgentInterrupted } from "./worker-contract.js";
export type {
  AgentErrorArgs,
  Worker,
  WorkerContext,
  WorkerProgress,
} from "./worker-contract.js";

export { withRetry } from "./errors.js";
export type { WithRetryOptions } from "./errors.js";

export {
  assertValidSchema,
  parseJsonLoose,
  stripNullOptionals,
  toClaudeOutputFormat,
  toCodexOutputSchema,
  validate,
} from "./schema.js";
export type { ClaudeOutputFormat, SchemaValidationResult } from "./schema.js";

export { Semaphore } from "./semaphore.js";

export { InMemoryJournalStore } from "./journal.js";
export type { JournalStore, WorkflowJournalEntry } from "./journal.js";

export { AgentFailedError, Runtime, WorkflowError } from "./runtime.js";
export type {
  AgentEventMeta,
  RunEventSink,
  RuntimeOptions,
  WorkflowRunEvent,
} from "./runtime.js";

export { FakeWorker } from "./fake-worker.js";
export type { FakeWorkerOptions } from "./fake-worker.js";

export {
  runWorkflowRunner,
  WORKFLOW_HEARTBEAT_INTERVAL_MS,
  WORKFLOW_HEARTBEAT_STALE_MS,
} from "./runner-entry.js";
export type {
  WorkflowRunnerConfig,
  WorkflowRunOutcome,
  WorkflowRunStatus,
} from "./runner-entry.js";

export {
  BUILTIN_WORKFLOW_NAMES,
  listBuiltinWorkflows,
  readBuiltinWorkflow,
} from "./builtins.js";
export type { BuiltinWorkflow, BuiltinWorkflowName } from "./builtins.js";

export {
  resolveWorkflowRunnerProcessArgs,
  WORKFLOW_RUNNER_BUNDLE_FILE_NAME,
} from "./runner-path.js";
export type { ResolveWorkflowRunnerProcessArgsOptions } from "./runner-path.js";

export {
  agentResultSchema,
  agentSpecSchema,
  agentUsageSchema,
  decodeWorkflowRunnerChildInboundLine,
  decodeWorkflowRunnerDaemonInboundLine,
  encodeWorkflowRunnerAbort,
  encodeWorkflowRunnerAgentProgress,
  encodeWorkflowRunnerAgentRunRequest,
  encodeWorkflowRunnerAgentRunResult,
  encodeWorkflowRunnerError,
  encodeWorkflowRunnerRunEvent,
  encodeWorkflowRunnerStartRequest,
  encodeWorkflowRunnerStartResult,
  runDefaultsSchema,
  workflowJournalEntrySchema,
  workflowRunEventSchema,
  workflowRunnerAgentProgressParamsSchema,
  workflowRunnerAgentProgressSchema,
  workflowRunnerAgentRunParamsSchema,
  workflowRunnerAgentRunResultSchema,
  workflowRunnerStartParamsSchema,
  workflowRunnerStartResultSchema,
} from "./runner-protocol.js";
export type {
  WorkflowRunnerAgentProgress,
  WorkflowRunnerAgentProgressParams,
  WorkflowRunnerAgentRunParams,
  WorkflowRunnerAgentRunResult,
  WorkflowRunnerChildInboundMessage,
  WorkflowRunnerDaemonInboundMessage,
  WorkflowRunnerStartParams,
  WorkflowRunnerStartResult,
  WorkflowRunnerWireId,
} from "./runner-protocol.js";
