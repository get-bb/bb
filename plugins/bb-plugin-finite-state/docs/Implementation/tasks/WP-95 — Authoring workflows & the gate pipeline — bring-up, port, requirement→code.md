# WP-95 — Authoring workflows & the gate pipeline — bring-up, port, requirement→code

**Lane:** L10 Firmware Authoring & Bench Loop · **Spec refs:** SPEC 08 §4.3, §9.4 · AMD-0011 (`authoring.*`), AMD-0012 (`authoringGate`) · ADR — bb Is Not Modified · Master Plan §5.2 fact 3, risk R15 · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-85, WP-86 · **Blocks:** WP-98
**Produces a FROZEN artifact:** no — implements the `authoringGate` entity registered by AMD-0012/WP-71 and exports workflow/gate services for WP-96's surfaces

## Files you own

    plugins/bb-plugin-finite-state/lanes/authoring/workflows/definitions.ts
    plugins/bb-plugin-finite-state/lanes/authoring/workflows/bringup.ts
    plugins/bb-plugin-finite-state/lanes/authoring/workflows/port.ts
    plugins/bb-plugin-finite-state/lanes/authoring/workflows/requirement-code.ts
    plugins/bb-plugin-finite-state/lanes/authoring/workflows/state.ts
    plugins/bb-plugin-finite-state/lanes/authoring/gate/schema.ts
    plugins/bb-plugin-finite-state/lanes/authoring/gate/runner.ts
    plugins/bb-plugin-finite-state/lanes/authoring/gate/preflight.ts
    plugins/bb-plugin-finite-state/lanes/authoring/{workflows,gate}/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, the five frozen artifacts and composition roots (WP-71 owns those changes under approved AMDs), lanes/authoring/register.ts and the citation store (WP-85), lanes/authoring/build/** (WP-86), lib/sync/registry.ts, package.json, pnpm-lock.yaml, test/mock-remote/fixtures/**, or another lane.

## Context

**This WP opens with a plugin-only feasibility check, and it is a hard gate.** SPEC 08 §9.4 wants generated code gated on static analysis before it can become a PR. Per the ADR, the pre-PR gate must be enforceable with plugin mechanisms — there is no bb hook to intercept PR creation, and we do not build one. The fallback shapes, all plugin-level: a **CLI preflight** (`bb finite-state fw gate` run before opening a PR, taught by the skills and the workflow), the **workflow-runner service** (the workflow's PR step refuses to advance while gates fail — the enforcement point for agent-driven authoring), and a **CI recipe** (the same gate command exported for the repository's CI, which is where the gate becomes binding on humans too). If genuine enforcement turns out to require a bb change, stop and report per the ADR; do not weaken the gate silently and do not fork bb. Record the verdict as executable preflight tests before building the rest.

The three workflows are named, resumable sequences, not prompts someone remembers: **bring-up** (part + bus + pins → datasheet research → cited plan → driver + init → build → flash → serial verify → HIL test), **port** (source/target platforms → capability diff → mapping table → staged migration with build gates), **requirement→code** (an EARS requirement → implementation → the verification contract that proves it). Spec-first, always: the plan is cited (WP-85's citation store) and human-approved before code exists — the same product principle as SPEC 01's plan/push, in a new domain. Flash and HIL steps do not execute anything here; they hand off to WP-86/90-gated surfaces.

The gate pipeline itself is `.fs/workflows/authoring-gate.yaml` — the `authoringGate` VERSIONED entity from AMD-0012: declared, versioned, reviewable as a diff, because a medical device and a consumer router should not share a gate and a gate a customer can read and argue with is worth more than a better one they can't see. Gates in the default file: `no_quarantined_values` (WP-85's quarantine state), static analysis (cppcheck/clang-tidy/misra), secret scan, and build (via WP-86); `post_merge` runs the full findings pass. The analyzers are host prerequisites behind `needsConfiguration` — and a configured gate whose tool is missing **fails** with remediation; it never silently passes.

## What to build

1. The feasibility preflight in `gate/preflight.ts`: executable checks that the gate is enforceable at the three plugin-level points (CLI command exists and returns binding exit codes; workflow PR step consumes gate status; CI recipe is generatable), with a stop-and-report path if any binding point is impossible.
2. `gate/schema.ts`: zod parsing of `.fs/workflows/authoring-gate.yaml` — `version`, `on` triggers (`pre_pr`, `post_merge`), gates with `id`, `rule | run`, `fail_on` — rejecting unknown keys and unknown rule names loudly. The parsed shape is the AMD-0012 `authoringGate` entity; registration/drift handling belongs to the registry, not here.
3. `gate/runner.ts`: execute a trigger's gate list in order against the worktree — `no_quarantined_values` queries WP-85's quarantine state; `static` runs configured analyzers via argv arrays with per-analyzer parsers normalizing findings to one shape; `secrets` runs the secret scan; `build` invokes WP-86's build service. Produce a `GateReport` with per-gate pass/fail/skipped-unconfigured, findings, durations, and the exact commands run. Missing analyzer = gate failure with `needsConfiguration` remediation.
4. `post_merge` handling: the full findings pass runs out of the inner loop, recorded against the built image's digest (WP-86 `build_run.digest`), reusing the SPEC 02 machinery through its owner services — never reimplemented here.
5. Workflow definitions as data (`definitions.ts`): ordered steps with kind (`research | plan | approval | edit | gate | build | flash | serial_verify | hil_handoff`), input/output contracts, and the invariant that every `edit` step is preceded by an `approval` step whose subject is a cited plan.
6. The three workflows over that engine: bring-up parameterized by part/bus/pins; port producing a capability diff and mapping table as reviewable artifacts before any migration step; requirement→code taking an EARS requirement id and ending at a verification contract proposal (SPEC 03 owner surfaces do the proving).
7. `state.ts`: persisted, resumable workflow runs — step status, artifacts, approvals with actor and timestamp — in the plugin DB (real SQLite in tests), resumable across sessions and served as paged RPC via the AMD-0011 `authoring.*` group. Publish `authoring:changed` refetch hints only.
8. Approval semantics: an `approval` step is satisfied only by a human action through the review surface — never by agent tool, CLI flag, or elapsed time. Approving a plan does not authorize flash: destructive execution stays behind WP-90's in-turn grant regardless of workflow state.

## Interface contract

    export interface AuthoringGateConfig {
      version: 1;
      on: ReadonlyArray<"pre_pr" | "post_merge">;
      gates: ReadonlyArray<{
        id: string;
        rule?: "no_quarantined_values";
        run?: readonly string[] | string;    // analyzer ids or a service id
        failOn: "error" | "any" | "warning";
      }>;
      postMerge: ReadonlyArray<{ id: string; run: string }>;
    }

    export interface GateReport {
      trigger: "pre_pr" | "post_merge";
      configVersion: number;
      passed: boolean;
      gates: Array<{
        id: string;
        status: "passed" | "failed" | "failed_unconfigured";
        findings: NormalizedFinding[];
        command: string[] | null;
        durationMs: number;
      }>;
      ranAt: string;
    }

    export interface WorkflowRun {
      runId: string;
      workflow: "bringup" | "port" | "requirement_code";
      params: Record<string, string>;
      steps: Array<{
        id: string;
        kind: "research" | "plan" | "approval" | "edit" | "gate" | "build" | "flash" | "serial_verify" | "hil_handoff";
        status: "pending" | "running" | "blocked" | "done" | "failed";
        artifacts: string[];
        approvedBy: string | null;
      }>;
    }

    export function parseGateConfig(yaml: string): AuthoringGateConfig;
    export function runGatePipeline(deps: AuthoringDeps, trigger: "pre_pr" | "post_merge", signal: AbortSignal): Promise<GateReport>;
    export function startWorkflow(deps: AuthoringDeps, workflow: WorkflowRun["workflow"], params: Record<string, string>): Promise<WorkflowRun>;
    export function resumeWorkflow(deps: AuthoringDeps, runId: string): Promise<WorkflowRun>;
    export function recordApproval(deps: AuthoringDeps, runId: string, stepId: string, human: HumanApprovalEvidence): Promise<WorkflowRun>;

`runGatePipeline` is exported for WP-96's CLI subtree and the CI recipe; this WP registers no CLI, tools, or panels itself.

## Acceptance criteria

- [ ] The feasibility preflight passes (or a stop-and-report exists) before any gate code merges; no bb hook, bb-source change, or `plugins/workflows` modification appears anywhere.
- [ ] A quarantined citation value fails the `pre_pr` pipeline via WP-85's real quarantine state.
- [ ] A configured analyzer that is missing on the host fails its gate with `failed_unconfigured` and remediation — never a silent pass or skip.
- [ ] `authoring-gate.yaml` parses strictly; an unknown rule, key, or version is a loud error naming the offender.
- [ ] Gate reports carry per-gate commands, findings, and durations, and are reproducible from the report alone.
- [ ] All three workflows are startable, interruptible, and resumable with state intact across a plugin reload.
- [ ] An `edit` step cannot begin before its cited-plan `approval` step is satisfied by a recorded human action.
- [ ] Workflow approval never mints or substitutes for a WP-90 destructive grant; the flash step blocks without one.
- [ ] `post_merge` findings run through SPEC 02 owner services and bind to the build digest.
- [ ] All queries paged; realtime signals are refetch hints; real SQLite in tests; no new npm dependency.

## Test plan

- schema.test.ts — golden config, unknown rule/key/version rejection (error path), `fail_on` vocabulary, and round-trip stability.
- runner.test.ts — passing pipeline, quarantine failure, analyzer findings normalization for cppcheck/clang-tidy fixtures, missing analyzer → `failed_unconfigured` (error path), gate ordering, and abort mid-pipeline leaves a coherent partial report.
- preflight.test.ts — the three binding points verified under the fake host; the stop-and-report path produces its record (safety path).
- state.test.ts — start/resume across reload, step transitions, blocked-on-approval, and concurrent resume attempts serialize (error path).
- workflows.test.ts — bring-up step graph with edit-before-approval refused (safety path); port produces diff/mapping artifacts before migration steps unlock; requirement→code ends at a verification-contract proposal and cannot mark anything verified.

## Do not

- Do not implement or propose a bb hook, PR interception, or any bb-source change; the ADR verdict is stop-and-report.
- Do not hardcode gate policy — the YAML is the policy; code only supplies rule implementations.
- Do not let a gate pass because its tool is absent, or let `post_merge` findings block the inner loop.
- Do not reimplement build, flash, serial, citations, or findings analysis — consume WP-86/85 and SPEC 02 owner services.
- Do not let workflow or plan approval authorize destructive execution.
- Do not register CLI, agent tools, or panels here; WP-96 consumes the exports.

## Open questions

1. MISRA checking without a commercial license: cppcheck's misra addon needs the rule texts for full output. Decide what `misra` in the default gate honestly means (addon with suppressed texts vs. omitted from the default file) before shipping a default that overpromises.
2. The CI recipe's concrete form — a documented job invoking the CLI preflight vs. a generated workflow file the user commits. Coordinate with how WP-64 documented human-only verbs; do not generate CI config into user repos without an explicit action.
3. Whether workflow runs belong in `probe_run`-style plugin-DB rows only, or also surface as a reviewable YAML artifact for the diff-first product idiom. v1 ships DB + paged RPC; revisit if the demo needs a diffable run record.
