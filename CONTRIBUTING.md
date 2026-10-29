# Contributing

Thanks for helping improve bb.

## Before You Open A Pull Request

A pull request from outside the bb team must meet all of these:

1. **Approved author.** You are on `.github/APPROVED_CONTRIBUTORS`. See [Contributor Approval](#contributor-approval).
2. **Linked issue.** The description closes an open issue in this repo, for example `Fixes #123`. See [Linked Issue](#linked-issue).
3. **Maintainer edits.** You opened it from your fork with "Allow edits by maintainers" turned on. GitHub offers the setting only on forks owned by a personal account; the gate does not check forks owned by an organization.

The PR gate closes a pull request that misses any of these and comments with what is missing. A closed pull request is not a review of the change.

## Contributor Approval

bb approves new contributors before it reviews their pull requests. Anyone can open an issue. You need no approval for an issue.

1. Open an issue for the change, or find an existing one. Feature requests and UI changes need sign-off first; see below.
2. Open the pull request with `Fixes #<number>` in its description. The gate closes it because you are not approved yet. That is expected.
3. Join the #contributors channel in Discord ([invite link](https://discord.gg/kvBU6tJhcJ)), post a link to the closed pull request, and explain what it changes and why.

A maintainer then adds your name to `.github/APPROVED_CONTRIBUTORS` and reopens the pull request. Authors with a merged change in main already have approval.

A maintainer can also approve you with `/approve @your-name` on the pull request.

## Linked Issue

Every pull request from outside the bb team must close an open issue in this repo.

A pull request is one attempt at a change, and many attempts do not land as written. We may ask for rework, a pull request closes after two weeks open, or we may solve the problem another way. The issue records the problem itself, so it stays visible and tracked whatever happens to any one pull request.

Write `Fixes #<number>`, `Closes #<number>`, or `Resolves #<number>` in the pull request description. A mention without one of these words does not count.

If the gate closes your pull request only because it has no linked issue, add the line to the description and save it. The pull request reopens on its own.

A maintainer can exempt a pull request from this requirement by adding the `skip-issue-check` label. The gate then reopens it if it meets the other requirements.

## Bugs

If you run into a bug, open an issue with the bug report form. Follow [docs/filing-issues.md](docs/filing-issues.md): versions, minimal copy-pasteable steps, expected vs actual output, evidence, and what you ruled out. A stranger should be able to reproduce it from the issue alone.

If you fix the bug, open a pull request that links the issue as described above.

## Feature Requests And UI Changes

For feature requests and UI changes, open an issue and wait for a maintainer's sign-off before you open a pull request.

Feel free to link changes from your fork as prototypes on the issue, but do not open a pull request against this repo until we are aligned on the feature.
