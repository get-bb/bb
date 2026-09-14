---
name: add-contributor
description: Approve a GitHub contributor to open PRs in get-bb/bb, then land the allowlist change with SlopCop and CI skipped. Use for requests such as "add @username to be able to open PRs" or an explicit add-contributor invocation.
---

# Add a contributor

Approve the requested GitHub account for PRs in `get-bb/bb`. The default workflow
includes committing, opening a PR, and closing it out with SlopCop review and CI
skipped. Honor narrower user instructions, such as opening a PR for review only.
Loading this skill without a request to approve someone does not authorize changes.

## Resolve the account

Accept a GitHub login, `@login`, or GitHub profile URL. If the request contains only
a display name or an unfilled placeholder such as `{}`, ask for the GitHub login.
Verify the account with `gh api users/<login> --jq .login` and use the returned
canonical login. Treat the login as data and quote shell arguments. If the lookup
fails, resolve the error before changing approval; do not guess a different account.

## Edit the allowlist

Paths below are relative to the repository root:

- Edit `.github/APPROVED_CONTRIBUTORS`: one GitHub login per line, without `@`.
  Match existing entries case-insensitively after removing whitespace, as the gate
  does. Append a missing login, preserving existing entries and a final newline.
- Read `.github/workflows/pr-gate.yml` to confirm the current enforcement behavior.
  It reads the allowlist from the PR's base branch, so approval takes effect only
  after the allowlist change lands there.
- `.github/workflows/approve-contributor.yml` implements the separate `/approve`
  comment path. `CONTRIBUTING.md` describes the approval policy. Neither needs an
  edit for a routine contributor addition.

If the account is already listed on the target base branch, report that it is
already approved and finish without an empty commit or PR. If it is only listed
on the working branch, inspect the existing change or PR and finish that work.
This approval does not grant repository collaborator or organization membership.

## Verify and land

Check that the diff only adds the requested login(s), that each appears exactly
once case-insensitively, and run `git diff --check`. An allowlist-only change needs
no application build or test suite.

Commit with a message such as `Approve @username to open PRs [skip ci]`. Create or
update a PR using `.github/PULL_REQUEST_TEMPLATE.md`, explaining the approval and
the local validation, and explicitly state that CI is skipped for this data-only
change. End the body with `> AGENT GENERATED`.

Load and follow the available `close-out-skip-slopcop` skill to complete the merge.
Carry forward this workflow's explicit CI skip: do not trigger or wait for optional
CI or SlopCop review. `[skip ci]` does not suppress every GitHub event, including
`pull_request_target`. Inspect required checks and branch protection; do not disable
protections or use an admin bypass. If skipping CI leaves a required check pending,
report that blocker and leave the PR unmerged. If the close-out skill is unavailable,
report the missing dependency and the PR's state.

Confirm GitHub reports the PR merged before saying approval is active. Return the
PR link, approved login(s), merge state, and that SlopCop and CI were skipped. A
previously closed contributor PR can be reopened after approval; do not reopen or
comment on it unless requested.
