# Compose, mentions, attachments, and voice

Status: **2026-09-05: 6 passed, 6 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

A synthetic project with text/image files and one authenticated provider. Use both the root composer and a thread follow-up composer.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `node apps/cli/dist/index.js` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/views/RootComposeView.tsx`
- `apps/app/src/components/promptbox/PromptBoxActionsMenu.tsx`
- `apps/app/src/components/promptbox/mentions/MentionMenu.tsx`
- `apps/cli/src/commands/thread/spawn.ts`
- `apps/cli/src/commands/voice.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Draft editing and persistence | Type multiline text, navigate away/back and reload; repeat with rich editing toggled. | Text and supported formatting survive according to draft scope; Enter/Shift+Enter obey the configured send behavior. |
| Project, environment, host, branch selection | Change each compose picker before submission, then inspect the created thread and environment. | The actual execution target matches the chips at send time. |
| Provider, model, reasoning, service tier | Open Provider, model and reasoning; select supported combinations and cycle forward/backward through keyboard actions. Turn off Settings → Providers → Allow fast service tier, then reopen the picker and inspect Fast mode. | Options reflect the live provider catalog, unsupported combinations are unavailable, and the created session uses the selection. Fast mode disappears while disallowed and returns when allowed. |
| Permissions and disabled actions | Change the permission picker and compare with the host ceiling; attempt submission with empty text, an attachment, and unavailable provider. | Submit eligibility and accepted permission mode reflect the real payload and host policy. |
| File and folder mentions | Type @, search a synthetic file and folder, select each, then modify the file before sending. | Provider-visible context uses the resolved send-time content and correct host path, not stale picker previews. |
| Thread, section, and plugin mentions | Mention a thread/section and an enabled plugin item (Docs, Tasks, GitHub, or Guide). | Resolved context names the chosen item; unavailable/removed items produce clear feedback. |
| Skills and slash commands | Open Prompt actions → Skills and a provider slash command; submit a harmless instruction using the selection. | Correct command/skill is attached and supported by the provider; no duplicate insertion or lost text. |
| Attachments | Attach text and image files via picker and drag/drop; remove one before sending; retry a failed upload. | Only retained attachments reach the thread; previews, filenames, sizes, and uploaded bytes agree. |
| Clipboard and quote into composer | Paste text and an image; select timeline text and Add to chat. | Content appears once with the right source context and can be removed before sending. |
| Voice input | Select a test microphone, start and stop recording, and compare a known clip with bb voice transcribe `<file>`. | Transcript enters the correct composer without an unintended send; denied permission and unavailable service are surfaced. |
| Prompt actions: plan, goal, automation, plugin | Select each offered action without submitting; inspect inserted text/provider action. Submit only a harmless supported plan/goal fixture. | Provider-specific actions appear only when supported; app actions preserve the existing draft. |
| Scheduled draft | Follow plugin-scheduled-send for scheduling from root and follow-up composers. | Attachments, mentions, execution options, and chosen time survive until dispatch. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.

## Maintenance notes

- Rich editing is Settings → General → Markdown formatting in prompt box and is client-local. Use Shift+Enter to create a newline; wait at least the 250ms draft persistence debounce before checking stored state. Source: `apps/app/src/views/SettingsView.tsx:545`.
- For branch/worktree coverage use a precommitted synthetic Git fixture; a new repository with no commits disables New worktree. A second enrolled test host is required for an actual host-change assertion. Source: `apps/app/src/views/RootComposeView.tsx:1067`.
- Composer cycles use Alt+M (model), Alt+P (provider), and Alt+T (reasoning); add Shift for backward. Fast mode is the service-tier switch. Read execution from accepted turn events to prove the sent combination. Source: `apps/server/src/services/system/app-keybindings.ts:240`.
- Use a distinct workspace filename with no same-named prior attachment for the send-time-content test. Verify the provider tool path as well as response text so an older attachment choice cannot be mistaken for stale workspace resolution. Source: `apps/app/src/hooks/pathMentionSuggestions.ts:15`.
- For synthetic project fixtures use skill list --project <id> --environment <id>; environment alone defaults project to personal and can return Environment not found. project commands also requires --provider <id>. Source: `apps/cli/src/commands/skill.ts:173`.
- For headless clipboard setup grant clipboard-read, clipboard-write and clipboard-sanitized-write, then write to clipboard and use real Ctrl+V. Distinguish whole-message Add to chat from selected-text quote coverage. Source: `apps/app/src/components/promptbox/PromptBoxInternal.tsx:1690`.

## Attachment accounting verification

There is no attachment inventory or cleanup command; accounting is server-internal
and only observable in the isolated QA database (`project_attachments`,
`project_attachment_threads`, `project_attachment_backfills`) plus the
`project-attachment-backfill` and `project-attachment-orphan-prune` sweep logs.
In a disposable project, upload a file through Prompt actions → Attach files and
schedule the prompt: the upload gets a ready `project_attachments` row and one
`project_attachment_threads` owner. Cancel the queued message and confirm the
ownership row survives. Wait for the backfill phase to reach `done`, then age only
these synthetic rows past the seven-day grace by setting `created_at` backwards and
let the 60s orphan-prune sweep run: the owned file and row stay, a separate unowned
upload disappears from the table and from `attachments/<project>/` on disk. Hard-delete
the synthetic thread and let the sweep run again; that file and row should then be gone
too. Never age or delete rows in a real user's store. This recipe verifies storage
ownership without requiring an actual provider turn.
