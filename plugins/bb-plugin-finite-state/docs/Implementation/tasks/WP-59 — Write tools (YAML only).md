# WP-59 — Write tools (YAML only)

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 02 §6.2 · SPEC 03 §6.2 · SPEC 04 §5.2 · SPEC 06 §2.1, §4.4, §5 · **Effort:** 3 d · **Status:** unassigned
**Depends on:** WP-57, WP-27, WP-28, WP-36, WP-44, WP-46 · **Blocks:** WP-63, WP-65
**Produces a FROZEN artifact:** no

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/tools/write.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/write-schemas.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/write.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/write.integration.test.ts
```

## Files you must not touch
Composition roots, frozen interfaces, surface serializers/merge engines, action/read modules, panel code, skills, CLI, package metadata, lockfiles, or fixture corpus.

## Context
Four canonical tools let an agent propose decisions: `fs_triage_set`, `fs_triage_apply_policy`, `fs_requirement_write`, and `fs_hbom_extract`; the registry also classifies their exact results and invariants. Every write terminates in tracked local YAML through the owning lane's CAS/merge service. Nothing in this WP calls Forge, updates AS, resolves a human queue, or writes derived state. A successful tool call means “proposal written locally,” never “applied.”

## What to build
1. Register the four write tools with strict schemas and explicit descriptions saying “local YAML only; a human reviews and pushes.”
2. Delegate all semantics to owning services: VEX vocabulary/pin enforcement to triage; policy holdbacks to policy engine; EARS/schema/slug validation to requirements; provenance precedence/candidate creation to HBOM merge.
3. Require CAS inputs or have the owner service read-and-compare immediately before atomic replace. A concurrent writer returns a retryable `cas_mismatch`; never last-write-wins.
4. `fs_triage_set` validates six statuses, response/justification rules, evidence, and stable-key resolution. Force `exact_version` for `CODE_NOT_REACHABLE`; identical desired state returns `noop`.
5. `fs_triage_apply_policy` exposes `dryRun` but not `overwrite_existing`. Existing human/vendor/manual decisions and KEV holdbacks cannot be overridden by arguments.
6. `fs_requirement_write` accepts the full desired YAML object/text, validates Gate 1 (schema) and Gate 2 (deterministic lint) locally, rejects derived/server-owned fields, and writes nothing if either automated gate fails. Gate 3 is an explicit human diff review and remains pending after a successful tool call.
7. `fs_hbom_extract` caps a call at 500 cells. Agent claims remain proposals; conflicts create candidate records; no input can set `accepted`, `provenance:human`, or review status.
8. Return relative paths, operation/diff summaries, counts, and item-wise rejections. Never echo entire YAML files.
9. Publish tiny realtime invalidation hints after commits; payloads contain ids/paths only and consumers refetch.

## Interface contract
```ts
export function registerWriteTools(bb: BbPluginApi, ctx: PluginContext): void;

type LocalWrite = {
  path: string;
  op: "create" | "update" | "noop";
  diffSummary: Array<{ field: string; from: string | null; to: string | null }>;
  contentHash: string;
};

interface TriageWriter {
  set(input: TriageSetInput): Promise<LocalWrite>;
  applyPolicy(input: PolicyInput): Promise<{
    paths: string[];
    written: number;
    held: Array<{ key: string; rule: string; why: string }>;
    skippedExisting: number;
    errors: ToolError[];
    runId: string;
  }>;
}

interface RequirementWriter {
  write(input: { reqId: string; yaml: unknown; expectedHash?: string }): Promise<LocalWrite>;
}

interface HbomExtractor {
  merge(input: HbomExtractionInput): Promise<{
    path: string;
    merged: number;
    queued: number;
    conflicts: number;
    candidatesAdded: number;
    rejected: Array<{ cell: string; error: ToolError }>;
  }>;
}
```

## Acceptance criteria
- [ ] Every handler imports zero remote client/action modules; a static test enforces the boundary.
- [ ] All writes go through the owner lane's atomic CAS/merge API and target tracked YAML.
- [ ] Triage identity uses stable keys; no finding UUID appears in a write schema.
- [ ] `CODE_NOT_REACHABLE` cannot be persisted with `any_version`.
- [ ] Policy calls cannot overwrite an existing decision or bypass KEV holdback.
- [ ] Requirement Gates 1–2 are all-or-nothing and reject `verification_status` plus every frozen exclusion; the result explicitly reports Gate 3 as pending human review.
- [ ] HBOM agent input cannot mark a cell accepted/human; disagreements enter the review queue.
- [ ] Tool responses name touched paths and bounded diffs without dumping file contents.
- [ ] Realtime events are refetch hints, not domain payloads.

## Test plan
`write.test.ts`
- `triage identical tuple returns noop`.
- `CODE_NOT_REACHABLE forces exact pin`; incompatible pin returns recovery-shaped error.
- `policy holds KEV and skips existing decisions`.
- `requirement validation error leaves file byte-identical` (**error path**).
- `valid requirement passes Gates 1–2 but cannot mark human Gate 3 complete` (**safety path**).
- `HBOM extraction rejects accepted/provenance human input`.

`write.integration.test.ts`
- `callAgentTool writes YAML, updates watcher index, and status reports local change`.
- `two writers with same expected hash yield one success and one cas_mismatch` (**concurrency path**).
- `partial HBOM batch reports each rejected cell while committing valid proposals atomically per merge contract`.
- `module graph contains no remote write/action import` (**safety path**).

## Do not
- Do not call Platform/AS/Forge compute, push, resolve conflicts, accept HBOM cells, or record attestations.
- Do not expose `overwrite_existing`, arbitrary paths, raw YAML destinations, or server UUID identity.
- Do not partially write a requirement that fails validation.
- Do not infer evidence, source refs, ids, or confidence values on the agent's behalf.
- Do not claim a local write changed the system of record.

## Open questions
1. If owner services expose different CAS tokens, normalize their failure to `cas_mismatch` while preserving domain details.
2. Decide during implementation whether `fs_requirement_write.yaml` is a parsed object or YAML string; support one canonical input, not two drifting paths.
