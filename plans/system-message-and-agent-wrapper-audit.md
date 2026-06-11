# System Message And Agent Wrapper Audit

Last refreshed: 2026-06-10

## Goal

Make bb-generated messages consistent, easy to audit, and safe for agents to act on.

This audit covers:

- provider-level bb instructions appended to agent prompts
- agent-to-agent message wrappers
- parent-facing system messages about managed child threads
- schedule wakeup delivery
- frontend rendering behavior for generated system and agent messages

## Proposed Direction

- Use "managed thread" consistently for parent-facing coordination messages.
- Keep `[bb ...]` prefixes as machine-readable chrome, but keep the visible body clear and actionable.
- Terminal notices should include a bounded excerpt of the managed thread's final output, error output, or last useful transcript so the manager can decide next action without always opening the child thread.
- Agent-to-agent wrappers should identify the sender only; do not include reply instructions in the prefix or visible body.
- System-initiated schedule wakeups should have an explicit bb prefix instead of sending raw prompt text as an unwrapped system message.
- One-line generated messages should render as static preview rows, not expandable rows.

## Audit Table

| Surface | Before / Legacy Observed | Current Checkout | Proposed |
| --- | --- | --- | --- |
| Standard appended agent instructions | <pre>Same broad behavior observed: bb adds a short provider-level instruction block so agents know they are inside bb.</pre> | <pre>You are a coding agent working on a project thread inside bb, an agent orchestration tool.&#10;&#10;If you need to inspect bb context, message another thread, spawn or coordinate work, or manage scheduled follow-ups, use the `bb` CLI.</pre> | <pre>You are working inside bb, an agentic IDE that you can use via the `bb` CLI. If you need to orchestrate work across bb (create/inspect/message threads), or the user instructs you to use bb, you may use the `bb` CLI.</pre> |
| Agent-to-agent message wrapper | <pre>[bb message from thread:{{senderThreadId}}; reply with `bb thread tell {{senderThreadId}} "&lt;your response&gt;"`]&#10;&#10;{{messageText}}</pre> | <pre>[bb message from thread:{{senderThreadId}}; reply with `bb thread tell {{senderThreadId}} "&lt;your response&gt;"`]&#10;&#10;{{messageText}}</pre> | <pre>[bb message from thread:{{senderThreadId}}]&#10;&#10;{{messageText}}</pre> |
| Child or managed thread completed | <pre>[bb system] Managed thread complete: {{threadId}}{{titleSuffix}}&#10;Review that thread's result and decide whether to update the user or delegate a follow-up.&#10;Fresh managed child work usually lives in that thread's own worktree unless the manager explicitly reused an environment; do not reapply its edits into the manager checkout unless the user explicitly asked for that.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} completed.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} completed:&#10;&#10;{{finalOutputExcerpt}}</pre><br>`finalOutputExcerpt` should be capped at a fixed character limit, for example 4,000 characters, with an explicit truncation marker when clipped. If the thread has no final output, use a short fallback such as `No final output was recorded.` |
| Child or managed thread failed | <pre>[bb system] Managed thread failed: {{threadId}}{{titleSuffix}}&#10;Review that thread's error and decide whether to retry, clarify the task, or update the user.&#10;Inspect the managed thread directly before taking action; do not reapply its edits into the manager checkout unless the user explicitly asked for that.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} failed.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} failed:&#10;&#10;{{terminalOutputExcerpt}}</pre><br>`terminalOutputExcerpt` should prefer the failure/error output when available, then final output, then the last useful transcript excerpt. Cap it at the same fixed character limit as completion messages, with an explicit truncation marker and an empty-output fallback such as `No failure output was recorded.` |
| Child or managed thread interrupted | <pre>[bb system] Managed thread interrupted: {{threadId}}{{titleSuffix}}&#10;Inspect the managed thread directly before taking action. If it was stopped manually by the user, treat that as intentional; update the user if useful, but do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.&#10;Otherwise decide whether to resume it, redirect it, or update the user.&#10;Do not reapply its edits into the manager checkout unless the user explicitly asked for that.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} was interrupted. Inspect this thread directly before taking action. If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} was interrupted:&#10;&#10;{{terminalOutputExcerpt}}&#10;&#10;If the user stopped it manually, do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.</pre><br>`terminalOutputExcerpt` should prefer final output if one exists, then the last useful transcript excerpt. Use the same cap and truncation marker as completion and failure messages, with an empty-output fallback such as `No interruption output was recorded.` |
| Multiple child or managed thread outcomes | <pre>Older manager wording generally sent one lifecycle notice per managed thread.</pre> | <pre>[bb system]&#10;&#10;Multiple child threads updated:&#10;- {{threadMention}} completed.&#10;- {{threadMention}} failed.&#10;- {{threadMention}} was interrupted. Inspect this thread directly before taking action. If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.</pre> | <pre>[bb system]&#10;&#10;Managed thread updates:&#10;&#10;{{terminalOutcomeSections}}</pre><br>Each section should use the same shape as the singular terminal messages, with a smaller per-thread excerpt cap and an overall message cap. If the batch includes interrupted threads, include the manual-stop safety note once at the end instead of repeating it under every item. |
| Child or managed thread needs attention | <pre>[bb system]&#10;&#10;Managed thread needs attention: {{threadId}}{{titleSuffix}}&#10;The thread is blocked on a pending interaction. Inspect it and decide whether to ask the user, redirect the worker, or take another management action.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} needs attention.&#10;The thread is blocked on a pending interaction. Inspect it and decide whether to ask the user, redirect the child thread, or take another coordination action.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} needs attention.&#10;It is blocked on a pending interaction. Inspect the thread and decide if you can answer or resolve the question from existing context. If not, ask the user for the missing decision. If the worker is stuck on the wrong assumption, send it a clarifying instruction.</pre> |
| Thread ownership assigned | <pre>[bb system]&#10;&#10;The following thread is now assigned to you for management:&#10;{{threadLabel}}&#10;Inspect it and decide whether to monitor it, message the user, or send a follow-up.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} is now assigned to you as a child thread.&#10;Inspect it and decide whether to monitor it, message the user, or send a follow-up.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} was assigned to you.</pre> |
| Thread ownership removed | <pre>[bb system]&#10;&#10;The following thread is no longer assigned to you:&#10;{{threadLabel}}&#10;Stop treating it as one of your active managed threads unless it is assigned back later.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} is no longer assigned to you.&#10;Stop treating it as one of your active child threads unless it is assigned back later.</pre> | <pre>[bb system]&#10;&#10;{{threadMention}} was unassigned from you.</pre> |
| Scheduled thread wakeup | <pre>Some live prompts include user-authored wording such as `Scheduled nudge: ...`, but that is prompt text, not a server wrapper.</pre> | <pre>{{schedule.prompt}}</pre> | <pre>[bb schedule due:{{scheduleId}}]&#10;&#10;{{schedule.prompt}}</pre> |
| Frontend generated message rendering | <pre>Generated rows could look expandable even when the visible body was a single line, because generated messages were treated as expandable whenever they had non-empty text.</pre> | <pre>In this worktree, generated rows are expandable only when there is hidden content: additional body lines, one-line visual overflow, attachments, or turn request metadata.</pre> | <pre>Keep this behavior. It matches the proposed message model: one-line completion notices should be readable without a false expansion affordance.</pre> |

