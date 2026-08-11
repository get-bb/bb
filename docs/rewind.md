# Rewind: editing a past message in the same thread

Rewind lets you return to an earlier message you sent, edit it, and continue in
the same thread. The thread keeps its id, title, section, task links, open
panels, and workspace; only the conversation continues from the edited message.

Rewind is a conversation-only feature. It never changes files in the
workspace.

## Eligibility

The edit action (pencil) appears on a message only when all of the following
are true:

- The thread is idle and no approval, queued message, or in-flight turn is
  waiting.
- The provider can resolve an exact checkpoint just before the message:
  Codex via its thread fork point, Claude Code via its point-in-history
  session fork.
- The message is a completed, human-authored message on the active branch,
  and it is not the very first message of the thread.
- The message is not on a fork or side-chat thread, the thread is not
  archived, and no compaction boundary sits between the start of the thread
  and the message.

Messages that do not meet these rules simply do not show the action. BB never
guesses at provider history: if the checkpoint cannot be proven, the message
is ineligible.

## What happens when you edit

1. Opening the editor restores the original structured input, including
   mentions and still-available attachments.
2. The confirmation states how many later turns will leave the active path
   and that workspace files stay unchanged. If eligibility changes while the
   editor is open, the confirmation is disabled and re-checked.
3. BB creates a provider-native branch at the checkpoint, makes it the active
   branch for the same BB thread, and sends your edited message as the next
   turn.

The abandoned conversation is not deleted: it remains as branch history in the
thread metadata, where it can be restored. A failed or accidental rewind never
destroys work.

## Recovery

Threads that have been rewound show a recovery banner when an earlier branch
can be restored. Restoring switches the active conversation back to that
branch; it never touches workspace files. Restore requires the thread to be
idle, and the current branch stays available for another restore.

If provider branching or the edited-turn send fails, your edited draft is
preserved in the composer and a specific recovery path is shown.

## Provider support

Rewind requires a provider that supports exact checkpoint branching:

- **Codex**: BB uses `thread/fork` with `lastTurnId` and binds the returned
  provider thread to the existing BB thread. Codex `thread/rollback` is
  deprecated by OpenAI and is not used.
- **Claude Code**: BB uses the Agent SDK's point-in-history session fork.
  Claude Code's file checkpoint rewind is out of scope for the first release.

## Enabling the experiment

Rewind ships behind the **Rewind** experiment in Settings → Experiments,
off by default. While the experiment is off, no new rewinds can be started
from the UI, SDK, or CLI, but any existing branch history stays visible and
restorable. Turning the experiment off never deletes or hides branches that
already exist.
