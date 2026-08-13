# Model takeover and Quick Review

**Date:** 13 August 2026  
**Status:** Approved product direction; implementation not started  
**First slice:** seamless cross-provider takeover plus one-model adversarial review

## Plain-English summary

BB will add one entry point, **Bring in another model**, with two jobs:

1. **Take over** continues the work in a replacement thread using a chosen provider, model, and reasoning level. BB opens the replacement in the same pane and archives the source only after the replacement has actually started. The source remains recoverable.
2. **Quick Review** asks one independently chosen model to challenge the current work without replacing the current agent. The reviewer runs in the background and returns a compact, evidence-linked review to the source thread.

This slice does not include a multi-model debate. Usage of Quick Review must earn that additional cost and complexity.

## Problem

An existing BB thread is committed to one provider. A user can change models only within the provider's supported session behaviour. Moving from Claude Code to Codex, for example, requires the user to open a new thread, mention the old thread, repeat the workspace selection, choose a model, submit, navigate, and tidy up the source.

BB's existing **Handoff to new thread** shortcut removes only part of that work: it opens the new-thread composer with an `@thread` mention and reused environment, but still leaves creation, model selection, submission, navigation, and cleanup to the user.

BB can also orchestrate independent agents through Workflows, but there is no ordinary thread action for asking a different model to review the current work. Users must know how to prompt an agent or author a workflow.

## Product principles

- **One control, two intents.** Takeover preserves momentum; review protects quality. They must not be presented as interchangeable model settings.
- **No false continuity.** A cross-provider takeover cannot clone another provider's private session state. BB transfers durable context: conversation, thread reference, workspace, attachments and execution choices.
- **Fail recoverably.** The source is archived, never deleted. It is archived only after the target provider accepts and starts the replacement turn.
- **Independent means independent.** Quick Review receives a neutral context pack. The current agent does not choose what evidence the reviewer may see.
- **Review does not silently become implementation.** The reviewer is explicitly instructed not to edit files or send external messages. The first slice relies on that agent contract; hard read-only provider permissions are a separate platform concern.
- **Agents get the same feature.** Both actions ship through the SDK and CLI as well as the app.

## Experience

### Entry point

The existing thread model picker keeps same-provider model and reasoning changes. Its footer action changes from **Handoff to new thread** to **Bring in another model**.

Selecting the action opens the shared responsive drawer. It starts with two large choices:

- **Take over this thread** — Continue with another model.
- **Review this work** — Get an independent challenge while staying here.

Both paths use the same native provider/model picker. On compact screens they use BB's persistent responsive drawer; no modal drawer is introduced.

### Take over

The user chooses provider, model, reasoning level, service tier when supported, and permission mode. The primary action reads **Continue with {model}**.

After confirmation:

1. BB creates a visible replacement thread in the same project and environment.
2. Its opening message is a structured continuation request containing an `@thread` reference to the source. Attachments that remain addressable are preserved as structured attachments.
3. BB navigates the current pane to the replacement as soon as it exists. A banner says **Taking over from {source thread}** while the first turn starts.
4. When the replacement emits `turn/started`, BB archives the source thread.
5. The replacement banner links to the archived source and offers **Restore source thread**.

If creation or turn start fails, BB leaves the source unarchived and shows the failure there. If navigation happened before the failure, the replacement shows **Takeover failed** with actions to return to the source or retry. Empty failed replacements may be archived by the user; they are not deleted automatically.

Same-provider model changes remain in place when the provider supports execution overrides. **Take over** is still available when the user deliberately wants a clean context window.

### Quick Review

The user chooses one provider/model and optionally replaces the default review question:

> Challenge the current work. Identify unsupported assumptions, missed risks, contradictory evidence, and the smallest changes that would materially improve the outcome. Do not edit files or take external action.

The primary action reads **Start review with {model}**. Starting it closes the drawer and adds a normal Workflow progress card to the source thread. The user can continue working while the review runs.

The reviewer receives:

- the source thread's rendered conversation up to the review start;
- the source thread title, project and environment identity;
- current plan/goal state when present;
- the current workspace diff summary and changed-file list;
- the full contents of changed text files only when already available within bounded context limits;
- the user's review question and explicit no-edit/no-external-action instruction.

The evidence pack is assembled by BB, not summarized by the current model. Large conversations and diffs use existing bounded timeline/diff APIs and include explicit truncation notices.

The completed result appears in the original thread as a **Quick Review** card with:

- **Verdict:** sound, revise, or stop;
- **Strongest challenge:** the most consequential issue;
- **Findings:** ordered, evidence-linked objections;
- **Recommended changes:** the smallest concrete improvements;
- **Uncertainty:** what the reviewer could not establish.

The card offers **Ask current model to respond**, which inserts a structured reference to the review into the source composer. It does not automatically steer a running turn.

## Architecture

### 1. Core thread takeover service

Add a server-owned `threads.handoff` operation. The server owns the lifecycle transaction because source archival must depend on the replacement's real provider state, not a browser remaining open.

Request:

- source thread ID;
- target provider, model, reasoning, service tier and permission mode;
- optional continuation text;
- `archiveSource: true` in the first UI, explicit in the contract.

Response:

- source thread ID;
- replacement thread ID;
- lifecycle state: `provisioning`, `started`, or `failed`.

The service validates the target execution catalog on the source environment's machine, builds the typed thread mention and attachment input, and calls the existing normal thread-create path with environment reuse. It does not use native provider fork because cross-provider sessions cannot be cloned.

