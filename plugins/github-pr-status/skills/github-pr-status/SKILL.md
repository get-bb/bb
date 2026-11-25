---
name: github-pr-status
description: "Inspect an environment's GitHub pull requests, link another PR to it, mark one ready or draft, or merge it from the bb CLI; read PR status from another plugin."
---

# GitHub PR Status

The plugin finds the pull request for the checked-out branch of every repo
in an environment (its main folder and each project or environment folder
that is, or contains, a git repo, as `bb environment repos` lists them) by
running `gh` in that repo on the environment's machine, so forks, upstream
remotes and the machine's own `gh` login apply. Pull requests for other
branches, such as split or stacked branches, show only once linked with
`bb pull-request link`; the plugin asks agents to link the pull requests they
open for other branches. The sidebar row badge (the
number in its state's color, shown when Organize → Rows → Metadata are on), the composer banner, the Info panel and plugin-built
sidebars read their PR status from it. Pending checks re-check about every 30
seconds in one batched GitHub request per machine.

```sh
bb pull-request show <environment-id> [--json]
bb pull-request ready <environment-id> [--url <pr-url>] [--json]
bb pull-request draft <environment-id> [--url <pr-url>] [--json]
bb pull-request merge <environment-id> [--url <pr-url>] [--method merge|squash|rebase] [--json]
bb pull-request link <environment-id> <pr-url> [--json]
bb pull-request unlink <environment-id> <pr-url> [--json]
```

- `show` prints each PR's number, state, branch, attention, checks, review
  and mergeability: the main folder's repo first, then the other repos, then
  linked PRs. `--json` prints
  `{ "outcome": "available", "pullRequest", "pullRequests" }`, where
  `pullRequest` is the first of `pullRequests` and each entry is
  `{ "pullRequest", "linked" }`; or `{ "outcome": "absent" }` or
  `{ "outcome": "unavailable", "message" }`.
- `ready` needs a draft PR, `draft` needs an open PR and `merge` needs an open
  PR GitHub reports as mergeable. They act on `--url` (one of the
  environment's PRs) or else the first PR. Each re-reads the PR first and
  fails with the reason otherwise.
- `link` shows another PR with the environment until `unlink`; it accepts any
  URL inside the PR (such as `/files`) and stores the PR's own URL.
- bb never wakes a machine for PR work. When the environment's machine is
  suspended or offline, `show` reports the last pull request bb saw for
  the environment, or `unavailable` when it has none, and the actions fail
  with a message naming the machine.
- `gh` must be installed and logged in on that machine.

The `showPullRequest` setting (default true) shows the pull request segment
above the composer. Turn it off with
`bb plugin config bb--github-pr-status set showPullRequest false`; the Info
panel's Pull request row stays.

Other plugins read the same data through RPC. `pullRequests` is a keyed read:
pass up to 200 environment ids and get one row per id, with every PR in
`pullRequests`. `link` and `unlink` take `{ environmentId, url }`;
`markReady`, `markDraft` and `merge` take an optional `url`. While a client watches
a row, the plugin re-checks an open or draft PR every 30 seconds while any check is pending,
auto-merge is on, the PR is queued or mergeability is unknown, and about every 5 minutes for other open or draft PRs. Merged and closed PRs do not poll. It also rechecks after a turn that ran `gh`, or discovers a PR after a turn on a branch without one. Environment status and branch changes refresh; ref changes read the local upstream OID and fetch only when it changes. App reads answer at once from what the plugin has and refresh a stale row in the background: open and draft PRs after 30 seconds, merged and closed PRs after an hour, a "no PR" result after 5 minutes. Opening a thread, including by loading the page on it, re-checks its PR on GitHub through `refresh`, whatever the row's age; other views ask again when they first show and each time the page shows again. CLI and RPC reads wait for a row older than 10 seconds. Call `refresh` with `{ environmentId }` to re-check a row on GitHub now; it resolves once the row is current. The plugin finds an environment's repos the first time it reads it, again when its thread opens, its status changes or a turn ends while it is shown, and at most once a minute for CLI and RPC reads; sidebar reads never look again. Saved rows survive a restart. Environments sharing a PR share its fetch and timer, and viewers refresh only when the row changes.

```ts
experimental_useRpcKeyedQuery({
  pluginId: "bb--github-pr-status",
  contract,
  method: "pullRequests",
  keys: [environmentId],
});
```

`bb plugin rpc inspect bb--github-pr-status` prints the input and output schemas
for `pullRequests`, `refresh`, `markReady`, `markDraft`, `merge`, `link` and
`unlink`.
