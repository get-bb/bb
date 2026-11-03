See the GitHub pull request for each thread's branch where you already work: a badge on every sidebar row, the composer banner and the Info panel. Mark it ready, convert it back to a draft or merge it without leaving bb.

## What you get

- A badge under each sidebar thread's title with the pull request's number in its state's color, followed by a yellow dot while checks run or a red cross when they fail or it has conflicts; hover it for the title and check counts. Turn on the Thread row metadata experiment, then Organize → Rows → Metadata.
- One rolled-up status per pull request: checks, review, conflicts, merge queue and auto-merge.
- Ready for review, Convert to draft and Merge (merge, squash or rebase).
- Live updates while you watch: pending checks are re-checked every 30 seconds and other open or draft PRs every 5 minutes, in one batched GitHub request per machine, and views refresh only when something changed.

## How it works

The plugin batches GitHub reads through `gh api graphql` in the environment's workspace on its own machine, so fork and upstream remotes and that machine's `gh` login apply. bb never wakes a sleeping machine for PR status; a suspended or offline machine shows no PR until it is back.

Use the CLI from any thread:

- `bb pull-request show <environment-id>` prints the pull request.
- `bb pull-request ready|draft <environment-id>` changes draft state.
- `bb pull-request merge <environment-id> --method squash` merges it.

Turn off Show pull request above the composer on this page to hide the composer segment; the Info panel keeps its Pull request row.

## Requirements

Install the GitHub CLI and run `gh auth login` on each machine whose pull requests you want to see.