## Current Source References

- Agent-to-agent wrapper: `packages/templates/src/templates/agent-thread-message.md`
- Standard appended instructions: `packages/templates/src/templates/standard-agent-append-instructions.md`
- Child needs attention template: `packages/templates/src/templates/system-message-child-thread-needs-attention.md`
- Child outcome batch template: `packages/templates/src/templates/system-message-child-thread-outcome-batch.md`
- Thread ownership assigned template: `packages/templates/src/templates/system-message-thread-ownership-assigned.md`
- Thread ownership removed template: `packages/templates/src/templates/system-message-thread-ownership-removed.md`
- Outcome line formatting: `apps/server/src/services/threads/child-thread-notifications.ts`
- Ownership notification formatting: `apps/server/src/services/threads/thread-ownership.ts`
- Parent system message queueing: `apps/server/src/services/threads/parent-system-messages.ts`
- Schedule wakeup queueing: `apps/server/src/services/scheduling/thread-schedule-sweep.ts`
- Generated system / agent row rendering: `apps/app/src/components/thread/timeline/GeneratedConversationMessage.tsx`
- Prefix stripping and muted bb chrome: `apps/app/src/components/thread/timeline/compute-muted-prefix-length.ts`

## Fix Checklist

- Decide whether the canonical term is "managed thread" everywhere parent-facing.
- Remove reply guidance from the agent-to-agent wrapper; keep only sender identity in the bb prefix.
- Include capped output excerpts in completed, failed, and interrupted thread notifications, with clear truncation markers and empty-output fallbacks.
- Add title suffix support to current child outcome and needs-attention notifications if the visible body should include title context.
- Replace the terse completed and failed outcome lines with the proposed managed-thread variants.
- Rename user-facing "child thread" wording in parent notifications to "managed thread".
- Decide whether schedules should always receive a `[bb schedule due:...]` prefix.
- Keep the frontend generated-message static-row behavior for one-line system and agent messages.

## Validation

After implementation, run:

```sh
pnpm exec turbo run test --filter=@bb/templates
pnpm exec turbo run test --filter=@bb/server
pnpm exec turbo run test --filter=@bb/app -- ConversationMessageContent.test.tsx
pnpm exec turbo run typecheck --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/app
```

Manual QA:

- Send a short agent-to-agent message and confirm the receiver sees the sender chrome without raw reply guidance in the body.
- Complete a child or managed thread and confirm the parent sees the proposed completion wording.
- Fail and interrupt child or managed threads and confirm the parent gets actionable but non-retry-happy guidance.
- Trigger a pending interaction notification and confirm it says "managed thread needs attention".
- Trigger a schedule wakeup and confirm whether it appears with the chosen schedule wrapper.
- Confirm one-line generated messages do not show an expand affordance unless the preview actually overflows.
