# Claude Code Opus Model ID Investigation

Date: 2026-06-24

## Summary

`--model opus-4.8` is not a supported Claude Code model string in BB's current Claude Code catalog and is passed through to the Claude Agent SDK unchanged. The failed thread `thr_292b9i54y5` stored `execution.model: "opus-4.8"` and then recorded a Claude provider 404:

```text
There's an issue with the selected model (opus-4.8). It may not exist or you may not have access to it. Run --model to pick a different model.
```

The supported BB catalog string for current Opus 4.8 with 1M context is:

```bash
--provider claude-code --model 'claude-opus-4-8[1m]' --reasoning-level xhigh
```

`--model opus` works because the installed Claude Code CLI accepts `opus` as a moving alias. BB stored that raw alias for `thr_9a9bw3py36`, so the UI rendered the selected-only alias metadata rather than a concrete Opus 4.8 row. This branch updates the source catalog metadata for `opus` from legacy alias to current alias, but the better operational choice for new BB spawns is still the concrete active catalog id above.

## Evidence

Local CLI and database checks:

- `bb thread log thr_292b9i54y5` shows the provider error text above.
- `~/.bb/bb.db`, `events.sequence = 1` for `thr_292b9i54y5`, stores `execution.model: "opus-4.8"` with provider `claude-code`.
- `~/.bb/bb.db`, `events.sequence = 20` for `thr_292b9i54y5`, stores `provider/error` with `errorInfo.category: "bad-request"` and `httpStatusCode: 404`.
- `~/.bb/bb.db`, `events.sequence = 1` for `thr_9a9bw3py36`, stores `execution.model: "opus"`.
- `~/.bb/bb.db`, `events.sequence = 176` for `thr_9a9bw3py36`, stores `modelContextWindow: 1000000`, consistent with the alias resolving to a 1M-context Claude session.
- `bb provider models claude-code --json` reports `claude-opus-4-8[1m]` as the default active Opus row. It does not report `opus-4.8`.
- `claude --version` reports `2.1.186 (Claude Code)`, and `claude --help` documents `--model <model>` as accepting aliases such as `fable`, `opus`, or `sonnet`, or a full name such as `claude-fable-5`.

## Code Path

Claude Code model catalog:

- `packages/agent-runtime/src/claude-code/model-list.ts:54` defines `CLAUDE_OPUS_4_8_MODEL = "claude-opus-4-8"`.
- `packages/agent-runtime/src/claude-code/model-list.ts:66` sets the default Claude Code model to `withOneMillionContext(CLAUDE_OPUS_4_8_MODEL)`, which becomes `claude-opus-4-8[1m]`.
- `packages/agent-runtime/src/claude-code/model-list.ts:91` includes `claude-opus-4-8[1m]` in the active catalog as `Opus 4.8 (1M)`.
- `packages/agent-runtime/src/claude-code/model-list.ts:133` keeps retired concrete ids and moving aliases in `CLAUDE_CODE_SELECTED_ONLY_CATALOG`.
- `packages/agent-runtime/src/claude-code/model-list.ts:193` now labels raw `opus` as `Opus Alias (Current)` and gives it the same xhigh-capable reasoning ladder used by the current Opus catalog row.

CLI and server pass-through:

- `apps/cli/src/commands/thread/spawn.ts:175` declares `--model <model>` as a raw model id flag.
- `apps/cli/src/commands/thread/spawn.ts:227` sends `opts.model` directly to `sdk.threads.spawn`.
- `apps/server/src/services/threads/project-execution-defaults.ts:87` only checks whether a model was requested when project defaults are absent; it does not validate the requested model against the provider catalog.
- `apps/server/src/services/threads/thread-execution-plan.ts:259` resolves the execution model from request input, thread override, last execution, or project defaults. It does not canonicalize `opus-4.8`.
- `apps/server/src/services/threads/thread-commands.ts:261` copies the resolved model into runtime execution options.
- `packages/agent-runtime/src/claude-code/adapter.ts:1103` includes `command.options.model` in the Claude Code bridge `thread/start` request.
- `packages/agent-runtime/src/claude-code/bridge/session-options.ts:227` assigns `params.model` to the SDK session options.
- `packages/agent-runtime/src/claude-code/bridge/sdk-session.ts:192` passes `this.options.model` into the Claude Agent SDK `query()` call.

UI display path:

- `apps/app/src/hooks/useThreadCreationOptions.ts:330` prepends a matching `selectedOnlyModels` entry when the stored model is not in the active model list.
- `apps/app/src/hooks/useThreadCreationOptions.ts:363` maps `displayName || model` into picker labels.
- `apps/app/src/components/pickers/ModelReasoningPicker.tsx:146` finds the selected model option by raw model value, and `ModelReasoningPicker.tsx:172` renders that label in the trigger.

That is why a stored raw model of `opus` rendered from the selected-only alias row instead of the active `claude-opus-4-8[1m]` row.

## Root Cause

There are two related issues:

1. `opus-4.8` is a plausible human shorthand, but it is not a BB or Claude Code model id. BB accepts it at thread creation because create/spawn does not validate `model` against the provider catalog before provisioning. The invalid string reaches Claude Code unchanged and fails after the worktree has already been created.
2. `opus` is a Claude Code moving alias. BB intentionally keeps moving aliases out of the active catalog and stores/renders them from `selectedOnlyModels` when already selected. The selected-only metadata previously described the raw `opus` alias as legacy, which made successful `--model opus` threads look like they were on a legacy model even though Claude Code accepted the alias as current.

## Change Made

This branch includes the small source fix for issue 2:

- `packages/agent-runtime/src/claude-code/model-list.ts`
  - changed the selected-only `opus` display name to `Opus Alias (Current)`;
  - changed the description to say it is a Claude Code moving alias for current Opus;
  - changed its reasoning metadata to the xhigh-capable ladder and default high reasoning.
- `packages/agent-runtime/src/claude-code/model-list.test.ts`
  - added coverage for the updated `opus` alias label and reasoning support.

No compatibility alias was added for `opus-4.8`. That string was rejected by the provider and should not be recommended.

## Recommended Follow-Up

Add create/spawn model validation before provisioning:

1. Resolve the target provider with the same defaults path used by `resolveProjectExecutionDefaultsForCreate`.
2. Load that provider's active and selected-only model catalog, including configured custom models.
3. If the caller supplied a model that is not in the catalog, reject the create request with a 400 before creating a worktree.
4. Include the top active model choices in the error message, or point users to `bb provider models <provider>`.

This should mirror the validation already used for sticky thread model changes in `apps/server/src/services/threads/thread-execution-override.ts`, but it is not a one-line change: create currently supports new/reused environments and project-default resolution, and validation should not introduce a new hard dependency that breaks custom model or offline-host flows.

## Use Next

For the original use case, spawn with the active concrete model id:

```bash
bb thread spawn \
  --project proj_bfs26riapa \
  --provider claude-code \
  --model 'claude-opus-4-8[1m]' \
  --reasoning-level xhigh \
  --permission-mode full \
  --new-environment worktree \
  --title "Research native Win32 support" \
  --prompt "..."
```

Avoid `--model opus-4.8`. Use `--model opus` only if you intentionally want Claude Code's moving alias and accept that BB stores the alias string rather than the concrete resolved model id.
