# Opulent Desktop — architecture

A self-training desktop agent control plane. It extends Opulent Cloud onto the user's own machines
(and onto Modal/Daytona sandboxes), runs opencode / Claude Managed Agents / Devin natively, and
records every invocation in a form that trains the next model.

Read `EVIDENCE.md` first: every `[Sn]` below points at a verified source. `DECISIONS.md` records the
settled calls: **bb is the trunk** (D1) and **Opulent will serve a model, with sub-agents authoring
the environments** (D2).

---

## 1. What each input actually contributes

The objective names ten repos. They are not ten peers — they occupy four distinct layers, and two of
them turn out to be the *same layer*, which is the one real conflict in the plan.

| Layer | Component | Source |
|---|---|---|
| Viewport | desktop window, transcript, composer, diff pane, terminals | Comet `crates/ui` (gpui) **or** bb `apps/{desktop,app}` (Electron+React) — see §2 |
| Session plane | threads, events, steering, journals, multi-device sync | Comet engine + Loro/DO `[S10,S12]`, bb server + host daemon `[S2]` |
| Agent plane | one interface over many coding agents | bb provider bridge `[S3]` + ACP `[S4,S5]`; Comet `Harness` trait `[S13]` |
| Execution plane | where the tool calls actually run | Modal Sandboxes `[S14,S16,S17,S18]`, Daytona, local machine |
| Learning plane | turn runs into training data | journal `[S12]` → Harbor `[S21]` → SkyRL `[S23]`; Repo2RLEnv `[S20]` for task synthesis |

Three inputs do **not** contribute architecture and should be scoped accordingly:
`synchronicity` is a Python async→sync codegen tool `[S26]` — only relevant if we publish a Python SDK.
`harvey-labs` is a legal benchmark corpus `[S24]`. `devin-security-evals` is 34 CVE fixtures `[S25]` —
it is an *input to Repo2RLEnv's `cve_patches` pipeline*, not a runtime component. The Ramp post could
not be read (JS-rendered) `[S27]`, so nothing here rests on it.

## 2. The conflict: Comet shell vs bb app

You asked for "comet as the shell, app, and design" **and** "the Opulent BB (bb app design, shell,
streaming, connections)". Those are two different programs in two different languages:

- Comet is Rust + gpui, one binary, headed or headless, sync via Loro CRDTs through Cloudflare
  Durable Objects `[S9,S10]`. Its strengths are exactly the ones you want for Outpost-style local
  access: the engine detaches from the viewport, runs headless on any box, and keeps working when
  the laptop lid shuts. Its harness layer supports three agents `[S13]` and its `HarnessId` enum is
  closed `[S11]`.
- bb is TypeScript + Electron + React + SQLite server + per-machine host daemon `[S1,S2]`. Its
  strengths are the ones you want for breadth: a documented plugin system, a conformance-tested
  provider-bridge protocol `[S3]`, a working ACP registry that already launches opencode `[S4]`, a
  user-extensible custom-agent schema `[S5]`, and a Modal sandbox backend behind a clean
  `SandboxBackend` interface `[S6]`.

You cannot have both as "the shell". **Decided: bb is the trunk, taken in full; Comet supplies the
design language and the detach model** (§9, `DECISIONS.md` D1). Everything else in this document is
stack-independent anyway — the provider contract, the execution-plane contract, and the trajectory
format are wire formats, and the scaffold in `packages/` is written and tested against them, so it
survives a later reopening of the Rust question.

## 3. Topology

```
                         ┌─────────────────────────── Opulent Cloud ───────────────────────────┐
                         │  identity · org/workspace · run index · trajectory store · training │
                         └───────▲──────────────────────────────────────────────▲──────────────┘
                                 │ sync (runs, threads, journals)               │ trajectories
                                 │                                              │
   ┌───────────── Opulent Desktop (user machine) ─────────────┐                  │
   │  viewport  ──local RPC──  engine                         │                  │
   │                             │                            │                  │
   │                    ┌────────┴─────────┐                  │                  │
   │                    │ session store    │  journals/*.jsonl ──────────────────┘
   │                    │ + run journal    │                  │
   │                    └────────┬─────────┘                  │
   │                             │ Provider Contract (§4)     │
   │        ┌────────────────────┼────────────────────┐       │
   │        │                    │                    │       │
   │   local ACP           managed-session       outpost-worker
   │   (stdio JSON-RPC)    (cloud loop, our exec) (their loop, our exec)
   │        │                    │                    │       │
   └────────┼────────────────────┼────────────────────┼───────┘
            │                    │                    │
       Execution Contract (§5): local | modal | daytona
```

