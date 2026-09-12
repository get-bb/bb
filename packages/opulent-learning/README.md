# Opulent learning contracts — experimental, not runtime-enabled

This private workspace package imports the seven prototype modules from the Opulent Desktop investigation: events, ACP translation, context compaction, provider descriptions, trajectories, Harbor emission, and environment-admission predicates. Tests use Vitest and bb's shared-worker configuration; Turbo owns dependency ordering.

```sh
pnpm exec turbo run typecheck test --filter=@opulent/learning-contracts
```

## Integration boundary

M1 lands these modules in the monorepo, not in the running provider loop. bb's existing provider bridge, event assembler, CLI, plugins, database and host-daemon protocol remain authoritative. Do not replace those with this prototype event grammar. No new server/daemon wire fields are introduced.

- `compaction` transforms a client-side window. It does **not** change an ACP agent's internal context or recover a live `max_tokens` response. Native provider compaction or an explicit replay/continuation integration is required. Keep the raw journal immutable and record actual prompts, token sequences and compaction boundaries separately. A refusal is not a context overflow; compaction must not bypass refusals or permission decisions.
- `envauthor` evaluates supplied probe records. It does **not** execute or authenticate a verifier. Only a trusted isolated runner may supply these records; never accept an author agent's self-reported verdict. Bind evidence to the exact task/image/verifier digest before dataset admission. Existing predicates alone are not a production admission gate.
- Subscription-backed agents may author environments using their supported interfaces and permitted account usage. Their traces are authoring/evaluation evidence, not automatically on-policy training samples. No subscription credentials, customer data or hidden reasoning should be copied into datasets.
- Provider descriptions are plans, not registrations in bb. Existing bb OpenCode/Claude Code support is separate. New Devin, Managed Agents and Daytona runtime integrations remain future work.
- Token export requires real sampler-provided token ids, masks and aligned logprobs. Value validation does not authenticate the sampler or establish on-policy provenance. No serving, training job or paid provider call is started by this package.
- Harbor output is a set of files in memory. Execute untrusted Dockerfiles, patches and verifiers only inside isolated, disposable environments, with no host secrets. A writer must reject symlink escapes and reserved-path collisions before materializing files.

## Provenance

Based on the prior Opulent contract scaffold and research into get-bb/bb, Git-Godssoldier/comet, OpulentiaAI/Repo2RLEnv and Git-Godssoldier/apexagents-skyrl-recipe. Event shape inspiration: Comet, MIT, Copyright (c) 2026 Wing. Harbor emitter behavior follows Repo2RLEnv's Apache-2.0 implementation. Required upstream notices are retained in this directory. Research docs remain historical proposals, not proof of implemented runtime capability.
