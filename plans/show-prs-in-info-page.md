# Show Pull Requests in the Thread Info page

## Goal

Surface the GitHub pull request for a thread's current branch in the thread
Info tab (the "secondary panel" metadata card), near the Branch / Merge base /
Git status rows. When a PR exists, show `PR #N · <state>` with a state
indicator and an external link that opens the PR in the browser.

bb has **no** GitHub/PR integration today (verified: no `pullRequest`,
`octokit`, or `gh pr` references anywhere in `packages/` or `apps/`). This adds
a minimal, read-only one.

## Approach

Mirror the existing **workspace status** flow, which is the closest analog:
host-local git data that the host daemon computes and the server proxies to the
frontend. The difference is the daemon→server boundary: for PRs the daemon
returns **raw** `gh` data and the **server** assembles the product-facing field
(AGENTS.md → "Server And Daemon Ownership": "If the server needs host-local
data, the daemon should return the raw data and the server should assemble the
final behavior").

We deliberately do **not** piggyback on `workspace.status`:

- `workspace.status` is polled frequently (10s stale time) and bounded by a 15s
  git timeout. A `gh` call is a network round-trip with different latency and
  freshness characteristics; coupling it to the hot git-status path would slow
  every status poll. → Separate concern, separate RPC.
- The server currently passes `workspace.status` through verbatim and assembles
  nothing. The PR field genuinely needs server-side assembly (state mapping),
  which fits a dedicated route cleanly.

This is a synchronous request/response read, not a durable async lifecycle
(no status ladder, no daemon-initiated work), so a plain RPC — like
`workspace.status` — is the right shape (AGENTS.md → "Async Lifecycle
Ownership" does not apply).

## Data model

Two types, because the daemon→server boundary maps raw git-host vocabulary onto
product vocabulary:

**Raw (daemon returns verbatim from `gh`)** — `GitHostPullRequest`:

| field    | type                            | source (`gh ... --json`) |
| -------- | ------------------------------- | ------------------------ |
| number   | positive int                    | `number`                 |
| title    | string                          | `title`                  |
| state    | `"OPEN" \| "CLOSED" \| "MERGED"` | `state`                  |
| url      | string (url)                    | `url`                    |
| isDraft  | boolean                         | `isDraft`                |

**Assembled (server owns the product policy)** — `ThreadPullRequest`:

| field  | type                                       |
| ------ | ------------------------------------------ |
| number | positive int                               |
| title  | string                                     |
| state  | `"draft" \| "open" \| "merged" \| "closed"` |
| url    | string (url)                               |

Server mapping (the product policy):

- `MERGED` → `merged`
- `CLOSED` → `closed`
- `OPEN` + `isDraft` → `draft`
- `OPEN` → `open`

Both schemas live in `@bb/domain` (`thread.ts`), alongside
`workspaceStatusSchema`, so the daemon-contract, server-contract, and frontend
all share one definition (no duplicate inline types).

## Server ↔ host-daemon boundary

New online RPC command **`workspace.pull_request`** (idempotent read; goes in
the retryable set like `workspace.status`):

- **Command:** `{ type, environmentId, workspaceContext }` — same target shape
  as `workspace.status`. The daemon derives the branch itself from the
  workspace HEAD (no `branch` field — it would be dead parameterization the
  daemon can compute).
- **Result:** `{ pullRequest: GitHostPullRequest | null }`. No
  available/unavailable discrimination: **every** failure mode collapses to
  `null` (= "no PR"). gh-missing, not-authed, no-remote, no-PR, malformed
  output, and even an unresolvable workspace all yield `null`, with no error
  spam.

**Daemon** (`@bb/host-workspace` + `apps/host-daemon`):

1. Resolve the workspace (reuse `resolveWorkspaceForCommand`). On failure →
   `{ pullRequest: null }`.
2. `Workspace.getPullRequest()` reads the current branch, then runs
   `gh pr view <branch> --json number,title,state,url,isDraft` in the workspace
   directory (inherited env preserves `PATH`/`HOME`/tokens so `gh` auth works).
3. Validate stdout against `gitHostPullRequestSchema` (safeParse). Any
   throw / non-zero exit / parse failure / empty → `null`.

**Server** (`apps/server`):

- New route `GET /environments/:id/pull-request`.
- Non-git environment → short-circuit to `{ pullRequest: null }` (no daemon
  call).
- Otherwise call the RPC and run `assembleThreadPullRequest(raw)` to map the
  raw state + `isDraft` onto the product `state`. The default (state mapping)
  is applied **once** here, at the server boundary.
- Response: `{ pullRequest: ThreadPullRequest | null }` — **required +
  nullable**, where `null` means "no PR for this branch" (a real, distinct
  meaning), per AGENTS.md contract rules.

## UI placement

`apps/app/src/components/secondary-panel/ThreadMetadataContent.tsx`. A new
`PullRequestRow` rendered only when a PR exists, placed right after `BranchRow`
/ `MergeBaseRow` / `GitStatusRow` (the branch/commits group). It is a plain
`DetailRow` (label "Pull request"), consistent with every sibling row in that
flat `DetailCard` — main has no section-header/divider convention in this file
(the `DetailRowIconLabel` / `CHROME_SECTION_LABEL_CLASS` section polish lives on
an unmerged branch, PR #78, so we do not use it here).

Row value: a single external-link anchor (`target="_blank"
rel="noopener noreferrer"`) showing a `GitMerge` icon, `PR #N`, a `·`
separator, a small colored state dot, and the capitalized state label, with a
trailing `ExternalLink` icon. State dot colors: open → `bg-success`, draft →
`bg-muted-foreground`, merged → `bg-primary`, closed → `bg-destructive`.

Frontend fetch: a new `useEnvironmentPullRequest(environmentId)` query (parallel
to `useEnvironmentWorkStatus`) feeding a `pullRequest` prop through
`ThreadDetailView` → `ThreadMetadataContent`. `hasAnyThreadMetadata` accounts
for `pullRequest` so the card shows even if a PR is the only datum.

## v1 scope vs deferred

**In v1:** detect the single PR for the current branch via `gh`; show number,
title (as the link's hover/title), state, and an external link; graceful "no
PR" for every failure mode.

**Deferred (out of scope, noted in PR):**

- Checks / CI status, review state, mergeability.
- Multiple PRs per branch (we surface the one `gh pr view` resolves).
- Non-GitHub hosts (GitLab/Bitbucket); `gh`-only for v1.
- Caching/refresh affordances beyond React Query's default stale time, and
  any write actions (open/merge/close from bb).
- Distinguishing "gh not installed/authed" from "no PR" in the UI — all are
  "no PR" in v1.

## Exit criteria

- `pnpm exec turbo run typecheck` passes for every touched package
  (`@bb/domain`, `@bb/host-daemon-contract`, `@bb/host-workspace`,
  `@bb/host-daemon`, `@bb/server-contract`, `@bb/server`, `@bb/app`).
- New unit tests pass: raw `gh` JSON parsing (`parseGitHostPullRequest`) and the
  server state assembly (`assembleThreadPullRequest`), covering all four states
  plus every failure→null path.
- In the running app, a thread on a branch with an open GitHub PR shows the
  "Pull request" row linking to the PR; a thread on a branch without a PR (or
  with `gh` unavailable) shows no row and logs no errors.

## Validation steps

1. `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/app --filter=@bb/host-daemon`
   (pulls the upstream contract/domain/host-workspace builds via `^build`).
2. `pnpm exec turbo run test --filter=@bb/host-workspace --filter=@bb/server`
   (pure-function tests; no DB / native rebuild needed).
3. Manual: with `gh` installed + authed, open a thread whose branch has a PR;
   confirm the row renders and the link opens the PR. Switch to a branch with no
   PR; confirm the row disappears with no console/server errors. Optionally
   `curl` `GET /api/v1/environments/:id/pull-request` to confirm the assembled
   shape.
