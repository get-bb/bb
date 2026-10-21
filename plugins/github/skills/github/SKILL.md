---
name: github
description: Read tracked repositories and current default-branch CI checks with the GitHub plugin.
---

Use `bb github repos --json` to find the project attached to a tracked repository.
`bb github checks <projectId> --json` reads that project's current default branch,
commit, check runs and commit statuses using the plugin's existing GitHub CLI
sign-in. Each check includes its source URL. The same read is available through
plugin RPC `mainBranchChecks` with `{ "projectId": "<projectId>" }`.

An `available` response contains `repo`, `branch`, `commit`, and `checks`.
An `unavailable` response contains `reason`: `signed_out`, `github_unavailable`,
or `repository_unavailable`. In that case run local tests only; do not treat
missing CI as passing or reuse an earlier result. This read does not publish
changes or create a pull request.

Use `bb github issues [repo]`, `bb github prs [repo]`, and `bb github sync`
for the cached issue and pull request views. Every command supports `--json`
and `--help`.
