# GitHub issues and pull requests

Status: **2026-09-05: 2 passed, 6 partial/blocked**. See [the audit](../MAINTENANCE.md) and [per-recipe ledger](../validation-2026-09-05.json).

## Setup and entry points

GitHub panel; bb github --help. Use cached synthetic/read-only fixtures first; live writes need an authorized disposable GitHub repository and authenticated gh.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/github/package.json`
- `plugins/github/server.ts`
- `plugins/github/app.tsx` and `plugins/github/components/`
- `plugins/github/pull-status.ts`, `snooze.ts`, `agent-presets.ts`

## Feature recipes

| Feature                             | Drive                                                                                                                                                                                                             | Observable success                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository discovery                | Add a project with a test GitHub origin and configure an extra tracked repo/default project.                                                                                                                      | Tracked repository membership follows project sources plus explicit configuration without duplicates.                                                                                                                                    |
| Browse and filters                  | Open issues and PRs, change available filters, select an item and reload its detail.                                                                                                                              | Rows, counts, selected repo, and detail correspond to the requested filter and cached forge data.                                                                                                                                        |
| Refresh and errors                  | Trigger manual sync, observe background refresh, then test missing auth and unreachable forge.                                                                                                                    | Freshness/failures are visible; stale cache is not presented as a successful fresh fetch.                                                                                                                                                |
| Issue creation and editing          | In the disposable repo, create an issue and change offered metadata, then verify through gh. Existing issue body/title editing is not exposed.                                                                    | Forge data matches submitted changes; canceled edits do not write externally.                                                                                                                                                            |
| Comments, labels, assignment, state | Add a test comment and change supported labels/assignee/open state.                                                                                                                                               | Only the chosen issue/PR receives changes; permissions/errors remain visible.                                                                                                                                                            |
| Pull request status                 | In the disposable repo, move a test PR between Draft, Open, and Closed from the header status pill and the row menu (including Undo), then with `bb github pr-state`. Open a merged PR and one you cannot change. | `gh pr view --json state,isDraft` matches each step; each change happens at once and the pill and row show it until GitHub reports it, for up to a minute; merged or unchangeable PRs show a plain status.                               |
| Delegate and review                 | Send an issue or PR to a synthetic agent thread using the offered action and project target.                                                                                                                      | Thread context/linkage identifies the exact item and selected checkout; no automatic merge is implied.                                                                                                                                   |
| Inbox views and keyboard            | Open the panel root, then Mine, All, Merged, and Issues with the tabs and `[`/`]`. Walk rows with `j`/`k`, open with Enter, close with Esc, and press `?`. On a phone-sized touch viewport, long-press a row.     | The root is the Inbox and lists only pull requests that need the viewer; the badge, the Inbox count, and the home section agree; tab switches replace history; the long press opens the row menu as a drawer.                            |
| Filter chips                        | Press `/`, type `author:<login> is:failing`, pick a suggestion, press Esc, then remove one chip.                                                                                                                  | Rows match every token; each token is a chip with the matching count; Esc keeps the filter; removing a chip widens the list.                                                                                                             |
| Snooze                              | From a row menu, `z`, or `bb github snooze <repo> <n> --until checks`, snooze a test PR; then push a commit or re-run its checks.                                                                                 | It moves to Snoozed with its wake rule, and returns to the Inbox when the rule fires or after `bb github unsnooze`.                                                                                                                      |
| Merge                               | In the disposable repo, merge a ready test PR from its card's split button, from the row menu's Merge… step (or `m`), and with `bb github merge --method squash`. Try one held by a bb worktree.                  | `gh pr view --json state,mergedAt` shows it merged with the chosen method; the card and row show Merging, then Merged; Delete the branch is off until turned on; a branch a bb worktree holds is kept; a push during the merge stops it. |
| Start an agent                      | Start an agent on a PR with failing checks from its card, the row menu, the `a` key, and `bb github agent`; then on an issue from its detail.                                                                     | The thread opens in the worktree on the head branch (or a new one from `origin/<head>`) with a prompt for the PR's state or the issue, and is linked to it; the card's agent line opens the thread.                                      |
| Thread surfaces and home            | Open a thread linked to a PR and its GitHub panel (also through the palette command), then the home page.                                                                                                         | The panel shows the linked pull request or a picker; the home section lists the first pull requests counted by the Inbox.                                                                                                                |
| Mentions                            | Resolve GitHub items through @/# mention entry points and send a read-only summarization request.                                                                                                                 | Agent receives the intended item and current resolved context with a working source link.                                                                                                                                                |
| Agent interface                     | Compare CLI repos/issues/prs/pr-state/merge/rerun/snooze/unsnooze/agent/sync with the panel and the palette command.                                                                                              | Both surfaces use the same tracked cache; an unknown valid repository returns an empty cache, while malformed names are rejected.                                                                                                        |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity; do not
invent a plugin CLI where the feature uses a core command instead. Preserve
failed attempts and missing prerequisites as unverified results. Restore plugin
configuration and remove only this run’s fixtures, registrations, and workers.
External account changes use authorized disposable targets.

## Maintenance notes

- Exercise New issue with repository, title and description, then cancel or create only in an authorized disposable repository. Existing issue title/body editing is not exposed by this plugin contract; do not require an unavailable edit action. Source: `plugins/github/server.ts:238`.
- Add a test comment and change supported labels/assignees/state in an authorized disposable repository. Existing-comment editing is not exposed; omit that unavailable substep. Source: `plugins/github/server.ts:167`.
- Compare CLI and panel cache. For an unknown syntactically valid repository, record the current empty-cache response (`Nothing cached...` / `{items:[]}`); malformed names are rejected. Do not claim a dedicated unknown-tracked-repository error. Source: `plugins/github/server.ts:1683`.
