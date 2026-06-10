---
name: bb-workflows
description: Author and run deterministic multi-agent workflows with the `bb workflow` CLI — .workflow.js files that orchestrate fleets of codex, claude-code, and pi agents via agent()/parallel()/pipeline()/phase(). Use when a task is big enough to decompose and run in parallel, when you want independent perspectives and adversarial checks before committing, or when the work is too large for one context (broad audits, migrations, multi-source research, exhaustive reviews). Covers the file shape, the DSL, structured output, worktree isolation, determinism, resume, the registry tiers, and every `bb workflow` command.
---

# bb Workflows

Run a workflow file that orchestrates multiple agents deterministically.
`bb workflow run <file.workflow.js | name>` launches the run and immediately
prints the run id plus a live `…/workflows/runs/<id>` link. Each `agent()` call
spawns a real provider agent (codex, claude-code, or pi — you pick per call or
inherit the run default). Launched from inside a thread, the run also renders
live in that thread's timeline.

A workflow structures work across many agents — to be comprehensive (decompose
and cover in parallel), to be confident (independent perspectives and
adversarial checks before committing), or to take on scale one context can't
hold (migrations, audits, broad sweeps). The file is where you encode that
structure: what fans out, what verifies, what synthesizes.

When you write one, the right move is often **hybrid**: scout first (list the
files, find the channels, scope the diff) to discover the work-list, then write
a workflow to pipeline over it. You don't need to know the shape before the
*task* — only before the *orchestration step*.

Common single-phase workflows you can chain across runs:

- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify (example below)
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each (worktree isolation) → verify

For larger work, run several in sequence — read each result before deciding the
next phase. You stay in the loop; each workflow is one well-scoped fan-out.

Workflows complement managed threads, they don't replace them: spawn a thread
(`bb thread spawn`) for open-ended work that needs conversation and judgment
calls mid-flight; write a workflow when you can state the whole fan-out shape
up front and want it deterministic, capped, and resumable.

## File shape

Every script is plain JavaScript (NOT TypeScript — type annotations fail to
parse) and must begin with `export const meta = {...}`:

```js
export const meta = {
  name: "find-flaky-tests",
  description: "Find flaky tests and propose fixes", // one-line summary
  phases: [                                          // one entry per phase() call
    { title: "Scan", detail: "grep test logs for retries" },
    { title: "Fix", detail: "one agent per flaky test" },
  ],
};
// script body starts here — use agent()/parallel()/pipeline()/phase()/log()
phase("Scan");
const flaky = await agent("grep CI logs for retry markers", { schema: FLAKY_SCHEMA });
// ...
```

The `meta` object must be a PURE LITERAL — no variables, function calls,
spreads, computed keys, or template `${}` interpolation. It is parsed
structurally, never executed. The schema is STRICT: an unknown or typo'd key
rejects the file. Fields:

- `name`, `description` — required.
- `phases?: [{title, detail?}]` — one entry per `phase()` call. Use the SAME
  titles in `meta.phases` as in `phase()` calls — titles are matched exactly;
  a `phase()` call with no matching meta entry just gets its own progress
  group.
- `whenToUse?` — a selection hint shown in listings.
- `defaultProvider?` / `defaultModel?` / `defaultSandbox?` — author-declared
  run defaults (see resolution order below).

The body runs in an async sandbox — use `await` directly. Standard JS built-ins
(JSON, Math, Array, …) are available EXCEPT `Date.now()`, `Math.random()`, and
argless `new Date()`, which throw and are rejected by a validate-time lint
(they would break resume); use the injected `now()`/`random()` instead, or pass
timestamps via `args`. No imports, no filesystem, no network in the workflow
body — the agents do the I/O.

This skill ships `ambient.d.ts` beside this file — copy it next to your
`.workflow.js` and add `/// <reference path="./ambient.d.ts" />` at the top to
get editor completion for all the globals below.

## The DSL

