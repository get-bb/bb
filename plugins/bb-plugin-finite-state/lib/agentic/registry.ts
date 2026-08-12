export const ACTION_TOOL_NAMES = [
  "fs_verification_run",
  "fs_bench_run",
  "fs_firmware_materialize",
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
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type AgentToolClass<Name extends AgentToolName> =
  Name extends ActionToolName ? "action" : "read" | "write";

export type AgentToolRegistry = {
  readonly [Name in AgentToolName]: {
    readonly name: Name;
    readonly class: AgentToolClass<Name>;
  };
};

// This is the canonical registry seam consumed by WP-57–WP-60. The mapped
// type makes class: "action" unrepresentable for any name outside the closed
// ActionToolName union.
export const AGENT_TOOL_REGISTRY = {
  fs_sync_status: { name: "fs_sync_status", class: "read" },
  fs_sync_plan: { name: "fs_sync_plan", class: "read" },
  fs_findings_query: { name: "fs_findings_query", class: "read" },
  fs_triage_set: { name: "fs_triage_set", class: "write" },
  fs_triage_apply_policy: {
    name: "fs_triage_apply_policy",
    class: "write",
  },
  fs_tara_query: { name: "fs_tara_query", class: "read" },
  fs_requirement_write: { name: "fs_requirement_write", class: "write" },
  fs_ears_convert: { name: "fs_ears_convert", class: "read" },
  fs_verification_run: { name: "fs_verification_run", class: "action" },
  fs_sbom_query: { name: "fs_sbom_query", class: "read" },
  fs_hbom_extract: { name: "fs_hbom_extract", class: "write" },
  fs_hbom_review: { name: "fs_hbom_review", class: "read" },
  fs_bench_run: { name: "fs_bench_run", class: "action" },
  fs_firmware_materialize: {
    name: "fs_firmware_materialize",
    class: "action",
  },
  fs_bench_status: { name: "fs_bench_status", class: "read" },
  fs_doc_search: { name: "fs_doc_search", class: "read" },
} as const satisfies AgentToolRegistry;
