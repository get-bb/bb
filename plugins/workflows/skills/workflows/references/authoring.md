# Workflow source and agent API

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

## Human discussion boundaries

Use `discussion({ title, brief, context?, schema, phase?, provider?, model?, reasoningLevel? })`
when the owner needs to explore or decide something before work continues.
`schema` (or `outputSchema`) is required and uses the same safe subset as agent
results. Model selection inherits the origin unless all three selection fields
are supplied. Context is JSON, limited to 256 KiB including options; reference
larger evidence by path rather than embedding it. Use immutable artifact paths
or include their versions in context: replay hashes the context, not the
contents of referenced files.

```js
const reviews = await parallel([
  () => agent("Review navigation"),
  () => agent("Review readability"),
]);
const direction = await discussion({
  title: "Choose the design direction",
  brief:
    "Compare the reviews with the owner using GenUI. Work in small batches.",
  context: { reviews },
  schema: {
    type: "object",
    required: ["direction"],
    properties: { direction: { type: "string" } },
  },
});
return await agent(
  "Implement the agreed direction: " + JSON.stringify(direction),
);
```

This first version only permits discussion boundaries in the root workflow.
Await every earlier worker and nested workflow first. Earlier worker calls must
have succeeded durably; a caught worker failure is not a safe checkpoint in
this version. Represent a negative review as data, rather than a thrown error. Do not start workers,
other discussions, or nested workflows concurrently with a discussion. The
runtime rejects overlapping calls instead of silently cancelling their work.

A discussion counts against the agent-call budget, but does not reserve an
agent concurrency slot while waiting.

The step opens a visible BB thread in the origin workspace. It is a normal
conversation, with GenUI supplied by installed plugins. The discussion agent
can present context in batches, investigate questions, and refine options.
Going idle does not finish the step. Only after the owner explicitly finishes
the discussion should that agent call `bb_workflow_discussion_result` with the
agreed value. The service validates the result and requires a subsequent user
turn; the initial workflow seed cannot approve itself. The agent interprets
the owner's intent, rather than matching a keyword such as “done”.
