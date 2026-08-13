import type { AgentToolSpec, DirectiveId } from "./types.js";

export const ACTION_TOOL_NAMES = [
  "fs_verification_run",
  "fs_bench_run",
  "fs_firmware_materialize",
  "fs_hw_extract",
  "fs_build",
  "fs_flash",
  "fs_serial",
  "fs_probe",
] as const;

export type ActionToolName = (typeof ACTION_TOOL_NAMES)[number];

export const AGENT_TOOL_NAMES = [
  "fs_sync_status",
  "fs_sync_plan",
  "fs_findings_query",
  "fs_triage_set",
  "fs_triage_apply_policy",
  "fs_tara_query",
  "fs_requirement_write",
  "fs_ears_convert",
  "fs_verification_run",
  "fs_sbom_query",
  "fs_hbom_extract",
  "fs_hbom_review",
  "fs_bench_run",
  "fs_firmware_materialize",
  "fs_bench_status",
  "fs_doc_search",
  "fs_hw_extract",
  "fs_build",
  "fs_flash",
  "fs_serial",
  "fs_probe",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type AgentToolClass<Name extends AgentToolName> =
  Name extends ActionToolName ? "action" : "read" | "write";

export type AgentToolRegistry = {
  readonly [Name in AgentToolName]: Omit<AgentToolSpec, "name" | "class"> & {
    readonly name: Name;
    readonly class: AgentToolClass<Name>;
  };
};

export const DIRECTIVE_IDS = [
  "fs-plan",
  "fs-finding",
  "fs-triage-summary",
  "fs-threat",
  "fs-canvas",
  "fs-req",
  "fs-matrix",
  "fs-component",
  "fs-hbom-summary",
  "fs-bench",
  "fs-verdict",
  "fs-doc",
] as const;

const PAGE = { default: 50, max: 200 } as const;

// This is the canonical registry seam consumed by WP-57–WP-60. The mapped
// type makes class: "action" unrepresentable for any name outside the closed
// ActionToolName union while retaining the complete agent-surface metadata.
export const AGENT_TOOL_REGISTRY = {
  fs_sync_status: {
    name: "fs_sync_status",
    class: "read",
    server: "none",
    idempotency: "idempotent",
  },
  fs_sync_plan: {
    name: "fs_sync_plan",
    class: "read",
    server: "read-refresh",
    idempotency: "idempotent",
    directive: "fs-plan",
  },
  fs_findings_query: {
    name: "fs_findings_query",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    directive: "fs-finding",
    page: PAGE,
  },
  fs_triage_set: {
    name: "fs_triage_set",
    class: "write",
    server: "none",
    idempotency: "convergent",
  },
  fs_triage_apply_policy: {
    name: "fs_triage_apply_policy",
    class: "write",
    server: "none",
    idempotency: "convergent",
    directive: "fs-triage-summary",
  },
  fs_tara_query: {
    name: "fs_tara_query",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    directive: "fs-threat",
    page: PAGE,
  },
  fs_requirement_write: {
    name: "fs_requirement_write",
    class: "write",
    server: "none",
    idempotency: "convergent",
    directive: "fs-req",
  },
  fs_ears_convert: {
    name: "fs_ears_convert",
    class: "read",
    server: "none",
    idempotency: "idempotent",
  },
  fs_verification_run: {
    name: "fs_verification_run",
    class: "action",
    server: "invoke",
    idempotency: "non-idempotent",
  },
  fs_sbom_query: {
    name: "fs_sbom_query",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    directive: "fs-component",
    page: PAGE,
  },
  fs_hbom_extract: {
    name: "fs_hbom_extract",
    class: "write",
    server: "none",
    idempotency: "convergent",
    directive: "fs-hbom-summary",
  },
  fs_hbom_review: {
    name: "fs_hbom_review",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    page: PAGE,
  },
  fs_bench_run: {
    name: "fs_bench_run",
    class: "action",
    server: "invoke",
    idempotency: "non-idempotent",
  },
  fs_firmware_materialize: {
    name: "fs_firmware_materialize",
    class: "action",
    server: "read-fetch",
    idempotency: "convergent",
  },
  fs_bench_status: {
    name: "fs_bench_status",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    directive: "fs-verdict",
    page: PAGE,
  },
  fs_doc_search: {
    name: "fs_doc_search",
    class: "read",
    server: "none",
    idempotency: "idempotent",
    directive: "fs-doc",
    page: PAGE,
  },
  fs_hw_extract: {
    name: "fs_hw_extract",
    class: "action",
    server: "none",
    idempotency: "convergent",
  },
  fs_build: {
    name: "fs_build",
    class: "action",
    server: "none",
    idempotency: "convergent",
  },
  fs_flash: {
    name: "fs_flash",
    class: "action",
    server: "none",
    idempotency: "non-idempotent",
    destructive: true,
  },
  fs_serial: {
    name: "fs_serial",
    class: "action",
    server: "none",
    idempotency: "non-idempotent",
  },
  fs_probe: {
    name: "fs_probe",
    class: "action",
    server: "none",
    idempotency: "non-idempotent",
  },
} as const satisfies AgentToolRegistry;

export const AGENT_SURFACE = {
  tools: AGENT_TOOL_REGISTRY,
  directives: DIRECTIVE_IDS,
  mentionTriggers: {
    "@": ["fs-model", "fs-docs"],
    "#": ["fs-intel"],
    "~": ["fs-runs"],
  },
} as const satisfies Readonly<{
  tools: AgentToolRegistry;
  directives: typeof DIRECTIVE_IDS;
  mentionTriggers: Readonly<Record<"@" | "#" | "~", readonly string[]>>;
}>;

const CANONICAL_TOOL_NAMES = new Set(Object.keys(AGENT_SURFACE.tools));
const CANONICAL_ACTION_ACCESS = new Map<string, AgentToolSpec["server"]>([
  ["fs_verification_run", "invoke"],
  ["fs_bench_run", "invoke"],
  ["fs_firmware_materialize", "read-fetch"],
  ["fs_hw_extract", "none"],
  ["fs_build", "none"],
  ["fs_flash", "none"],
  ["fs_serial", "none"],
  ["fs_probe", "none"],
]);

export interface AgentToolExecutionContext {
  readonly currentTurnId: string;
  readonly instruction: Readonly<{
    readonly source: "human" | "plan";
    readonly turnId: string;
  }> | null;
}

export class DestructiveInstructionRequiredError extends Error {
  constructor(readonly toolName: AgentToolName) {
    super(
      `${toolName} requires an explicit human instruction in the current turn; plan-inherited or prior-turn intent does not count.`,
    );
    this.name = "DestructiveInstructionRequiredError";
  }
}

export function executeAgentToolWithDestructiveGate<Result>(
  toolName: AgentToolName,
  context: AgentToolExecutionContext,
  execute: () => Result,
): Result {
  const tool = AGENT_TOOL_REGISTRY[toolName];
  if (
    "destructive" in tool
    && tool.destructive === true
    && (context.instruction?.source !== "human"
      || context.instruction.turnId !== context.currentTurnId)
  ) {
    throw new DestructiveInstructionRequiredError(toolName);
  }
  return execute();
}

export interface AgentSurfaceCandidate {
  readonly tools: Readonly<Record<string, AgentToolSpec>>;
  readonly directives: readonly DirectiveId[];
}

export function assertAgentSurface(surface: AgentSurfaceCandidate): void {
  const entries = Object.entries(surface.tools);
  const actions = entries.filter(([, tool]) => tool.class === "action");
  if (
    actions.length !== CANONICAL_ACTION_ACCESS.size ||
    actions.some(
      ([name, tool]) => CANONICAL_ACTION_ACCESS.get(name) !== tool.server,
    )
  ) {
    throw new Error(
      "Agent action registry changes require a reviewed amendment; the eight-action allowlist is closed.",
    );
  }
  if (
    entries.length !== CANONICAL_TOOL_NAMES.size ||
    entries.some(([name]) => !CANONICAL_TOOL_NAMES.has(name))
  ) {
    throw new Error("Agent registry must contain exactly twenty-one canonical tools.");
  }

  const names = entries.map(([name]) => name);
  if (
    new Set(names).size !== names.length ||
    entries.some(([name, tool]) => !name.startsWith("fs_") || tool.name !== name)
  ) {
    throw new Error("Agent tool names must be unique, fs_-prefixed, and self-identifying.");
  }

  const directives = new Set(surface.directives);
  if (
    directives.size !== DIRECTIVE_IDS.length ||
    DIRECTIVE_IDS.some((directive) => !directives.has(directive)) ||
    entries.some(([, tool]) => tool.directive && !directives.has(tool.directive))
  ) {
    throw new Error("Agent registry directives must match the canonical twelve-id set.");
  }
}

assertAgentSurface(AGENT_SURFACE);
