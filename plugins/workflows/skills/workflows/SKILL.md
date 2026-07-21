---
name: workflows
description: Execute a workflow script that orchestrates multiple subagents deterministically. Use for multi-agent orchestration, parallel or sequential agent pipelines, structured outputs, and durable background workflow runs.
---

# BB workflows

A workflow structures work across many agents — to be comprehensive (decompose
and cover in parallel), to be confident (independent perspectives and
adversarial checks before committing), or to take on scale one context can't
hold (migrations, audits, broad sweeps). The script is where you encode that
structure: what fans out, what verifies, what synthesizes.

ONLY run a workflow when the user has explicitly opted into multi-agent
orchestration. The user directly asking you to run a workflow, use multi-agent
orchestration, fan out agents, invoke this skill, or run a specific named or
saved workflow counts as explicit opt-in. For any other task — even one that
would clearly benefit from parallelism — do not call `bb_workflow_run`. Use
ordinary BB delegation, or briefly describe what a multi-agent workflow could
do and how much it would roughly cost, and ask the user whether to run it.

When you do call it, the right move is often **hybrid**: scout inline first
(list the files, find the channels, scope the diff) to discover the work-list,
then run a workflow to pipeline over it. You don't need to know the shape before
the _task_ — only before the _orchestration step_.

`bb_workflow_run` returns immediately. After a successful call, copy its
`previewDirective` into your response exactly once as a standalone line. Do not
wrap it in backticks or a code fence, and do not invent or edit the run ID. BB
replaces that line with a live progress card; its action opens the matching
phase and worker inspector in the thread's right panel. The completion
notification still arrives in the origin thread, and
`bb workflows status <run-id>` remains the authoritative compact polling
surface. For detailed history, redirect a bounded `bb workflows history` JSONL
page into `$BB_THREAD_STORAGE` before reading it with filesystem tools.

Common single-phase workflows you can chain across turns:

- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each → verify

For larger work, run several in sequence — read each result before deciding the
next phase. You stay in the loop; each workflow is one well-scoped fan-out.

Before writing explicit provider selections, use BB's built-in provider CLI:

```bash
bb provider list --environment "$BB_ENVIRONMENT_ID" --json
bb provider models <provider-id> --environment "$BB_ENVIRONMENT_ID" --json
```

Query only the provider you intend to use. Do not guess identifiers from
memory, especially for ACP providers: their advertised model IDs and reasoning
options are not derivable from the provider ID.

Before running authored or edited source, run `bb workflows validate` with the
same source selector. It checks source size, hidden control characters, syntax,
unsafe constructs, literal metadata and schemas, partial selection tuples, and
all safely discoverable literal provider/model/reasoning tuples against that
live catalog.

## Source format

Every script must begin with `export const meta = {...}`:

```js
export const meta = {
  name: "review-changes",
  description: "Review changed files across dimensions, verify each finding",
  phases: [
    { title: "Review", detail: "Independent correctness reviews" },
    { title: "Verify", detail: "Adversarial verification" },
  ],
};
// script body starts here — use agent()/parallel()/pipeline()/phase()/log()
phase("Review");
const reviews = await parallel([
  () => agent(`Review correctness: ${args.task}`),
  () => agent(`Review maintainability: ${args.task}`),
]);
return reviews;
```

The `meta` object must be a PURE LITERAL — no variables, function calls,
spreads, or template interpolation. Required fields: `name`, `description`.
Optional fields: `inputSchema`, `outputSchema`, `phases`. `meta.name` is
lowercase kebab-case. `phases` is an ordered literal array of
`{ title, detail? }` entries. Titles must be non-empty and unique; details must
be non-empty when present. Metadata is parsed without executing the workflow.

Use the SAME phase titles in `meta.phases` as in `phase()` calls — titles are
matched exactly; a `phase()` call with no matching meta entry still becomes the
current progress group.

Schemas use a host-safe subset because Ajv runs in Node, outside QuickJS's
interrupt deadline. Use boolean schemas and ordinary `type`, `properties`,
`required`, `additionalProperties`, `items`, scalar `enum`, `const`, size/range
bounds, `nullable`, and annotations. Do not use regex/`pattern`, `format`,
references, combinators or conditionals, `uniqueItems`, `contains`, dependent
or unevaluated schemas, structured enum values, or unknown keywords. The same
subset and size/node/depth protections apply to metadata input/output schemas
and per-agent result schemas; rejection errors identify the unsafe schema path.

## Script body hooks

- `agent(prompt: string, opts?)`: spawn a BB worker. Without `schema`, returns
  its final text as a string. With `schema` (a JSON Schema), the worker is forced
  to call `bb_workflow_result` and `agent()` returns the validated value — no
  parsing needed. `opts.label` overrides the display label. `opts.phase`
  explicitly assigns this agent to a progress group; use this inside
  `pipeline()`/`parallel()` stages to avoid races on the global `phase()` state —
  same phase string → same group.
