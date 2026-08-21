type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = boolean | JsonObject;

interface ExplicitModelSelection {
  provider: string;
  model: string;
  reasoningLevel: string;
}

export interface WorkflowAgentOptions {
  selection: ExplicitModelSelection | null;
  outputSchema: JsonSchema | null;
  title: string | null;
  phase: string | null;
}

interface WorkflowPhase {
  title: string;
  detail: string | null;
}

interface WorkflowMetadata {
  name: string;
  description: string;
  inputSchema: JsonSchema | null;
  outputSchema: JsonSchema | null;
  phases: WorkflowPhase[];
}

export interface ParsedWorkflow {
  metadata: WorkflowMetadata;
  body: string;
}

export interface WorkflowRuntimeLimits {
  memoryLimitBytes: number;
  maxStackBytes: number;
  synchronousDeadlineMs: number;
  maxAgentCalls: number;
  maxConcurrentAgents: number;
}

type WorkflowDepth = 0 | 1;

export type WorkflowReference =
  | string
  | { name: string }
  | { script: string }
  | { scriptPath: string };

export interface WorkflowBudgetSnapshot {
  [key: string]: JsonValue;
  agentCalls: number;
  activeAgents: number;
  queuedAgents: number;
  maxAgentCalls: number;
  maxConcurrentAgents: number;
  totalTokens: null;
}

export interface WorkflowExecutionScheduler {
  readonly limits: Readonly<WorkflowRuntimeLimits>;
  budget(): WorkflowBudgetSnapshot;
}

export interface NestedWorkflowContext {
  signal: AbortSignal;
  limits: Readonly<WorkflowRuntimeLimits>;
  scheduler: WorkflowExecutionScheduler;
  depth: 1;
}

export interface WorkflowCapabilities {
  agent(
    prompt: string,
    options: WorkflowAgentOptions,
    signal: AbortSignal,
  ): Promise<JsonValue>;
  workflow?(
    nameOrRef: WorkflowReference,
    args: JsonValue,
    context: NestedWorkflowContext,
  ): Promise<JsonValue>;
  log(message: string): void;
  phase(title: string): void;
}

export interface ExecuteWorkflowScriptArgs {
  args: JsonValue;
  body: string;
  capabilities: WorkflowCapabilities;
  limits?: Partial<WorkflowRuntimeLimits>;
  signal?: AbortSignal;
  depth?: WorkflowDepth;
  scheduler?: WorkflowExecutionScheduler;
}
