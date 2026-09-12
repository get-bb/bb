# Opulent Desktop

A self-training desktop agent control plane: one app that runs opencode, Devin, Claude Managed Agents
and Cursor natively, executes their tool calls locally or in Modal/Daytona sandboxes, and records
every run in a format that trains the next model.

This directory holds the **design and the wire contracts**, verified against real sources. Both
blocking decisions are now settled:

- **D1 — bb is the trunk**, taken in full. Comet supplies the design language and the detach model.
  The Rust/gpui shell is shelved, not cancelled.
- **D2 — Opulent will serve a model.** Tier 2 RL is in scope, TITO token capture goes into the agent
  runtime, and sub-agents author the training environments behind an execution gate.

## Read in this order

| File | What it is |
|---|---|
| `ARCHITECTURE.md` | The design. Four planes: viewport, session, agent, execution, learning. |
| `DECISIONS.md` | D1 and D2 settled with their accepted costs; D3–D7 still open. |
| `EVIDENCE.md` | Every claim mapped to a cloned repo or fetched doc, with exact paths. |

## What is implemented

Seven packages of pure, dependency-free TypeScript — the contracts that outlive any shell choice:

| Package | Contract |
|---|---|
| `packages/events` | Normalized `AgentEvent` grammar + append-only JSONL journal with crash recovery |
| `packages/acp` | ACP v1 `session/update` → `AgentEvent` translation: one adapter covers every ACP agent |
| `packages/compaction` | Middle truncation — pair-safe context compaction so a `max_tokens` stop recovers instead of failing |
| `packages/providers` | The provider registry: opencode, Devin CLI, Claude Managed Agents, Devin Outpost, Cursor |
| `packages/trajectory` | Journal → trajectory record → SkyRL `GeneratorOutput`, with a hard refusal to fabricate tokens |
| `packages/envauthor` | Admission gate for sub-agent-authored environments: base must fail, oracle must pass |
| `packages/harbor` | Harbor task-directory emitter, byte-compatible with Repo2RLEnv |

## Verify

```bash
npm install
npm run verify      # typecheck + 86 tests + cross-check against Repo2RLEnv's Python emitter
```

Current state: `tsc --noEmit` clean under `strict` + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`; 86/86 tests passing; the Harbor cross-check runs our emitter and
Repo2RLEnv's real `write_harbor_task` on the same task and compares all 7 files plus the parsed
`task.toml` tree.

## Four design points worth knowing before you read further

**Devin CLI is a configuration entry, not an integration.** `devin acp` speaks JSON-RPC over stdio
and is built to be launched by an ACP client as a subprocess. bb's custom-agent schema already
accepts exactly that record shape.

**Truncation recovers rather than fails — and says so.** An ACP `max_tokens` stop means the agent ran
out of window, not that the work was impossible. `compactMiddle()` keeps the head (task framing) and
the tail (live working set), replaces the span between with a factual summary, and resumes. Tool
calls are never separated from their results; questions are never separated from their answers. Every
compaction appends a `contextCompacted` event and increments `summarizationCount`, so a compacted
trajectory is never mistaken for one that ran clean.

**Sub-agents design environments, but cannot admit them.** Authoring a task with a reward attached is
where a self-training loop rots — a model left unsupervised drifts toward tasks it already passes. A
proposal enters the dataset only when two *observed* verifier runs agree: F2P fails on the base repo,
F2P passes and P2P holds under the oracle patch. That is Repo2RLEnv's `reward = f2p_rate * p2p_rate`
read backwards. An errored verifier is rejected rather than read as a failing base run, because those
two look identical and only one is evidence.

**The token-fidelity gate stays even though D2 said yes.** Vendor-hosted agents still cannot produce
token ids, so they keep reporting `event` or `lifecycle` fidelity and a test asserts none of them may
claim `token`. Once Opulent serves a model, an Opulent-native provider supplies a real `TokenTrace`
and `toGeneratorOutput()` starts succeeding. The gate is what stops a vendor-hosted run from
contaminating an on-policy batch.

## Reference clones

`/opulent/workspace/research/src/` holds shallow read-only clones of bb, comet, Repo2RLEnv,
apexagents-skyrl-recipe, modal-cursor, synchronicity, harvey-labs, devin-security-evals, and Modal's
Claude-Managed-Agents example. They are reference material, not vendored dependencies.