- `agent(prompt, opts?): Promise<any>` — spawn one agent. Without `schema`,
  resolves to its final text as a string. With `schema` (a JSON Schema), the
  agent is forced to return JSON matching it and `agent()` resolves to the
  validated object — no parsing needed. A failed agent THROWS (after the
  worker's internal retries) — there is no skip-to-null for a direct `agent()`
  call; only `parallel()`/`pipeline()` degrade failures to `null`. Options
  (unknown keys are rejected at the call, before any agent spends a slot):
  - `provider?: "codex" | "claude-code" | "pi"`, `model?: string` — **default
    to omitting both**; the agent inherits the run's resolved defaults, which
    is almost always correct. Pin them only when the user explicitly asks or a
    step clearly needs a different provider.
  - `effort?: "low" | "medium" | "high" | "xhigh" | "ultracode" | "max"` —
    reasoning depth (run default: server policy, `medium`).
  - `sandbox?: "read-only" | "workspace-write" | "danger-full-access"` —
    default `read-only`; use `workspace-write` only when the agent must write.
  - `label?: string` — display label; `phase?: string` — overrides the ambient
    `phase()` group for this call.
  - `cwd?: string` — working directory (defaults to the run's workspace).
  - `instructions?: string` — extra system instructions.
  - `schema?: object` — JSON Schema for structured output.
  - `worktree?: boolean` — run in a fresh git worktree (see Worktrees). Boolean
    only: the branch name is runtime-derived (`wf/<runId>-<agentIndex>`;
    retried attempts append `-r<attempt>`).
  - `key?: string` — explicit journal-slot pin for resume. By default a
    call's journal key hashes its branch position, prompt, and resolved spec,
    so a prompt built dynamically from an upstream result gets a different key
    when that upstream agent re-runs differently on resume — an explicit key
    pins the slot through that. Keys must be unique within a run.
  - `maxTurns` does not exist; passing it (or any unknown option) throws
    immediately.
- `pipeline(items, stage1, stage2, ...): Promise<any[]>` — run each item
  through all stages independently, NO barrier between stages. Item A can be in
  stage 3 while item B is still in stage 1. This is the DEFAULT for multi-stage
  work. Every stage callback receives `(prevResult, originalItem, index)` — use
  `originalItem`/`index` in later stages to label work without threading
  context through stage 1's return value. A stage that throws drops that item
  to `null` and skips its remaining stages.
- `parallel(thunks): Promise<any[]>` — run tasks concurrently. This is a
  BARRIER: awaits all thunks before returning. A thunk that throws (or whose
  agent fails) resolves to `null` in the result array — including your own
  errors in a `.then()` transform — so `.filter(Boolean)` before using the
  results. Control-flow errors are the exception and reject the whole call
  (`pipeline()` too): run cancellation, budget exhaustion, the agent-call cap,
  the fan-out cap, and duplicate explicit keys propagate and abort the fan-out
  — they never degrade to `null`. Use `parallel()` ONLY when you genuinely
  need all results together.
- `phase(title)` — start a new phase; subsequent `agent()` calls group under
  this title in the progress display.
- `log(message)` — record a durable run event in the journal. It is
  retrievable via the run-events API/SDK but NOT rendered anywhere today —
  not in the progress tree, the run page, or the CLI — so anything the
  consumer must see belongs in the workflow's return value (or the final
  synthesis agent's output), not in `log()`.
- `args` — the JSON value passed via `--args '<json>'`, verbatim (`undefined`
  if not provided). Use it to parameterize a workflow — a research question, a
  target path, a config object.
- `now(): number` / `random(): number` — journal-seeded deterministic
  time/RNG.
- `budget: {total: number | null, spent(): number, remaining(): number}` — the
  run's output-token ceiling. `total` is `null` unless the run was launched
  with a budget (an API/Run-dialog launch option; the CLI has no budget flag)
  or the project's workflow policy sets a default budget for launches that
  don't override it. The ceiling is HARD, not advisory: once `spent()`
  reaches `total`, further `agent()` calls throw. Guard loops on
  `budget.total` — with no ceiling set, `remaining()` is `Infinity`.

Prompts ship to the agent verbatim — the runtime injects no framing about how
to answer. For text results, say in your prompt that the final message IS the
return value (raw data, not a human-facing summary), or the agent may narrate.
Better, use `schema`: the worker layer extracts and validates the JSON and the
agent gets one corrective re-prompt on a mismatch.

## Providers and run defaults

Every `agent()` runs under a provider/model/effort/sandbox resolved from, in
order: the per-call opts → the run's launch overrides → the workflow's
`meta.default*` fields → server policy (provider `codex`, effort `medium`,
sandbox `read-only`). Models come from the bb provider catalog; omitting
`model` (the norm) uses the provider's default.

- The `bb workflow run` CLI exposes only `--effort` as a launch override;
  provider/model/sandbox/budget overrides live in the SPA Run dialog and the
  API.
- `danger-full-access` requires a per-project grant: each project's workflow
  policy carries a sandbox ceiling (default `workspace-write`), snapshotted
  onto the run at launch. Over the ceiling, a run default 422s at launch and
  a per-call `sandbox` option fails that agent at execution
  (`sandbox_not_allowed` — a direct `agent()` call throws; inside
  `parallel()`/`pipeline()` the slot degrades to `null`). The grant is
  raising the ceiling to `"danger-full-access"` via
  `PUT /projects/:id/workflow-policy` — unless you know the project granted
  it, design for `read-only` and `workspace-write`.
- Sandbox levels map to bb permission modes, and each provider derives its own
  enforcement from them — the guarantees differ per provider. **Worktree
  isolation is the only hard boundary for parallel mutators.**

Concurrency is fixed by server policy at 8 agents per run — there is no
override. You can still pass 100 items to `parallel()`/`pipeline()` and all
complete; excess calls queue and run as slots free up. Total `agent()` calls
per run are capped at 1000 (a runaway-loop backstop), and a single
`parallel()`/`pipeline()` call accepts at most 4096 items — exceeding either
is an explicit error, never silent truncation. A host also admits a limited
number of concurrent runs; over-cap runs report `created` ("queued — starts
when the host has capacity") until a slot frees.

## pipeline() over barriers

DEFAULT TO `pipeline()`. Only reach for a barrier (`parallel()` between stages)
when you genuinely need ALL prior-stage results together.

A barrier is correct ONLY when stage N needs cross-item context from all of
stage N-1:

- Dedup/merge across the full result set before expensive downstream work
- Early-exit if the total count is zero ("0 bugs found → skip verification")
- Stage N's prompt references "the other findings" for comparison

A barrier is NOT justified by:

- "I need to flatten/map/filter first" — do it inside a pipeline stage:
  `pipeline(items, stageA, r => transform([r]).flat(), stageB)`
- "The stages are conceptually separate" — that's what `pipeline()` models.
  Separate stages ≠ synchronized stages.
- "It's cleaner code" — barrier latency is real. If 5 finders run and the
  slowest takes 3× the fastest, a barrier wastes 2/3 of the fast finders' time.

Smell test: if you wrote

```js
const a = await parallel(...);
const b = transform(a);       // flatten, map, filter — no cross-item dependency
const c = await parallel(b.map(...));
```

that middle transform doesn't need the barrier. Rewrite as a pipeline with the
transform inside a stage. When in doubt: pipeline.

The canonical multi-stage pattern — each dimension verifies as soon as its
review completes:

```js
export const meta = {
  name: "review-changes",
  description: "Review changed files across dimensions, verify each finding",
  phases: [{ title: "Review" }, { title: "Verify" }],
};
const DIMENSIONS = [{ key: "bugs", prompt: "..." }, { key: "perf", prompt: "..." }];
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: "Review", schema: FINDINGS_SCHEMA }),
  review => parallel(review.findings.map(f => () =>
    agent(`Adversarially verify: ${f.title}`, { label: `verify:${f.file}`, phase: "Verify", schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v }))
  ))
);
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal);
return { confirmed };
// Dimension "bugs" findings verify while "perf" is still reviewing. No wasted wall-clock.
```

When a barrier IS correct — dedup across all findings before expensive
verification:

```js
const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, { schema: FINDINGS_SCHEMA })));
const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings)); // needs ALL at once
const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), { schema: VERDICT_SCHEMA })));
```

Loop-until-count — accumulate to a target:

```js
const bugs = [];
while (bugs.length < 10) {
  const result = await agent("Find bugs in this codebase.", { schema: BUGS_SCHEMA });
  bugs.push(...result.bugs);
  log(`${bugs.length}/10 found`);
}
```

Loop-until-budget — scale depth to the run's token ceiling. Guard on
`budget.total`: with no ceiling, `remaining()` is `Infinity` and the loop runs
straight to the 1000-agent cap. (Budgets are set at launch via the API or the
Run dialog, not the CLI.)

```js
const bugs = [];
while (budget.total && budget.remaining() > 50_000) {
  const result = await agent("Find bugs in this codebase.", { schema: BUGS_SCHEMA });
  bugs.push(...result.bugs);
  log(`${bugs.length} found, ${Math.round(budget.remaining() / 1000)}k tokens remaining`);
}
```

Composing patterns — exhaustive review (find → dedup vs seen → diverse-lens
panel → loop-until-dry):

```js
const seen = new Set(), confirmed = [];
let dry = 0;
while (dry < 2) {                                               // loop-until-dry
  const found = (await parallel(FINDERS.map(f => () =>           // barrier: collect all finders this round
    agent(f.prompt, { phase: "Find", schema: BUGS })))).filter(Boolean).flatMap(r => r.bugs);
  const fresh = found.filter(b => !seen.has(key(b)));            // dedup vs ALL seen — plain code, not an agent
  if (!fresh.length) { dry++; continue; }
  dry = 0; fresh.forEach(b => seen.add(key(b)));
  const judged = await parallel(fresh.map(b => () =>             // every fresh bug judged concurrently...
    parallel(["correctness", "security", "repro"].map(lens => () =>  // ...each by 3 distinct lenses
      agent(`Judge "${b.desc}" via the ${lens} lens — real?`, { phase: "Verify", schema: VERDICT })))
      .then(vs => ({ b, real: vs.filter(Boolean).filter(v => v.real).length >= 2 }))));
  confirmed.push(...judged.filter(v => v.real).map(v => v.b));
}
return confirmed;
// dedup vs `seen`, NOT `confirmed` — else judge-rejected findings reappear every round and it never converges.
```

Quality patterns — common shapes; pick by task and compose freely:

- **Adversarial verify**: spawn N independent skeptics per finding, each
  prompted to REFUTE. Kill if ≥majority refute. Prevents plausible-but-wrong
  findings from surviving.
- **Perspective-diverse verify**: when a finding can fail in more than one
  way, give each verifier a distinct lens (correctness, security, perf,
  does-it-reproduce) instead of N identical refuters.
- **Judge panel**: generate N independent attempts from different angles,
  score with parallel judges, synthesize from the winner while grafting the
  best ideas from runners-up. Beats one-attempt-iterated when the solution
  space is wide.
- **Loop-until-dry**: for unknown-size discovery, keep spawning finders until
  K consecutive rounds return nothing new. Simple counters miss the tail.
- **Multi-modal sweep**: parallel agents each searching a different way
  (by-container, by-content, by-entity, by-time). Useful when one search angle
  won't find everything.
- **Completeness critic**: a final agent that asks "what's missing — modality
  not run, claim unverified, source unread?" What it finds becomes the next
  round of work.
- **No silent caps**: if a workflow bounds coverage (top-N, no-retry,
  sampling), report what was dropped IN THE RETURN VALUE (e.g. a
  `dropped`/`coverage` field) — silent truncation reads as "covered
  everything" when it didn't, and `log()` lands only in the unrendered event
  journal where no consumer sees it.

Scale to what the user asked for. "find any bugs" → a few finders, single-vote
verify. "thoroughly audit this" → larger finder pool, 3–5 vote adversarial
pass, synthesis stage. These patterns aren't exhaustive — compose novel
harnesses when the task calls for it.

## Worktrees

`agent({ worktree: true })` runs the agent in a fresh git worktree on a
runtime-derived `wf/<runId>-<agentIndex>` branch (retried attempts append
`-r<attempt>`, so a prior attempt's preserved branch is never clobbered). It
is EXPENSIVE (setup + a
provider process per worktree) — use it ONLY when agents mutate files in
parallel and would otherwise conflict. A worktree agent always runs
workspace-write (scoped to its worktree) regardless of any `sandbox` option,
so the run's sandbox ceiling must allow workspace-write: under a `read-only`
ceiling every `worktree: true` agent fails with `sandbox_not_allowed`. An unchanged worktree is auto-removed;
a changed one keeps its branch. A COMPLETED agent's preserved branch is
reported in the run's journal and on the run page; a FAILED agent's dirty
worktree is also preserved on disk, but its branch rides no journal entry and
is invisible on the run page — list `wf/<runId>-…` branches in the repo to
recover a failed agent's partial work.

## Determinism and resume

Every completed `agent()` call is journaled server-side. If a run is
interrupted (host daemon restart, lease expiry), it can be resumed:
`bb workflow resume <id>` replays the completed prefix instantly and free
(those agents show `cached`), then re-runs only the remainder. Failed agents
never replay from cache. This is why `Date.now()`/`Math.random()` are banned —
they would diverge the replay.

What resume is NOT: it is not edit-and-rerun. Resume is gated to `interrupted`
runs only (`completed`/`failed`/`cancelled` are immutable) and replays the
server-snapshotted source from launch time — editing the file on disk never
affects an existing run. Each new `bb workflow run` is a fresh journal. To
iterate on a script, fix it and launch again. Within one run, pin a call with
`opts.key` when its prompt embeds upstream results: failed agents never
replay, so on resume a failed upstream re-runs and may answer differently,
changing this call's default prompt-hashed key and discarding its cached
slot — an explicit key keeps the slot stable through that.

`bb workflow wait <id>` exits `4` when the run is interrupted (waiting alone
never settles it) and tells you to resume; the run page shows "n of m agents
cached" before you confirm a resume.

## CLI commands

```
bb workflow list [--project <id>] [--host <id>] [--json]
bb workflow validate <file> [--json]
bb workflow run <file.workflow.js | name> [--args '<json>'] [--effort <level>]
                [--project <id>] [--host <id>] [--wait] [--timeout <seconds>]
                [--no-context-anchor-thread] [--json]
bb workflow runs [--project <id>] [--limit <n>] [--json]
bb workflow show <id> [--json]
bb workflow wait <id> [--timeout <seconds>] [--poll-interval <ms>] [--json]
bb workflow cancel <id> [--json]
bb workflow resume <id> [--json]
bb workflow save <file> [--json]
```

- `validate` runs entirely locally — the pure-literal meta parse + determinism
  lint that IS the server's script gate, so a file that validates clean never
  fails launch-time SCRIPT validation. Launch additionally applies run policy,
  which `validate` cannot see: `defaultSandbox: "danger-full-access"`
  validates clean but is rejected at launch unless the project's workflow
  policy ceiling grants it, as is a provider override outside the catalog.
  Always validate before running a file you wrote.
- `run` prints `Workflow run started: wfr_…` and the live
  `…/workflows/runs/<id>` link FIRST, then waits only if `--wait` (default
  wait timeout 600s). Without `--wait` it prints a
  `Re-attach: bb workflow wait <id>` hint and returns immediately. `--json`
  prints the run response object. Exit codes with `--wait` (and for `wait`):
  0 completed, 1 failed/cancelled, 2 deadline, 4 interrupted (with a resume
  hint).
- `show` renders status, resolved defaults, usage, the result, and the
  phase-grouped agent tree.
- `cancel` works on any non-terminal run; cancelled runs are never revived.
  `resume` works on interrupted runs only.
- `--project` defaults to `$BB_PROJECT_ID`, which is set in your shell.

## Saved / named workflows

`run` accepts a bare name instead of a path (anything path-like or ending in
`.js` is treated as a file). A name is the workflow's **`meta.name`** — not its
filename — and resolves across three tiers, highest precedence first:

1. **project** — every `.bb/workflows/` directory from the run's workspace up
   to the repo boundary (nearer shadows farther). Author project workflows
   here: they version and review with the code.
2. **user** — `<dataDir>/workflows/` on the host. `bb workflow save <file>`
   validates and copies a file here (local host only), making it visible to
   every project on the host.
3. **builtin** — shipped with bb.

`bb workflow list` shows everything visible to the project with its tier.

Two built-ins ship with bb:

- **`deep-research`** — `bb workflow run deep-research --args '"<question>"'`
  (or `--args '{"question": "..."}'`): scope → 5 parallel web searches →
  fetch/dedup top sources → 3-vote adversarial verification per claim → cited
  report.
- **`code-review`** —
  `bb workflow run code-review [--args '{"target": "...", "level": "high|xhigh|max"}']`:
  one finder per review angle, an independent verifier per finding
  (CONFIRMED/PLAUSIBLE/REFUTED), a gap-sweep at xhigh/max, ranked capped
  report.

## Running a workflow for a user (from an agent)

Launched from a thread shell, a run automatically anchors to your thread
(`BB_THREAD_ID`) and inherits the thread environment's host and workspace —
the run's live progress renders directly in the thread timeline. `--host`
overrides the target host; `--no-context-anchor-thread` launches detached.

- **Surface the live link immediately.** `run` prints
  `…/workflows/runs/<id>` the moment the run starts — share it (managers: via
  `message_user`) before the run finishes so the user can watch the phase tree
  and per-agent timelines stream live.
- **Don't poll.** In a manager thread, launch without `--wait` and end your
  turn — bb sends you a system message when the run settles (and an
  informational one if it is interrupted). Never loop on `bb workflow show`.
  In a standard thread, use `--wait` (or re-attach later with
  `bb workflow wait <id>`) and read the result from stdout.
- **Fetch results structurally.** A workflow's return value is the run's
  `resultJson` — `--wait`/`wait` print it, `show --json` includes it. Design
  workflows to return structured data (use `schema` on the final synthesis
  agent or return an object) so the consuming agent doesn't re-parse prose.
- **No nesting.** Workflow agents run in restricted shells without the `bb`
  CLI — a workflow can never launch workflows or spawn threads. Never write a
  workflow whose agents are prompted to run `bb` commands.