Two invariants make this coherent:

**The journal is the spine.** Every run, on every provider, in every execution target, produces one
append-only JSONL file of normalized events `[S12]`. The UI replays-then-tails it, crash recovery reads
it, and the trajectory exporter (§6) consumes it. Nothing else needs to know how a run was produced.

**Provider and execution are orthogonal.** "Which agent thinks" and "where its tools run" are separate
axes. Devin Outposts is the proof: reasoning in Cognition's cloud, execution in your Modal sandbox
`[S17]`. Modal-cursor is the same shape `[S18]`. A design that fuses them cannot express either.

## 4. The Provider Contract

Three provider *classes*, distinguished by who owns the agent loop. This is the distinction Modal draws
between the Agent SDK and Managed Agents `[S15]`, generalized.

### 4a. `local-acp` — we own the process, the agent owns the loop

A child process speaking ACP (JSON-RPC over stdio). This is bb's existing mechanism `[S4]` and it
already covers three of your four required agents with **no new protocol work**:

| Agent | Launch | Status |
|---|---|---|
| opencode | `opencode acp` | ships in bb today `[S4]` |
| Cursor | `cursor-agent acp` | ships in bb today `[S4]` |
| **Devin CLI** | `devin acp` | **registerable now** via the custom-agent schema `[S5]`; `devin acp` speaks JSON-RPC over stdio and is built for exactly this `[S19]` |
| Claude Code | `claude --input-format stream-json --output-format stream-json` | not ACP — needs its own bridge; both bb `[S3]` and Comet `[S13]` already have one |

Devin CLI therefore lands as a first-class provider through configuration plus an icon and a default
entry, not through a new integration. That is the single highest-leverage finding in this research.

### 4b. `managed-session` — a hosted loop, our execution environment

Claude Managed Agents. Two halves `[S16]`:

- *Control plane* (runs in the Opulent engine): `sessions.create(agent, environment_id)` →
  `sessions.events.send(session_id, [{type:"user.message", …}])` → `sessions.events.stream(session_id)`.
  The stream is translated into our normalized events and appended to the journal.
- *Data plane* (runs in the sandbox): the worker entrypoint calls
  `beta.environments.work.worker(environment_key, workdir, max_idle).handle_item()`, with
  `ANTHROPIC_ENVIRONMENT_KEY` / `ANTHROPIC_WORK_ID` / `ANTHROPIC_SESSION_ID` injected. Session state
  persists on a Modal Volume sub-path so a session resumes after the sandbox dies.

Resume is a first-class operation here, not a reconnect: `events.list(session_id, order="asc")`
replays the whole session `[S16]`, which is exactly the journal's replay-then-tail contract.

### 4c. `outpost-worker` — their loop, their queue, our machines

Devin Outposts. Cognition owns an outpost queue; we run the data plane: an orchestrator watches the
queue and starts one isolated sandbox worker per queued session `[S17]`. modal-cursor is the identical
pattern against Cursor's pending-request API `[S18]`. Both worker kinds connect **outbound only** —
no inbound port, no public IP `[S18]` — which is what makes "local machine access like Outposts" safe
to offer: the user's laptop dials out, nothing dials in.

