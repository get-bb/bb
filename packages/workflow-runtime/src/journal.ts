// The resume journal seam, replacing omegacode's file-backed journal.jsonl
// (src/runtime/journal.ts). In bb the authoritative journal is the server's
// `workflow_run_events` table; the runner receives a JournalStore rebuilt from
// it (daemon-side hot cache in M2, in-memory in tests) and appends every
// settled agent. Run-wide resume preconditions (file hash, args, key version)
// moved to the server's source snapshot, so this module carries only the
// per-agent entries.

import type { AgentProviderId } from "@bb/agent-providers";
import type { JsonValue } from "@bb/domain";
import type { AgentStatus, AgentUsage } from "./dsl-types.js";

/**
 * One settled agent() call — the payload of an `agent/completed` run event and
 * the unit of resume replay. Entries with status `completed` replay instantly
 * on resume; failed/interrupted entries never replay (the agent re-runs) but
 * still pin the agent's display index and record the billed usage.
 */
export interface WorkflowJournalEntry {
  /** The chained resume key (see keys.ts). */
  key: string;
  /** Journal-stable display index — reused on resume so events keep pointing at the same logical agent. */
  agentIndex: number;
  /** Lineage of the branch the agent ran in (diagnostics; see keys.ts). */
  branchKey: string;
  status: AgentStatus;
  /** Final assistant text ("" when the agent settled without producing any). */
  resultText: string;
  /** Present only for schema'd calls: the validated structured value (the agent's return value). */
  structured?: JsonValue;
  usage: AgentUsage;
  provider: AgentProviderId;
  /** The resolved model override, when the spec carried one. */
  model?: string;
  /** Where preserved worktree edits live, when the agent ran in a worktree that changed. */
  worktreeBranch?: string;
  durationMs: number;
}

/**
 * Storage seam for the resume journal. The runtime reads `list()` once at
 * construction (replay) and calls `append()` once per non-replayed settle.
 * Replayed (cached) agents are not re-appended — their entries already exist.
 */
export interface JournalStore {
  append(entry: WorkflowJournalEntry): void;
  /** All entries, oldest first. Duplicate keys are resolved last-wins by the reader. */
  list(): readonly WorkflowJournalEntry[];
}

export class InMemoryJournalStore implements JournalStore {
  private readonly entries: WorkflowJournalEntry[] = [];

  append(entry: WorkflowJournalEntry): void {
    this.entries.push(entry);
  }

  list(): readonly WorkflowJournalEntry[] {
    return [...this.entries];
  }
}
