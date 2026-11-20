See the GitHub pull request for each thread's branch where you already work: a badge on every sidebar row, the composer banner and the Info panel. Mark it ready, convert it back to a draft or merge it without leaving bb.

## What you get

- A badge under each sidebar thread's title with the pull request's number in its state's color, followed by a red cross when it needs action (failing checks, changes requested, conflicts, behind its base or blocked by rules) or else a yellow dot while checks run; hover it for the title and check counts. Turn on Organize → Rows → Metadata.
- One rolled-up status per pull request: checks, review, conflicts, merge queue and auto-merge.
- Ready for review, Convert to draft and Merge (merge, squash or rebase).
- Agents can wait on a pull request without polling: `bb pull-request watch` sends the thread a message when a check fails, all checks pass, someone else comments or reviews, the review decision changes, the branch conflicts, or the pull request merges or closes. Watches survive a restart.
- `bb pull-request logs` prints the end of each failing GitHub Actions job log, and `bb pull-request rerun` re-runs the failed jobs.
- Live updates while you watch: pending checks are re-checked every 30 seconds and other open or draft PRs every 5 minutes, in one batched GitHub request per machine, and views refresh only when something changed.

## How it works

The plugin batches GitHub reads through `gh api graphql` in the environment's workspace on its own machine, so fork and upstream remotes and that machine's `gh` login apply. bb never wakes a sleeping machine for PR status; a suspended or offline machine shows no PR until it is back.

Use the CLI from any thread:

- `bb pull-request show <environment-id>` prints the pull request.
- `bb pull-request ready|draft <environment-id>` changes draft state.
- `bb pull-request merge <environment-id> --method squash` merges it.
- `bb pull-request watch` messages the thread that runs it when the pull request needs it. `bb pull-request unwatch` stops the watch.
- `bb pull-request logs|rerun <environment-id>` reads or re-runs failing checks.

Turn off Show pull request above the composer on this page to hide the composer segment; the Info panel keeps its Pull request row.

## Requirements

Install the GitHub CLI and run `gh auth login` on each machine whose pull requests you want to see.