Persist a small handoff record keyed by replacement thread ID with source ID, requested execution, status and timestamps. This makes archival restart-safe and gives the UI/CLI a truthful status. When the replacement emits `turn/started`, the lifecycle handler atomically marks the handoff started and archives the source. Terminal failure marks the handoff failed and leaves the source live.

No host-daemon protocol change is expected: the operation composes existing server-to-daemon thread creation and lifecycle events. If implementation changes any wire payload, `HOST_DAEMON_PROTOCOL_VERSION` must be incremented.

### 2. App takeover UI

Replace the current footer navigation callback with a launcher for a focused core drawer. Reuse the native provider/model picker and existing thread creation option hooks. The drawer submits through `threads.handoff`, navigates to the returned replacement, and reads server-owned handoff state for its banner.

The old location-state-only handoff remains supported for backward-compatible navigation until the new operation ships across app/server versions, then can be removed in a separate cleanup.

### 3. Quick Review in Workflows

Extend the builtin Workflows plugin rather than create another orchestration engine.

- The app contributes the **Review this work** half of the shared launcher.
- A plugin RPC accepts source thread ID, review question and target execution.
- The server builds a bounded neutral evidence pack using existing SDK thread, timeline and environment reads.
- It starts a fixed one-agent workflow whose structured result schema matches the Quick Review card.
- Existing workflow persistence, hidden worker threads, progress cards, cancellation, retry and completion notification remain authoritative.

The provider/model control uses the host picker exposed to plugin apps by the pending `experimental_ProviderModelPicker` work. If that API has not landed, implementation should stack on or wait for that prerequisite rather than create a second picker.

### 4. Agent, SDK and CLI surfaces

Core SDK:

- `sdk.threads.handoff(...)`
- `sdk.threads.handoffStatus(...)`

CLI:

- `bb thread handoff <source-id> --provider <id> --model <id> [execution flags]`
- waits until the replacement turn starts or fails, then prints both thread IDs and archival state;
- `--no-archive-source` is available for automation and debugging, while the app defaults to archival.

Quick Review remains a Workflows capability with a convenient command:

- `bb workflows quick-review --thread <id> --provider <id> --model <id> [--question <text>]`

The command starts the same fixed workflow as the UI and prints the run ID. It does not create a second review implementation.

All new CLI and SDK surfaces update the guide templates, builtin bb-cli/workflows skills, and generated plugin SDK declarations in the same change.

## Failure and safety behaviour

- Target provider/model missing or retired: fail before creating anything and keep the source unchanged.
- Target machine offline: show a retryable failure; do not archive the source.
- Replacement created but provider never starts: mark failed after the existing provisioning/watchdog outcome; source stays live.
- Server restart between creation and start: persisted handoff state is reconciled from the replacement thread's live timeline/status before archival.
- Double submit: use an idempotency key scoped to source thread and selected execution so one user action cannot mint two replacements.
- Source archived manually during takeover: replacement continues; the handoff record reports that the desired source state is already satisfied.
- Reviewer provider failure: existing Workflows retry policy applies and the source stays usable.
- Review context truncated: the result card must disclose the missing conversation/diff boundary; an empty evidence observation is a failed review, not a successful one.
- Reviewer changes files despite its contract: workflow completion reports the unexpected diff and marks the review **contaminated**. It never applies or commits those changes automatically.

## Testing and verification

### Takeover

- Contract tests reject unavailable providers/models and invalid source threads.
- Lifecycle tests prove the source is not archived before `turn/started`, is archived after it, and remains live on every creation/start failure.
- Restart reconciliation tests cover each persisted handoff state.
- Idempotency tests prove double submission creates one replacement.
- App tests cover provider/model selection, compact drawer behaviour, navigation, failure recovery and source restoration.
- CLI tests cover the command, JSON output and discoverable help/guide text.
- One real canary hands a disposable Codex thread to Claude Code and the reverse, proving each replacement visibly receives the source context and the old thread becomes recoverably archived.

### Quick Review

- Evidence-pack tests prove bounded timeline and diff collection, explicit truncation and a minimum observed-signal floor.
- Workflow tests prove the selected provider/model is used and the structured schema is enforced.
- UI tests cover progress, cancellation, terminal result states and **Ask current model to respond**.
- A deliberate reviewer file edit proves contamination is detected and surfaced.
- A real canary inserts a known contradiction into a disposable thread and proves the reviewer catches it; a review that merely completes green without identifying the planted issue does not pass acceptance.

## Delivery sequence

1. Land or stack on the plugin provider/model picker prerequisite.
2. Implement and verify core `threads.handoff`, SDK and CLI.
3. Replace the app's manual handoff shortcut with the takeover drawer.
4. Add the fixed Quick Review workflow, evidence pack and result card.
5. Run cross-provider and planted-contradiction canaries.
6. Push the branch, open a draft pull request, and let CI plus code review run. Do not merge or publish a BB release without explicit approval.

## Explicitly out of scope

- Multi-model panels or free-form model debates.
- Automatic application of reviewer suggestions.
- Deleting source threads.
- Pretending private chain-of-thought or provider session state transfers across providers.
- A new general-purpose permission mode solely for Quick Review.
- Review of external systems not already present in the thread or workspace.

## Success criteria

- A user can move a real thread from one provider to another with one selection-and-confirm action and recover the source afterward.
- A failed takeover never archives the source.
- A user can start a one-model adversarial review without authoring a prompt or workflow and keep working while it runs.
- Review output identifies evidence, uncertainty and concrete changes rather than returning generic approval.
- The UI, SDK and CLI execute the same server-owned behaviour.
