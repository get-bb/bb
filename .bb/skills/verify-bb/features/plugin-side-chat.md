# Side chats

Status: **source-documented; live execution pending**.

## Setup and entry points

Select a main-thread message/context and open Side chat; use a provider supporting the required fork operation.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/side-chat/package.json`
- `plugins/side-chat/server.ts`
- `plugins/side-chat/app.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Open and context | Create a side chat from selected context and inspect its compact panel and thread detail. | Child has the expected parent/checkpoint, shares the workspace, and stays out of the normal sidebar as intended. |
| Conversation | Send a harmless follow-up, navigate away/back, and reopen the side chat. | Correct child conversation persists independently of the parent composer. |
| Send back | Send a side-chat result back to the main thread and inspect its queue. | One intended message enters the parent’s delivery path with correct context; it is not silently sent to another thread. |
| Cleanup policy | Use dated empty/used test side chats in the dedicated cleanup fixture and run the documented maintenance hook. | Only eligible old empty chats are archived; used chats and recent empty ones remain. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.
