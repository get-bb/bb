# bb-plugin-github

GitHub issues and pull requests inside BB, with one-click agent dispatch.

Install it from the BB Official catalog:

```sh
bb plugin install github
```

## What it does

- **Sidebar panel** (GitHub logo, full width) opens on the pull request
  inbox. Its views are Inbox (what needs you), Mine, All, Merged, and Issues;
  switch with the tabs or `[` and `]`. The panel's badge counts the pull
  requests that need you, the same number as the Inbox tab.
- **Inbox**: Your move (your review is requested, or changes were requested
  on yours), then your own pull requests that are ready to merge, need fixing
  (conflicts, failing checks, changes requested), or are in progress (checks
  running, merge queue); snoozed ones fold at the end. Mine, All, and Merged
  add Waiting for review, Open, Drafts, and Closed. Each row has one status
  glyph and the reason in words, such as `#12 · Checks failing`; when your
  review or merge conflicts lead, failing checks add `· Checks failing` in
  red. A linked agent shows as its thread's status glyph.
- **Row actions**: hovering a row shows Merge (Mark ready on a draft) and a
  menu: Merge…, the status changes, Snooze…, Start an agent…, Open the
  agent's thread, Copy branch name, and Open on GitHub. Merge… and Snooze…
  open a second step with a Back item; `m`, `z`, and the hover Merge open
  that step directly. Merge… shows wherever `m` works: when checks or
  reviews may still block the merge, it opens the pull request and asks
  GitHub there. On a touch screen the menu button
  stays visible; on a phone a long press opens the menu as a drawer titled
  with the pull request.
- **Filter** (`/`): free text plus `is:` (open, closed, merged, draft, ready,
  conflict, failing, snoozed), `author:`, `assignee:`, `label:`, `base:`,
  `repo:`, and `no:`, with suggestions as you type. Each token shows as a
  removable chip beside the number of matches. Esc leaves the filter and
  keeps it.
- **Keyboard**: `j`/`k` or ↑/↓ move, Enter opens, Esc closes, and `a` (start
  an agent), `m` (merge), `r` (mark ready), `s` (status), `z` (snooze), `t`
  (agent thread), `c` (copy branch), and `o` (open on GitHub) act on the
  focused row or the open pull request. `?` lists the shortcuts, grouped by
  where they work.
- **Snooze**: until the checks change, a new push, tomorrow at 8:00, or next
  Monday at 8:00. Merging or closing wakes it.
- **Pull request detail**: beside the list on a wide panel, full width on a
  narrow one. The header carries the status pill (Mark ready, Convert to
  draft, Close pull request, or Reopen pull request, where GitHub's
  `viewerCanUpdate`, `viewerCanClose`, and `viewerCanReopen` allow it), the
  author, a copy chip for the head branch, and the diff stat in core's
  `text-diff-added`/`text-diff-removed` colours, which opens Files. A change
  happens at once with Undo in its toast; the pill and the row show it until
  GitHub reports it, for up to a minute, and a failure says why.
- **Next step card**: says what the pull request needs now, with one GitHub
  action first: merge, re-run the failed checks (listed with their logs),
  resolve conflicts or review on GitHub, mark a draft ready, or reopen it.
  Merge is a split button: the repository's default method, and a menu with
  the allowed methods and whether to delete the head branch, which is off
  until you turn it on and then remembered. A branch that a bb worktree
  holds, or that lives in a fork, is kept. Every merge runs `gh pr merge`
  with `--match-head-commit`, so a push that lands meanwhile stops it. While
  a merge runs the card and the row say so. When your review is requested,
  the card leads with Review on GitHub, like the row, and still lists the
  failing checks, as the conflicts card does. Start an agent… is
  always the last, secondary action, and the card leaves it out while checks
  run or GitHub is still deciding; a linked agent shows as one line with
  Open thread.
- **Tabs**: Activity (commits grouped by author, reviews, review threads,
  comments, Linear links) ends in a comment box that posts to GitHub; Files
  lists the files in GitHub's order, file name first, with their diffs and
  links into the bb worktree that holds the branch; Checks lists failed and
  running checks first with links to their logs, and folds the passed and
  skipped ones. Stacked pull requests show their chain.
- **Start an agent**: bb's new-thread composer in a sheet, seeded with a
  prompt for what your pull request needs (fix the checks, resolve the
  conflicts, address the review) or with a review of someone else's, and
  placed in the bb worktree already on the branch, else a new worktree from
  `origin/<head>`. On an issue the prompt asks to work on it. A repository
  with no bb project uses the `defaultProject` setting. The thread is linked
  to the item.
