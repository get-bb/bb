# Contributing

Thanks for helping improve bb.

## Contributor Approval

bb approves new contributors before it reviews their pull requests. Anyone can open an issue. You need no approval for an issue.

1. Open the pull request from your fork with "Allow edits by maintainers" turned on. The gate closes a pull request from a fork with that setting off, approved or not. GitHub offers the setting only on forks owned by a personal account; the gate does not check forks owned by an organization.
2. The gate closes a pull request from an author without approval. That is expected.
3. Join the #contributors channel in Discord ([invite link](https://discord.gg/kvBU6tJhcJ)), post a link to the closed pull request, and explain what it changes and why.

A maintainer then adds your name to `.github/APPROVED_CONTRIBUTORS` and can reopen the pull request. Authors with a merged change in main already have approval.

A maintainer can also approve you with `/approve @your-name` on the pull request.

## Bugs

If you run into a bug, please open an issue with the bug report form. Follow [docs/filing-issues.md](docs/filing-issues.md): versions, minimal copy-pasteable steps, expected vs actual output, evidence, and what you ruled out. A stranger should be able to reproduce it from the issue alone.

If you fix the bug, feel free to open a pull request for it as described above.

## Feature Requests And UI Changes

For feature requests and UI changes, please open an issue before opening a pull request.

Feel free to link changes from your fork as prototypes, but do not open a pull request against this repo until you get sign-off and we are aligned on the feature.
