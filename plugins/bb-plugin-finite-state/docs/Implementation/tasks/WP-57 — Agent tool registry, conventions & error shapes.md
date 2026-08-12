# WP-57 — Agent tool registry, conventions & error shapes

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 00 §8 · SPEC 06 §2.1, §4, §5 · RECON §1.5 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-01 · **Blocks:** WP-58, WP-59, WP-60, WP-61, WP-62, WP-63, WP-64
**Produces a FROZEN artifact:** no — the registry is guarded by CI, but additions follow the amendment rule in this WP

## Files you own
```
plugins/bb-plugin-finite-state/lib/agentic/registry.ts
plugins/bb-plugin-finite-state/lib/agentic/types.ts
plugins/bb-plugin-finite-state/lib/agentic/result.ts
plugins/bb-plugin-finite-state/lib/agentic/budget.ts
plugins/bb-plugin-finite-state/lanes/agentic/register.ts
plugins/bb-plugin-finite-state/lanes/agentic/registry.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/result.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/budget.test.ts
```

## Files you must not touch
`server.ts`, `app.tsx`, either context file, any frozen interface, `package.json`, lockfiles, another lane's implementation, or `test/mock-remote/fixtures/**`.

## Context
Sixteen tools span six domains, but an agent should experience one predictable API. This WP defines the code registry and response laws before any handler lands. It also makes the safety boundary mechanically inspectable: reads summarize, writes touch local YAML, and only three named actions may touch server-side action/fetch services. `bb.agents.registerTool` accepts `{name, description, parameters, execute}`; there is no `requiresApproval` field and no configurable per-tool approval gate (RECON §1.5). Do not encode safety as nonexistent SDK metadata.

## What to build
1. Define the canonical sixteen-tool registry from SPEC 06 §2.1, corrected by RECON. Each entry declares class, server access, paired directive, default/max page size, and idempotency.
2. Define a discriminated `ToolResult<T>`: success carries `data` and telemetry; failure carries `{code,message,hint,retryable,details?}`. Hints name a concrete recovery step or next tool call.
3. Provide `ok()` and `fail()` constructors so handlers never hand-roll envelopes or leak raw exceptions.
4. Provide cursor helpers and response-budget measurement. List tools default to 50, hard-cap at 200, return totals, and target a 4 KiB soft JSON budget. Truncate only optional summary fields, never ids, totals, cursors, errors, or integrity facts.
5. Define write-result conventions: path relative to worktree, `create|update|noop`, and a bounded field-level diff summary. Never return only `{ok:true}`.
6. Replace the WP-01 agentic backend stub with a thin composition module that calls exported `registerReadTools`, `registerWriteTools`, `registerActionTools`, `registerMentions`, and `registerFiniteStateCli` functions when those WPs land. Until then, compiling no-op registration arrays are allowed; do not put handlers in the composition file.
7. Add registry invariants: exactly sixteen tools; names unique and `fs_`-prefixed; exactly three `class:"action"` entries; `fs_verification_run` and `fs_bench_run` use `server:"invoke"`, while `fs_firmware_materialize` uses `server:"read-fetch"`; no `fs_sync_push`; every paired directive exists in the twelve-directive set.
8. Convert unknown handler exceptions to `internal_error`, log the full cause server-side, and return a non-secret message. Preserve known domain errors without changing their codes.

## Interface contract
```ts
export type ToolClass = "read" | "write" | "action";
export type ServerAccess = "none" | "read-refresh" | "read-fetch" | "invoke";

export interface AgentToolSpec {
  readonly name: `fs_${string}`;
  readonly class: ToolClass;
  readonly server: ServerAccess;
  readonly idempotency: "idempotent" | "convergent" | "non-idempotent";
  readonly directive?: typeof DIRECTIVE_IDS[number];
  readonly page?: { readonly default: 50; readonly max: 200 };
}

export const DIRECTIVE_IDS = [
  "fs-plan", "fs-finding", "fs-triage-summary", "fs-threat", "fs-canvas", "fs-req",
  "fs-matrix", "fs-component", "fs-hbom-summary", "fs-bench", "fs-verdict", "fs-doc",
] as const;

export const AGENT_SURFACE: Readonly<{
  tools: Readonly<Record<string, AgentToolSpec>>;
  directives: typeof DIRECTIVE_IDS;
  mentionTriggers: Readonly<Record<"@" | "#" | "~", readonly string[]>>;
}>;

export type ToolError = {
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
  details?: unknown;
};
export type ToolResult<T> =
  | { ok: true; data: T; meta: { bytes: number; truncated?: boolean; nextCursor?: string } }
  | { ok: false; error: ToolError };

export function ok<T>(data: T, meta?: { truncated?: boolean; nextCursor?: string }): ToolResult<T>;
export function fail(code: string, message: string, hint: string, retryable?: boolean): ToolResult<never>;
export function enforceBudget<T>(result: ToolResult<T>, softBytes?: number): ToolResult<T>;
```
The exact helper signature may tighten during implementation, but all handlers and tests consume this one module; do not duplicate envelopes.

## Acceptance criteria
- [ ] Registry contains exactly the canonical sixteen names and twelve directive ids from SPEC 06.
- [ ] Registry declares only `fs_verification_run`, `fs_bench_run`, and `fs_firmware_materialize` as actions; their server-access values are `invoke`, `invoke`, and `read-fetch` respectively.
- [ ] A context-aware test asserts `fs_sync_push` is never registered, invocable, or advertised as an agent capability. Negative safety prose may name the forbidden identifier, and the separate human CLI review handoff may use the ordinary verb `push` without creating an `fs_sync_push` tool.
- [ ] All errors conform to `{code,message,hint,retryable}` and raw stack traces or secrets never cross the tool boundary.
- [ ] Pagination defaults to 50 and rejects or clamps above 200 consistently.
- [ ] Budget telemetry records serialized byte size; truncation preserves ids, totals, cursor, integrity warnings, and error details.
- [ ] `registerAgentic` remains composition-only and is safe when called once per plugin factory execution.
- [ ] No new dependency; the four-command plugin gate is green.

## Test plan
`registry.test.ts`
- `lists sixteen unique fs-prefixed tools and twelve directives`.
- `only the three enumerated tools have action class and their access values match the canonical matrix`.
- `rejects a fourth server action without an amendment` (**safety error path**).
- `contains no registered or advertised agent push capability`; scan structured registrations/tool sections rather than rejecting negative prohibition prose.

`result.test.ts`
- `known domain error preserves recovery hint`.
- `unknown exception is logged and becomes sanitized internal_error` (**error path**).
- `write success includes relative path and bounded diff summary`.

`budget.test.ts`
- `default page response stays under soft budget on seed rows`.
- `oversized optional summaries truncate without losing ids or cursor`.
- `hard-required content over budget is returned with telemetry rather than silently corrupted`.

## Do not
- Do not implement any domain handler in this WP.
- Do not invent approval metadata or claim action tools receive a plugin-configured prompt.
- Do not allow `RemoteServices`, a general service/compute client, arbitrary URL/method/path, or raw API into a tool schema.
- Do not add a push, conflict-resolution, HBOM-acceptance, review-transition, or attestation-write tool.
- Do not return unbounded cache rows, logs, firmware bytes, or document bodies.

## Open questions
1. Confirm whether the current SDK exposes an instruction-contribution hook before adding the optional ≤150-token workspace status block. Absence is not a reason to change this registry.
2. Measure the 4 KiB target against the actual provider tokenizer during WP-65; serialized bytes are the deterministic v1 enforcement proxy.
