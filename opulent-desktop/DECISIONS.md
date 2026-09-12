# Decisions

D1 and D2 are **decided** (2026-09-12). The rest are recorded so they do not get silently decided by
whoever writes the code first.

---

## D1 — DECIDED: bb is the trunk (Option A)

**bb trunk, in full. Comet's design language and detach model port onto it; the Rust rewrite is
shelved, not cancelled.**

Inherit the provider-bridge protocol with its conformance kit `[S3]`, the ACP registry that already
launches opencode `[S4]`, the custom-agent schema that makes Devin CLI a config entry `[S5]`, the
`SandboxBackend` interface Daytona plugs into `[S6]`, and the environment state machine `[S7]`.

Accepted costs, stated plainly so nobody rediscovers them as surprises:

- **Electron.** Heavier than a 12 MB native TUI. The bet is that provider coverage and the learning
  loop matter more in the first quarter than binary size.
- **Detach is bb's server/daemon split `[S2]`, not Comet's one-binary elegance `[S10]`.** It works —
  a daemon on an always-on host keeps running when the laptop closes — but reattach is a client
  reconnecting to a server, not a viewport reattaching to an embedded engine.
- **Comet's offline-tolerant durable command queue `[S28]` is a design we should copy later**, not
  something we inherit. bb's commands are device-addressed RPCs over the daemon WebSocket.

What "in full" means: we take bb's app design, shell, streaming and connections wholesale and
rebrand, rather than cherry-picking pieces. Divergence from upstream is therefore a real cost —
see D5.

Option B (Comet trunk) and Option C (split at the wire) are recorded in git history for whenever
the Rust question reopens. Everything in `packages/` is wire-format work that survives that reopening.

---

## D2 — DECIDED: yes, Opulent will serve a model — and sub-agents author the environments

**Tier 2 is in scope. "Self-training" is accurate, not aspirational.**

Two consequences, both now load-bearing:

**1. TITO capture goes into the agent runtime.** SkyRL trains on token ids: `GeneratorOutput`
requires `prompt_token_ids`, `response_ids`, `loss_masks` `[S23]`, and the recipe's agent produces
them from its own inference path to avoid re-tokenization drift. When Opulent serves the model, an
Opulent-native provider can emit `fidelity: "token"` with a real `TokenTrace`, and
`toGeneratorOutput()` starts succeeding instead of throwing.

The fidelity gate stays exactly as it is. Every vendor-hosted provider keeps reporting `event` or
`lifecycle`, and `packages/providers/providers.test.ts` still asserts that none of them may claim
token fidelity. The gate is not a placeholder for the pre-serving era — it is what keeps a
vendor-hosted run from silently contaminating an on-policy batch once serving exists.

**2. Sub-agents design the environments, behind an execution gate.** Environment authoring is a
generative act with a reward attached, which is precisely where a self-training loop rots: a model
left to write its own tasks drifts toward tasks it already passes. `packages/envauthor` is the
admission gate. A proposal enters the dataset only when two observed verifier runs agree —
F2P fails on the base repo, F2P passes and P2P holds under the oracle patch — which is Repo2RLEnv's
own `reward = f2p_rate * p2p_rate` contract `[S21]` read backwards. An errored verifier is rejected
rather than read as a failing base run, because those two look identical and only one of them is
evidence.

---

## D3 — Which Daytona surface backs the `SandboxBackend`?

bb has no Daytona code at all `[S8]`, so this is a fresh implementation of the seven-method interface
`[S6]`. The interface demands `suspend`/`resume`, and Modal satisfies them with snapshots. I need to
know which Daytona capability we are targeting (snapshot, stop/start, or nothing) before M3, because
"no suspend" changes the environment retirement policy rather than just the backend.

## D4 — Where does the trajectory store live?

Journals are local JSONL `[S12]`. Trajectories need to reach training. Options: Convex (matches the
existing Opulent runtime), object storage + a HF dataset repo (matches what the SkyRL recipe consumes
`[S22]`), or both with the dataset as an export. Leaning toward the third; it is not urgent, but the
journal-upload path in M6 depends on it.

## D5 — Licensing and provenance

bb is MIT © Michael Yong `[S1]`; Comet is MIT © Wing `[S9]`; Repo2RLEnv is Apache-2.0 `[S20]`. All
three permit a rebranded derivative with attribution. Rebranding to Opulent is fine. What needs an
explicit call: whether Opulent Desktop is published as an open fork with upstream attribution, or
kept private. That affects how aggressively we can diverge from bb's plugin API — divergence is cheap
if we never merge upstream again, expensive if we want to keep pulling from it.

## D6 — Devin CLI flag surface is documented, not probed

`devin acp` speaks JSON-RPC over stdio and is built for ACP clients `[S19]`, which is why it is
registered in `packages/providers`. I could not install the CLI here to enumerate its actual flags,
model list, or permission modes. Before M2 ships, run `devin acp --help` plus one real ACP handshake
on a machine that has it and reconcile `DEVIN_CLI.launch` with reality. The record is marked with that
caveat in its `notes` field rather than being presented as verified.

## D7 — Modal opencode images should not bake the repo

The reference example clones the repo into the image at **build time** `[S14]`. That is right for a
demo and wrong for interactive use: every branch switch becomes an image rebuild. Recommendation: keep
images for the toolchain, mount the checkout from a Volume, reuse the per-session sub-path pattern the
CMA example uses `[S16]`. Flagging it as a decision because it also determines how Repo2RLEnv images
and desktop images relate — sharing a base would let a Harbor task and an interactive session run in
the same environment, which is what makes M7 clean.