- **Thread panel** (GitHub): the linked pull request's detail, or a
  picker when none is linked. The palette command GitHub: Open this thread's
  pull request opens it.
- **Home page**: the first four pull requests that need you, and a link to
  the inbox.
- **Issues**: open issues first, closed ones folded; each row says who is
  assigned, if anyone. The row menu assigns or unassigns you, closes or
  reopens the issue with Undo, starts an agent, copies its link, or opens it
  on GitHub. The issue detail has the status pill, assignee and label
  pickers, Start an agent…, the description, comments, and a comment box.
  New issue creates one: Enter in the title moves to the description,
  ⌘/Ctrl+Enter creates it, and the draft is kept until it is created. Deep links: `issues/<owner>/<repo>/<number>` and
  `pulls/<owner>/<repo>/<number>` under the panel's route.
- **Mentions**: `@` or `#` in any composer completes GitHub issues and PRs; the
  selected item's title/body/state is attached as agent context at send time.
- **`bb github` CLI**: `repos`, `issues [repo]`, `prs [repo]`,
  `pr-state <repo> <number> --state open|draft|closed`,
  `merge <repo> <number> [--method squash|merge|rebase] [--delete-branch]`,
  `rerun <repo> <number>`,
  `snooze <repo> <number> --until checks|push|tomorrow|monday|<ISO>`,
  `unsnooze <repo> <number>`,
  `agent <repo> <number> [--preset fix|conflicts|feedback|review] [--prompt …]`
  on a pull request or an issue,
  and `sync` — also discoverable by agents through the plugin-commands skill.
  `prs` adds what each pull request needs next: a fourth tab-separated column
  in text, and `nextStep` plus a `pr` status object in `--json`. `pr-state`
  runs `gh pr ready`, `gh pr ready --undo`, `gh pr close`, or
  `gh pr reopen` as needed, reopening a closed pull request first, and
  refuses a merged one. `merge` runs `gh pr merge` with
  `--match-head-commit`, so a push that lands meanwhile stops it. `rerun`
  re-runs each GitHub Actions run with a failed or cancelled job once. A
  tracked repository's cache then refreshes in the background, also after a
  change that fails partway. Each command takes `--json`
  (`{"ok":true,…}` on success, `{"ok":false,"error":{…}}` on failure) and
  `--help`, which prints its arguments and options and exits 0.

## Auth

Uses the GitHub CLI. If `gh auth status` passes, the plugin works; otherwise
it reports needs-configuration. No tokens are stored by the plugin.

## Which repos are tracked

- Every BB project source whose checkout has a GitHub `origin` remote
  (repo → project mapping is also how spawn picks the project).
- Plus the `extraRepos` setting: comma-separated `owner/repo` list. Entries that
  are not `owner/repo` — a `owner/*` wildcard, a bare owner, a typo — are not
  tracked; `bb github repos` names them on stderr and the plugin log warns once
  per distinct set. Wildcards are not supported.
- `defaultProject` setting: where threads spawn for repos with no project.

```
bb plugin config github set extraRepos "owner/repo, owner/other"
bb plugin reload github
```

A background service refreshes immediately on startup, then waits 15 minutes
after each completed sync. Each tracked repository uses one bounded `gh api graphql`
request per sweep, using the existing GitHub CLI authentication. It fetches
100 open and 50 closed issues, plus 50 open and 30 closed or merged PRs,
ordered by creation time descending. Labels and assignees are each limited to
100 per item, matching the previous list commands. Open PRs also carry their
draft state, head and base branches, mergeability, review decision and
requested reviewers, merge-queue state, and check counts by state
(`checkRunCountsByState`, `statusContextCountsByState`); on get-bb/bb that
raises the request from 5 to 6 GraphQL points. `mergeStateStatus` is left to
the pull request detail because it slows the list request several-fold. Repositories with Issues
disabled still sync PRs. Failed or incomplete repository responses retain that
repository’s cached rows.

Batching reduces list-fetch process invocations from four to one per repository
(75%). This does not measure GraphQL rate-limit point savings.
Background data may take 15 minutes plus sync time to refresh. The panel's
Refresh button, the `refresh` RPC, or `bb github sync` starts a sync immediately.

Transient authentication failures and failures across all repositories retain
the existing retry backoff: 30 seconds, doubling to a five-minute cap, reset
after a successful sync. Partial repository failures use the normal interval.
The interval is internal policy; there is no polling setting.

## Development

Run the checks from the repository root:

```sh
pnpm exec turbo run typecheck test --filter=bb-plugin-github
```
