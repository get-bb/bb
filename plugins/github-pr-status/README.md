# GitHub PR Status

Owns GitHub pull request data and actions for bb environments. Bundled and enabled by default.

- `host.ts` batches GraphQL reads through `gh api graphql` and runs `gh pr ready|merge` in the environment's workspace on its machine.
- `server.ts` resolves environments, assembles the status, serves the keyed `pullRequests` read and the `markReady`, `markDraft` and `merge` mutations, and registers `bb pull-request`.
- `store.ts` shares snapshots, in-flight reads and pending-check timers by PR URL, and publishes only changed rows.
- `persistence.ts` uses the plugin's own database through `bb.storage.database()` / `migrate()`. It stores each environment's current link (a PR URL, or known absence) and the snapshots those links reference. Snapshots no link references are deleted. Identical PR content and links do not write rows; after a restart the app is served saved content immediately and refreshed in the background, while CLI and plugin reads wait for overdue data. Set `PERSISTENCE_ENABLED` to `false` to keep everything in memory, or bump `PERSISTENCE_VERSION` when saved rows should be discarded, for example after changing how a PR row is assembled.
- `app.tsx` registers the pull request segment of the composer's thread context row (`experimental_threadContextSegment`, with Mark ready and merge actions) and the Info tab's Pull request row (`experimental_threadInfoRow`). Their components, display helpers and the keyed read hook live in `ui/`.
- `contract.ts` is the public contract. Core's retired sidebar shim reads through it with `pluginId: "bb--github-pr-status"`, the way any other plugin would.

Plugin host calls never wake a suspended machine: reads return `unavailable`, and actions fail with a message naming the machine.

Branch discovery follows `gh pr view`: the base repository is the remote `gh` resolved (`gh repo set-default`), else `upstream`, `github`, `origin`, then any other remote, and `GH_REPO` overrides it. A branch pushed to another owner's remote matches only that owner's fork PRs; otherwise only same-repository PRs match, and the default branch ignores merged and closed PRs. Actions still target the current branch and bypass the discovery cache.

Watched open PRs with pending checks, unknown mergeability, a merge queue entry or auto-merge refresh about every 30 seconds. Other watched open PRs refresh about every 5 minutes; checks that are due at about the same time start together, so their reads share GraphQL batches instead of each running alone. Merged and closed PRs do not poll. App reads reuse a "no PR" result for 5 minutes, while CLI and RPC reads look again after 10 seconds; branch changes and turns rediscover immediately. Ref events compare the local upstream OID without fetching. Turns without a PR rediscover; known PRs recheck only after a turn that ran `gh`.

Reads on each workspace host are grouped by GitHub hostname and credential (including gh profile account changes) into documents of at most 25 PRs with a 10 ms collection window. Missing credentials or a sleeping host return unavailable. Rate limits pause the affected credential for at least one minute. A GitHub Enterprise server without merge queues is read without `isInMergeQueue` from then on. No credentials or ETags are persisted; measured ETag revalidation still needed two checks requests, versus one combined GraphQL request.
