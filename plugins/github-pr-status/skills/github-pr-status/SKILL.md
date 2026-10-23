---
name: github-pr-status
description: "Inspect an environment's GitHub pull request, mark it ready or draft, or merge it from the bb CLI; read PR status from another plugin."
---

# GitHub PR Status

The plugin finds the pull request for an environment's current branch by
running `gh` in the environment's workspace on its machine, so forks, upstream
remotes and the machine's own `gh` login apply. The composer banner, the Info
panel and sidebar plugins read their PR status from it.

```sh
bb pull-request show <environment-id> [--json]
bb pull-request ready <environment-id> [--json]
bb pull-request draft <environment-id> [--json]
bb pull-request merge <environment-id> [--method merge|squash|rebase] [--json]
```

- `show` prints the PR number, state, branch, attention, checks, review and
  mergeability. `--json` prints `{ "outcome": "available", "pullRequest" }`,
  `{ "outcome": "absent" }` or `{ "outcome": "unavailable", "message" }`.
- `ready` needs a draft PR, `draft` needs an open PR and `merge` needs an open
  PR GitHub reports as mergeable. Each re-reads the PR first and fails with
  the reason otherwise.
- bb never wakes a machine for PR work. When the environment's machine is
  suspended or offline, `show` reports `unavailable` and the actions fail
  with a message naming the machine.
- `gh` must be installed and logged in on that machine.

Other plugins read the same data through RPC. `pullRequests` is a keyed read:
pass up to 200 environment ids and get one row per id. While a client watches
a row, the plugin re-checks it every 30 seconds when checks are pending,
auto-merge is on, the PR is queued or mergeability is unknown, and about every 5 minutes for other open PRs. Merged and closed PRs do not poll. It also rechecks after a turn that ran `gh`, or discovers a PR after a turn on a branch without one. Environment status and branch changes refresh; ref changes read the local upstream OID and fetch only when it changes. App reads reuse a "no PR" result for 5 minutes; CLI and RPC reads look again after 10 seconds. After a restart the app shows saved snapshots immediately and refreshes overdue ones in the background; CLI and RPC reads wait for overdue data. Environments sharing a PR share its fetch and timer, and viewers refresh only when the row changes.

```ts
experimental_useRpcKeyedQuery({
  pluginId: "bb--github-pr-status",
  contract,
  method: "pullRequests",
  keys: [environmentId],
});
```

`bb plugin rpc inspect bb--github-pr-status` prints the input and output schemas
for `pullRequests`, `markReady`, `markDraft` and `merge`.