Event fidelity here is lower by construction (we see queue and worker lifecycle, plus whatever the
worker emits, not the agent's internal token stream). The journal records that honestly via a
per-run `fidelity` field, and §6 refuses to emit token-level training data from a low-fidelity run
rather than fabricating it.

### Normalized event grammar

Comet's `AgentEvent` `[S11]` is the right normalized shape and I adopt it verbatim, because it is
already the union of Claude Code and Codex semantics and it round-trips through serde with tests:

```
sessionStarted · textDelta · reasoningDelta · assistantMessageCompleted
toolCall · toolResult · usage · error
inputRequested · inputResolved · steered · done
```

with `ToolCall ∈ {exec, readFile, writeFile, editFile, applyPatch, search, glob, webFetch, webSearch,
todo, mcp, unknown}`. Two additive extensions Opulent needs, both `serde(default)` so old journals
still parse:

1. `HarnessId` becomes an open string (Comet's is a closed enum of four `[S11]`; we need
   `opencode`, `devin-cli`, `claude-managed`, and user-registered agents).
2. `sessionStarted` gains `execution: {target: "local"|"modal"|"daytona", ref: string}` and
   `fidelity: "token"|"event"|"lifecycle"`.

bb's bridge doctrine applies unchanged: **the bridge knows the dialect, the runtime knows the
timeline** `[S3]`. Providers emit deltas; the runtime mints ids and owns ordering. Every new provider
must pass the conformance kit before it ships.

## 5. The Execution Contract

bb already has the right interface. `SandboxBackend<Inputs, Resource>` `[S6]` requires exactly:

```
definition · parseInputs · parseResource · allocationKey
availability() · validate(inputs)
create(ctx) -> {resource, executor}
suspend(ctx) · resume(ctx) · remove(ctx) · reconcileCleanup(ctx)
```

Modal implements it today `[S6]`. Daytona is a new implementation of the same interface — and bb
contains zero references to Daytona `[S8]`, so this is genuinely new code, not a rename. Local
execution is the degenerate case (`create` returns the existing checkout; `suspend`/`resume` are
no-ops), which is how the same desktop app serves "regular use" without a cloud account.

The lifecycle states come from bb's environment engine `[S7]`: `creating → provisioning → ready|error`,
with `claimPath` reserving a path before any provider mutates it, `attempt` making retries idempotent,
and terminal-on-create-failure semantics. That design already survived a migration away from a parallel
provisioning phase; reproducing it is cheaper than rediscovering why it exists.

Modal specifics worth pinning now, because they shape the images:

- opencode runs as `modal.Sandbox.create("opencode","serve","--hostname=0.0.0.0","--port=4096",
  encrypted_ports=[4096], …)`, reached at `sandbox.tunnels()[4096].url` `[S14]`. The desktop app can
  therefore *attach* to a cloud opencode the same way `opencode attach <url>` does — the same session
  is drivable from the UI, the TUI, and a browser.
- The reference clones the repo into the **image at build time** `[S14]`. For Opulent that is wrong for
  interactive use (every branch change rebuilds); use a Volume-mounted checkout and keep image builds
  for the toolchain only.
- CMA sandboxes persist per-session state on a Volume sub-path `[S16]`; reuse that for all three
  provider classes so suspend/resume is uniform.

## 6. The Learning Plane

This is the part that makes it "self-training", and it has a hard correctness constraint: **SkyRL
trains on token ids, and most of our runs will not produce them.**

### What SkyRL actually wants

`GeneratorOutput` is a dict with exactly these keys `[S23]`:

```
prompt_token_ids, response_ids, rewards, loss_masks, stop_reasons,
rollout_metrics, rollout_logprobs, trajectory_generation_times, trajectory_time_splits
```

The recipe's TITO agent supplies `tito_tokens` / `tito_loss_mask` / `tito_logprobs` from its own
inference path, precisely to avoid re-tokenization drift `[S23]`. A Claude Code or Devin run through a
vendor API gives us none of that. Pretending otherwise would produce silently corrupt training data.

So the pipeline has two tiers, and the exporter enforces the boundary:

| Tier | Source | Produces | Use |
|---|---|---|---|
| **Tier 1 — trajectory** | any run, any provider | normalized journal + reward + metadata, in `GeneratorOutput`-compatible *structure* with token fields null | eval, SFT-style distillation, rubric scoring, regression corpora |
| **Tier 2 — TITO** | runs against an Opulent-served model where we own the sampler | full `prompt_token_ids` / `response_ids` / `loss_masks` / `rollout_logprobs` | on-policy RL exactly as the recipe does it `[S22]` |

`packages/trajectory` implements this: `journalToTrajectory()` always succeeds; `toGeneratorOutput()`
throws on any record lacking token ids rather than emitting zeros. The tests assert that refusal.

### Where rewards come from

Harbor's contract `[S21]`: the verifier writes `/logs/verifier/reward.txt`; reward kinds are
`test_execution` (executable test) and `diff_similarity` (oracle diff). Repo2RLEnv emits task dirs in
exactly that layout `[S20,S21]`, and the SkyRL recipe consumes prebuilt Harbor task dirs as parquet
rows `{path, task_binary}` `[S22]`.

### The loop

```
 run in Opulent Desktop ──► journal.jsonl ──► trajectory record (Tier 1)
        │                                            │
        │                                            ├─► eval / regression corpus
        │                                            └─► Tier 2 when Opulent-served ──► SkyRL train
        │
        └─ run happened in a repo ──► Repo2RLEnv (pr_runtime | cve_patches | …) ──► Harbor task dir
                                                     │
                                       devin-security-evals fixtures [S25] seed cve_patches
                                                     │
                                              HF dataset ──► SkyRL trials [S22]
```

`packages/harbor` writes the task dir byte-compatibly with `[S21]`: `task.toml` with
`version="1.0"`, `task.name` in `<org>/<slug>` form, `metadata.repo2env.{spec_version, content_hash,
reward_kinds}`, `instruction.md`, `solution/patch.diff`, `solution/solve.sh` at mode 0755, and
optional `environment/Dockerfile` + `tests/test.sh` at 0755.

## 7. Local ACP composability

bb's custom-agent schema `[S5]` is the whole feature. A user (or Opulent itself) drops a record with
`{id, displayName, command, args, env, cwd, dialect, modelCli, reasoningCli, permissionCli,
nativeSkillRoots}` and the agent appears in the picker with model selection, reasoning levels, and
permission modes wired up. `packages/providers` ships the four defaults as data in exactly that shape,
including `devin-cli → devin acp` `[S19]`, so "native use of opencode, devin CLI, and Claude managed
agents" is configuration, not integration.

`nativeSkillRoots` is worth preserving carefully: bb resolves per-agent skill directories
(`.opencode/skills`, `.claude/skills`, `.agents/skills`, …) with `recursive`/`ancestors` semantics
`[S4]`, which is how one skill library serves every agent. Opulent's own `.agents/skills` convention is
already in that list.

## 8. Opulent controlling the desktop app

"We will use Opulent to control the desktop app" needs an explicit surface, and Comet already proved
the shape: the engine serves a typed RPC on a localhost IPC port whether the viewport is in-process or
separate, and any viewport can attach `[S10]`. Opulent Cloud becomes one more client of that same
interface — reached through the outbound device channel, never an inbound port `[S18]`. Commands ride a
durable queue rather than device-addressed RPCs so they survive the device being offline, which is the
change Comet made deliberately `[S28]`.

That gives three symmetric drivers of one engine: the desktop viewport, the TUI, and Opulent Cloud.
Self-training closes when the cloud driver runs a Harbor task on the device, reads the journal, and
files the trajectory — with no human in the loop.

## 9. Stack decision (settled)

**bb is the trunk, taken in full; Comet supplies the design language and the detach model.**

The reasoning is asymmetry of effort. Porting bb's provider-bridge protocol, ACP registry, plugin
system, conformance kit, and `SandboxBackend` interface into Rust is months of work reproducing
`[S3,S4,S5,S6]`, all of which already exists and is tested. Porting Comet's *design language* and its
*detach semantics* onto bb's Electron shell is a UI project plus one lifecycle change — and bb already
separates server from host daemon `[S2]`, which is 80% of the detach model.

What we keep from Comet regardless of the stack decision: the `AgentEvent` grammar `[S11]`, the JSONL
run journal with crash recovery `[S12]`, the durable command queue `[S28]`, the headless/attach
lifecycle `[S10]`, and the visual design.

The Rust/gpui shell is shelved, not cancelled. It buys a 12 MB TUI, no Electron, and a genuinely
superior detach story; it costs reimplementing the provider and plugin layers and moves the first
shipping milestone out by roughly a quarter. Everything in `packages/` is deliberately wire-format
work, so reopening that question later costs the shell and nothing below it.

## 10. Milestones

| # | Milestone | Exit criterion |
|---|---|---|
| M0 | Contracts | *done* — 7 packages, 86 tests, Harbor cross-check against Repo2RLEnv |
| M1 | bb fork + branding pass | fork `get-bb/bb`, Opulent identity replaces bb marks, Comet design language applied, build green |
| M2 | Providers: opencode + Devin CLI over local ACP | both appear in the picker and complete a real run; `packages/acp` already owns the translation, so this milestone is process spawn + stdio framing + the conformance kit |
| M3 | Execution: Daytona `SandboxBackend` | parity with the Modal backend against the same interface `[S6]` |
| M4 | Provider: Claude Managed Agents | session create/send/stream/resume with a Modal-sandbox data plane `[S16]` |
| M5 | Provider: Devin Outpost worker | orchestrator claims a queued session and runs it in a sandbox `[S17]` |
| M6 | Cloud control channel | Opulent Cloud drives a device over the outbound queue; commands survive offline |
| M7 | Sub-agent environment authoring | an author sub-agent proposes Harbor tasks; `packages/envauthor` admits only those whose base run fails and oracle run passes; admission rate reported per batch |
| M8 | Opulent-served model + TITO capture | an Opulent-native provider emits `fidelity: "token"` with real token ids and loss masks; `toGeneratorOutput()` succeeds on a live batch |
| M9 | Self-training loop closed | a cloud-driven Harbor task run on a device yields a trainable trajectory that reaches a SkyRL batch, end to end |