- `pipeline(items, stage1, stage2, ...)`: run each item through all stages
  independently, NO barrier between stages. Item A can be in stage 3 while item
  B is still in stage 1. This is the DEFAULT for multi-stage work. Wall-clock =
  slowest single-item chain, not sum-of-slowest-per-stage. Every stage callback
  receives `(prevResult, originalItem, index)` — use `originalItem`/`index` in
  later stages to label work without threading context through stage 1's return
  value. A stage that throws drops that item to `null` and skips its remaining
  stages.
- `parallel(thunks: Array<() => Promise<any>>)`: run tasks concurrently. This is
  a BARRIER: it awaits all thunks before returning. A thunk that throws (or
  whose agent errors after provider retries are exhausted) resolves to `null`.
  Use ONLY when you genuinely need all results together, and use
  `.filter(Boolean)` before consuming successful results.
- `log(message: string)`: emit a plugin-scoped progress message.
- `phase(title: string)`: start a new phase; subsequent `agent()` calls are
  grouped under this title. An agent-level `phase` overrides only that call and
  does not change the current phase.
- `args`: the value passed as `bb_workflow_run`'s `args` input, verbatim. Pass
  arrays/objects as actual JSON values, NOT as a JSON-encoded string. Use this to
  parameterize named workflows — for example, pass a research question, target
  path, or config object directly instead of via a side-channel file.
- `budget()`: return the run's immutable agent-call and concurrency limits.
- `workflow(nameOrRef, args?)`: run another workflow inline as a sub-step and
  return whatever it returns. Pass a name to invoke a saved workflow, or
  `{ name }`, `{ scriptPath }`, or `{ script }`. The child shares this run's
  concurrency cap, agent counter, abort signal, replay order, and progress. The
  `args` parameter becomes the child's `args` global. Nesting is one level only:
  `workflow()` inside a child throws. Unknown names, unreadable paths, and child
  syntax errors throw; catch them to handle gracefully.

Workers are told their final text IS the return value (not a human-facing
message), so they return raw data. For structured output, use the `schema`
option — validation happens at the tool-call layer so the model can retry on
mismatch.

Workflows are plain JavaScript, NOT TypeScript — type annotations
(`: string[]`), interfaces, and generics fail to parse. The script body runs in
an async context — use `await` directly. Standard JS built-ins (`JSON`, `Math`,
`Array`, etc.) are available — EXCEPT wall-clock and random-number operations,
which throw because they would break resume. Pass timestamps in via `args`,
stamp results after the workflow returns, and for randomness vary the agent
prompt/label by index. No filesystem, shell, network, imports, or Node.js API
access.

Workers spawned by `agent()` are normal BB threads and retain the tools and
workspace access allowed by their BB permission mode. The QuickJS script itself
never receives that access.

## Agent selection

Omit selection fields to inherit the origin thread's exact provider, model, and
reasoning level:

```js
await agent("Inspect the implementation");
```

For an override, provide all three fields. Partial overrides are rejected:

```js
await agent("Inspect the implementation", {
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoningLevel: "medium",
});
```

BB validates the tuple against the live provider/model catalog immediately
before spawning the worker. A provider disappearing between authoring and
execution fails the call instead of silently substituting another model.

## Structured agent results

Set native `schema` (or the compatible `outputSchema` alias) on an individual
agent call:

```js
const review = await agent("Return a severity-ranked review", {
  label: "Correctness review",
  phase: "Review",
  schema: {
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["severity", "summary"],
          properties: {
            severity: { enum: ["critical", "high", "medium", "low"] },
            summary: { type: "string" },
          },
        },
      },
    },
  },
});
```

Native `label` is an alias for BB's existing `title`, and native `schema` is an
alias for BB's existing `outputSchema`. Either spelling remains supported.
`label` and `title` must match exactly when both are present; `schema` and
`outputSchema` must be structurally identical, with object key order ignored.
The canonical structured-result field is `outputSchema`. `phase`, `label`, and
`title` are display-only.

That worker receives only the `bb_workflow_result` plugin tool. It MUST call the
tool exactly once at the end of its response with `{ value: ... }` to provide
the structured output. BB validates the value with Ajv. The initial invalid
attempt gets at most two corrective retries; a third invalid submission fails
the call. There is no hidden normalization-agent pass.

## Pipeline by default

DEFAULT TO `pipeline()`. Only reach for a barrier (`parallel` between stages)
when you genuinely need ALL prior-stage results together.

A barrier is correct ONLY when stage N needs cross-item context from all of
stage N-1:

