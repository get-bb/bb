---
name: github-pr-status
description: "Inspect an environment's GitHub pull request, mark it ready or draft, or merge it from the bb CLI; watch it for check, review and conflict changes, read failing CI logs and re-run checks; read PR status from another plugin."
---

# GitHub PR Status

The plugin finds the pull request for an environment's current branch by
running `gh` in the environment's workspace on its machine, so forks, upstream
remotes and the machine's own `gh` login apply. The sidebar row badge (the
number in its state's color, shown when Organize → Rows → Metadata are on), the composer banner, the Info panel and plugin-built
sidebars read their PR status from it. Pending checks re-check about every 30
seconds in one batched GitHub request per machine.

```sh
bb pull-request show <environment-id> [--json]
bb pull-request ready <environment-id> [--json]
bb pull-request draft <environment-id> [--json]
bb pull-request merge <environment-id> [--method merge|squash|rebase] [--json]
bb pull-request watch [--thread <thread-id>] [--json]
bb pull-request watching [--thread <thread-id>] [--json]
bb pull-request unwatch [--thread <thread-id>] [--json]
bb pull-request logs <environment-id> [--check <name>] [--lines <n>] [--json]
bb pull-request rerun <environment-id> [--check <name>] [--json]
```

- `show` prints the PR number, state, branch, attention, checks, review and
  mergeability. `--json` prints `{ "outcome": "available", "pullRequest" }`,
  `{ "outcome": "absent" }` or `{ "outcome": "unavailable", "message" }`.
- `ready` needs a draft PR, `draft` needs an open PR and `merge` needs an open
  PR GitHub reports as mergeable. Each re-reads the PR first and fails with
  the reason otherwise.
- bb never wakes a machine for PR work. When the environment's machine is
  suspended or offline, `show` reports the last pull request bb saw for
  the environment, or `unavailable` when it has none, and the actions fail
  with a message naming the machine.
- `gh` must be installed and logged in on that machine.

## Wait for CI and reviews

To wait for checks, reviews or mergeability, run `bb pull-request watch` and
end your turn. Do not poll with `sleep`, `gh pr checks --watch` or a loop.
bb sends the thread a message that starts with `[bb pull request watch]` when:

- a check fails (bb reports each failed run once, and a re-run that fails again is a new run),
- all checks pass,
- someone other than the machine's `gh` account comments or reviews,
- the review decision becomes approved or changes requested,
- the branch starts to conflict with its base,
- the pull request merges or closes.

`watch` watches the pull request of the thread's environment. It uses the
thread that runs the command, or `--thread`. Each thread has one watch, and
running `watch` again starts it again from the current state. The output shows
the current state. bb does not report again the failures that are already there.

A message only tells you what changed. Read the pull request and decide what to
do. While the thread is busy, new changes are added to the message that waits
in its queue, so the thread gets one message per turn. `watching` shows the
current watch.

The watch ends when the pull request merges or closes, when you run `unwatch`,
when the thread is archived or deleted, when the environment switches to a
named branch with a different pull request or none, after 10 messages in a row
that bring only comments or reviews, or when bb cannot read the pull request
for 15 minutes while its machine is online. A detached HEAD, for example during
a rebase, does not end it. While the machine is offline, the watch waits.

`logs` prints the lines up to the last `##[error]` of the latest run of each
failing GitHub Actions job (80 lines by default, at most 400), or of the job
named by `--check`. Checks from other CI services, and jobs that run in another
repository, print only their link. `rerun`
re-runs the failed jobs of each workflow run with a failing check, or only the
job of `--check`. Use these instead of `gh run view --log-failed` and
`gh run rerun`.

The `showPullRequest` setting (default true) shows the pull request segment
above the composer. Turn it off with
`bb plugin config bb--github-pr-status set showPullRequest false`; the Info
panel's Pull request row stays.

Other plugins read the same data through RPC. `pullRequests` is a keyed read:
pass up to 200 environment ids and get one row per id. While a client watches
a row, the plugin re-checks an open or draft PR every 30 seconds while any check is pending,
auto-merge is on, the PR is queued or mergeability is unknown, and about every 5 minutes for other open or draft PRs. Merged and closed PRs do not poll. It also rechecks after a turn that ran `gh`, or discovers a PR after a turn on a branch without one. Environment status and branch changes refresh; ref changes read the local upstream OID and fetch only when it changes. App reads answer at once from what the plugin has and refresh a stale row in the background: open and draft PRs after 30 seconds, merged and closed PRs after an hour, a "no PR" result after 5 minutes. Opening a thread, including by loading the page on it, re-checks its PR on GitHub through `refresh`, whatever the row's age; other views ask again when they first show and each time the page shows again. CLI and RPC reads wait for a row older than 10 seconds. Call `refresh` with `{ environmentId }` to re-check a row on GitHub now; it resolves once the row is current. Saved rows survive a restart. Environments sharing a PR share its fetch and timer, and viewers refresh only when the row changes.

```ts
experimental_useRpcKeyedQuery({
  pluginId: "bb--github-pr-status",
  contract,
  method: "pullRequests",
  keys: [environmentId],
});
```

`bb plugin rpc inspect bb--github-pr-status` prints the input and output schemas
for `pullRequests`, `markReady`, `markDraft`, `merge`, `watch`, `unwatch`,
`watching`, `checkLogs` and `rerunChecks`.