- Dedup/merge across the full result set before expensive downstream work
- Early-exit if the total count is zero ("0 bugs found → skip verification
  entirely")
- Stage N's prompt references "the other findings" for comparison

A barrier is NOT justified by:

- "I need to flatten/map/filter first" — do it inside a pipeline stage:
  `pipeline(items, stageA, r => transform([r]).flat(), stageB)`
- "The stages are conceptually separate" — that's what `pipeline()` models.
  Separate stages ≠ synchronized stages.
- "It's cleaner code" — barrier latency is real. If 5 finders run and the
  slowest takes 3× the fastest, a barrier wastes 2/3 of the fast finders' idle
  time.

Smell test: if you wrote

```js
const a = await parallel(/* ... */);
const b = transform(a); // flatten, map, filter — no cross-item dependency
const c = await parallel(/* b.map(...) */);
```

that middle transform doesn't need the barrier. Rewrite as a pipeline with the
transform inside a stage. When in doubt: pipeline.

The canonical multi-stage pattern — pipeline by default, each dimension
verifies as soon as its review completes:

```js
export const meta = {
  name: "review-changes",
  description: "Review changed files across dimensions, verify each finding",
  phases: [{ title: "Review" }, { title: "Verify" }],
};
const dimensions = [
  { key: "bugs", prompt: "Review for correctness bugs" },
  { key: "perf", prompt: "Review for performance problems" },
];
const results = await pipeline(
  dimensions,
  (dimension) =>
    agent(dimension.prompt, {
      label: `review:${dimension.key}`,
      phase: "Review",
      schema: {
        type: "object",
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "file"],
              properties: {
                title: { type: "string" },
                file: { type: "string" },
              },
            },
          },
        },
      },
    }),
  (review) =>
    parallel(
      review.findings.map(
        (finding) => () =>
          agent(`Adversarially verify: ${finding.title}`, {
            label: `verify:${finding.file}`,
            phase: "Verify",
            schema: {
              type: "object",
              required: ["isReal"],
              properties: { isReal: { type: "boolean" } },
            },
          }).then((verdict) => ({ ...finding, verdict })),
      ),
    ),
);
return results
  .flat()
  .filter(Boolean)
  .filter((finding) => finding.verdict?.isReal);
```

When a barrier IS correct — dedup across all findings before expensive
verification:

```js
const all = await parallel(
  dimensions.map(
    (dimension) => () =>
      agent(dimension.prompt, {
        schema: {
          type: "object",
          required: ["findings"],
          properties: {
            findings: { type: "array", items: { type: "object" } },
          },
        },
      }),
  ),
);
const deduped = dedupeByFileAndLine(
  all.filter(Boolean).flatMap((result) => result.findings),
); // genuinely needs ALL at once
const verified = await parallel(
  deduped.map(
    (finding) => () =>
      agent(verifyPrompt(finding), {
        schema: {
          type: "object",
          required: ["isReal"],
          properties: { isReal: { type: "boolean" } },
        },
      }),
  ),
);
```

## Quality patterns

These are common shapes; pick by task and compose freely:

- **Adversarial verify:** spawn N independent skeptics per finding, each
  prompted to REFUTE. Kill if at least a majority refute. This prevents
  plausible-but-wrong findings from surviving.
- **Perspective-diverse verify:** when a finding can fail in more than one way,
  give each verifier a distinct lens (correctness, security, performance,
  does-it-reproduce) instead of N identical refuters — diversity catches
  failure modes redundancy can't.
- **Judge panel:** generate N independent attempts from different angles (for
  example, MVP-first, risk-first, user-first), score with parallel judges, and
  synthesize from the winner while grafting the best ideas from runners-up.
- **Loop-until-dry:** for unknown-size discovery (bugs, issues, edge cases),
  keep spawning finders until K consecutive rounds return nothing new. Simple
  counters (`while count < N`) miss the tail.
- **Multi-modal sweep:** parallel agents each search a different way
  (by-container, by-content, by-entity, by-time). Each is blind to what the
  others surface; use this when one search angle won't find everything.
- **Completeness critic:** a final agent asks "what's missing — modality not
  run, claim unverified, source unread?" What it finds becomes the next round of
  work.
- **No silent caps:** if a workflow bounds coverage (top-N, no-retry,
  sampling), `log()` what was dropped — silent truncation reads as "covered
  everything" when it didn't.

Scale to what the user asked for. "find any bugs" → a few finders, single-vote
verify. "thoroughly audit this" or "be comprehensive" → larger finder pool,
3–5 vote adversarial pass, synthesis stage. When unsure, lean toward
thoroughness for research/review/audit requests and toward brevity for quick
checks.

These patterns aren't exhaustive — compose novel harnesses when the task calls
for it (tournament brackets, self-repair loops, staged escalation, whatever
fits).

Use workflows for multi-step orchestration where control flow should be
deterministic (loops, conditionals, fan-out) rather than model-driven.

## Running and resuming

`bb_workflow_run` and `bb workflows validate` accept exactly one source mode:

- `script`: inline JavaScript.
- `scriptPath`: a relative path or an absolute path confined to the workflow
  origin environment's workspace.
- `name`: a lowercase kebab-case name resolved as
  `.bb/workflows/<name>.js` in the current project workspace.

The existing `source` field remains a supported alias for inline `script`, but
do not provide both. File and name resolution happens through the origin
environment's `hostId` and workspace root. Traversal, outside absolute/UNC
paths, missing workspace roots, non-UTF-8 files, and sources over 512 KiB are
rejected. QuickJS receives source text only; it never gets filesystem access.
Plugin-bundled workflow discovery is not supported.

`bb_workflow_run` also accepts optional JSON `args` and optional `resumeRunId`.
It returns a durable run ID immediately. Use the compact `bb workflows status`
summary, paged `bb workflows history`, `bb workflows list`, and
`bb workflows stop` afterward. Completion is queued
back to the origin thread, so an active origin is not interrupted. Delivery is
duplicate-tolerant at-least-once because `threads.send` has no idempotency key.
CLI status polling remains authoritative.

`list` also returns compact summaries; it is safe for discovery but is not a
substitute for the redirected detailed history.

Detailed history can contain every prompt, critique, result, and call record,
so never print it directly into the agent transcript. Materialize one bounded
JSONL page on the execution host, then use normal file-navigation tools:

```bash
run=<run-id>
mkdir -p "$BB_THREAD_STORAGE/workflows"
bb workflows history "$run" --cursor 0 --limit 100 \
  > "$BB_THREAD_STORAGE/workflows/$run.jsonl"
jq -c 'select(.type == "page")' "$BB_THREAD_STORAGE/workflows/$run.jsonl"
```

The last `page` record supplies `nextCursor`; fetch that cursor and append the
next page. Pages are snapshots, so rewrite from cursor `0` to refresh an active
run. Redirection is performed by your shell, which places the file in the
correct local or remote thread storage without giving the plugin arbitrary
host filesystem access.

To resume after a pause, stop, restart, or script edit, relaunch with the same
current source and `resumeRunId`. Resume requires a terminal prior run in the
same project and environment workspace and always creates a new run. The
longest unchanged prefix of successful `agent()` calls returns cached results;
the first edited or new call and everything after it runs live. The cache key
includes call order, prompt, resolved provider/model/reasoning/permission,
output schema, and worker protocol semantics. Display-only phase, label, and
title changes do not invalidate it.

Parallel calls receive cache identities in deterministic invocation order, so
concurrency alone does not stop replay. Successful calls that edited files or
performed other writes are cached too: resume is restricted to the same
environment workspace, where their side effects remain. Failed, cancelled,
incomplete, and null-result calls are not reusable; the first such call and the
entire suffix run live. Legacy runs without replay-safety metadata replay
nothing. A plugin restart applies the same longest-prefix rule.

Each `agent()` call retries transient provider failures twice with bounded
backoff before surfacing the error to `parallel()`/`pipeline()` or the script.
Overload, rate-limit, provider 5xx, and recognized network failures retry;
authentication, configuration, and schema failures do not. The retry count is
persisted and visible in workflow history.

The CLI equivalents are:

```bash
bb workflows validate --script '<javascript>'
bb workflows validate --file .bb/workflows/review-change.js
bb workflows validate --name review-change
bb workflows run --script '<javascript>' --args '<json>'
bb workflows run --file .bb/workflows/review-change.js --resume <run-id>
bb workflows run --name review-change
bb workflows status <run-id>
bb workflows history <run-id> --cursor 0 --limit 100
bb workflows list --limit 20
bb workflows stop <run-id>
bb provider list --environment "$BB_ENVIRONMENT_ID" --json
bb provider models <provider-id> --environment "$BB_ENVIRONMENT_ID" --json
```

The CLI's `--file` maps to the agent tool's `scriptPath`, but a relative CLI
path starts at the invoking CLI's current directory. Both that directory and
the resolved file must remain inside the origin workspace. `--source` remains
an inline alias for `--script`. Run and validate require exactly one of
`--script`, `--file`, or `--name` (counting `--source` as `--script`).

Workflow worker threads use hidden visibility and are plugin-attributed. They
stay out of sidebar organization without contributing unread/pending favicon
attention or native parent notifications. Ordinary search, prompt history,
lifecycle, and direct operations remain available. Workflows does not create a
temporary Workflow folder.

`maxActiveRuns` is live plugin-global dispatch policy. Shared parent/child agent
concurrency and call count, total run timeout, retention, and UTF-8
completion-message size are snapshotted per run. `status` is bounded
to compact progress and call counts. Paged JSONL `history` carries ordered
call-level execution, cache, child-thread, repair, result, and error details.
