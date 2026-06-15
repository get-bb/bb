# Releasing bb-app

This runbook is for agents preparing and publishing the `bb-app` npm package.
It assumes the manual GitHub Actions publish workflow and npm Trusted
Publishing are configured. Until then, local `npm publish` is an emergency
fallback only.

A full release has **two** outputs that ship from the same release commit: the
`bb-app` npm package (`publish-bb-app.yml`) and the desktop app
(`build-desktop.yml`). They are published by independent workflows — publishing
npm does not publish the desktop app. Because the versions are locked together,
a normal release must run both. Do not consider a release complete until the
desktop app is published at the same version (see "Publish The Desktop App").

## Release Policy

- Publish only from `main`.
- Publish only a version that exists in `packages/bb-app/package.json`.
- Keep `packages/bb-app/package.json` and `apps/desktop/package.json` versions
  locked together. The desktop app displays the same release version and CI
  rejects mismatches.
- Do not ask for an npm OTP during the normal release path.
- Do not run `npm publish` locally unless the user explicitly asks for the
  emergency fallback.
- Do not move the `latest` npm dist-tag unless the release request or current
  release policy explicitly says to.
- Always report the exact Git commit, npm version, dist-tags, validation, and
  workflow run status.

## Inputs

Before changing files, resolve these inputs from the user request:

| Input                   | Default  | Notes                                                             |
| ----------------------- | -------- | ----------------------------------------------------------------- |
| Package                 | `bb-app` | This runbook does not publish other packages.                     |
| Version bump            | `patch`  | Example: `0.0.1` to `0.0.2`.                                      |
| npm dist-tag            | `latest` | This is the tag plain `npx bb-app` uses.                          |
| Allow prerelease latest | `false`  | Set to `true` only for an explicit prerelease-on-latest decision. |
| Publish dry run         | `false`  | Use `true` only when testing the workflow itself.                 |
| Source branch           | `main`   | Release commit must land on `main` before publishing.             |

If any input is unclear, ask before bumping the version.

## Prepare The Release Commit

1. Refresh the release worktree onto local primary `main`.

   ```bash
   git fetch /Users/michael/Projects/bb main:refs/remotes/primary/main
   git rebase refs/remotes/primary/main
   ```

2. Check the current npm state.

   ```bash
   npm view bb-app version dist-tags versions --json
   ```

3. Bump the lockstep release versions.

   For the normal stable loop:

   ```bash
   node scripts/bump-version.mjs --patch
   ```

   When promoting from a prerelease to the first stable version, set the exact
   version instead:

   ```bash
   node scripts/bump-version.mjs 0.0.1
   ```

   This updates `packages/bb-app/package.json` and
   `apps/desktop/package.json`. Do not run `npm version` directly in
   `packages/bb-app`; CI enforces these versions in lockstep.

4. Make any release documentation updates requested by the user.

5. Run validation.

   ```bash
   node .github/workflows/check-version-lockstep.mjs
   pnpm exec turbo run typecheck test --filter=@bb/config --filter=@bb/server --filter=bb-app
   pnpm exec turbo run smoke:tarball --filter=bb-app --force
   git diff --check
   ```

6. Commit the release change.

   ```bash
   git add README.md docs packages/bb-app/package.json packages/bb-app/README.md apps/desktop/package.json
   git commit -m "Prepare bb-app <version>"
   ```

   Adjust the `git add` paths to exactly the files changed.

## Land On Main

The publish workflow must run from `main`, so the release commit must be on
`main` before publishing.

Preferred paths:

- If the agent has permission to update local `main`, fast-forward or merge the
  release commit into local `main`, then push if the user has authorized pushes.
- If the agent cannot update/push `main`, stop and report the release commit SHA
  and validation. Ask the user to merge it before publishing.

Do not publish from a feature branch just because validation passed.

## Trigger The Publish Workflow

After the release commit is on pushed `main`, trigger the workflow:

```bash
gh workflow run publish-bb-app.yml \
  --ref main \
  -f npm_tag=latest \
  -f allow_prerelease_latest=false \
  -f dry_run=false
```

Use prerelease dist-tags such as `alpha` only when the user explicitly asks for
a separate prerelease channel. npm Trusted Publishing authenticates
`npm publish`, not post-publish tag edits, so the OIDC-only workflow can set one
tag per release.

If the `npm-release` GitHub environment requires approval, tell the user the
workflow is waiting for approval. The agent may monitor the run, but the human
approval is the release control point.

## Verify The Release

After the workflow succeeds, verify the chosen dist-tag and the registry tag
map:

```bash
npm_tag=latest
npm view "bb-app@$npm_tag" version
npm view bb-app version dist-tags versions --json
npx --yes "bb-app@$npm_tag" --help
```

Report:

- version published
- Git commit published
- npm `latest` and any non-latest dist-tags
- workflow run URL
- validation commands and result
- any follow-up risks

## Publish The Desktop App

The npm publish does not build or publish the desktop app. The desktop release
is a separate workflow that builds, signs, and notarizes the macOS app, creates
the immutable `desktop-v<version>` GitHub release, and moves the `desktop-latest`
release and its `desktop-version.json` auto-update feed. Run it from the same
pushed `main` commit, at the same version, for every stable release.

```bash
gh workflow run build-desktop.yml \
  --ref main \
  -f publish=true \
  -f release_channel=stable
```

- `release_channel=stable` is required to update `desktop-latest`; `qa` builds
  artifacts without moving the public feed.
- Only a non-prerelease version is published. The workflow refuses to publish a
  prerelease (`X.Y.Z-...`) to `desktop-latest`.
- macOS signing/notarization secrets must be configured, or the workflow
  publishes `desktop-version.json` only and withholds the unsigned `.dmg`/`.zip`.
- The `desktop-v<version>` release is immutable: if it already exists the
  workflow fails. Bump to a new version rather than re-running the same one.

If the `npm-release`-style environment or branch protection gates the run, tell
the user and let the human approval be the release control point.

## Verify The Desktop Release

After the desktop workflow succeeds, confirm the published version and feed:

```bash
gh release view desktop-latest --json tagName,assets \
  -q '{tag:.tagName,assets:[.assets[].name]}'
curl -fsSL https://github.com/ymichael/bb/releases/download/desktop-latest/desktop-version.json
```

Confirm `desktop-version.json` reports the released version and that the
`desktop-v<version>` release exists with the expected `.dmg`/`.zip` assets.

Add to the report from "Verify The Release":

- desktop version published and whether signed binaries were uploaded
- desktop workflow run URL

## Failure Handling

- If the version already exists on npm, stop. Bump to the next version in a new
  commit and rerun validation.
- If validation fails, stop. Fix the issue before triggering the workflow.
- If Trusted Publishing fails, check the npm trusted publisher config: owner,
  repo, workflow filename, and environment must exactly match the workflow.
- If the workflow succeeds but tags are stale, wait and re-query before changing
  anything manually.
- If local emergency publish is unavoidable, use `npm publish --tag <tag>` from
  `packages/bb-app` only after explicit user approval and record the OTP-based
  path as a deviation.
- If a legacy prerelease tag should stop resolving to an old build, remove it
  with `npm dist-tag rm bb-app <tag>` using explicit user approval and normal
  npm authentication.
- If the desktop workflow fails because `desktop-v<version>` already exists, do
  not delete the immutable release. Bump to the next version, re-run the npm
  publish, then re-run the desktop workflow.
- If the desktop workflow publishes `desktop-version.json` only (binaries
  withheld), the macOS signing secrets are missing or incomplete. Fix the
  secrets and re-run; do not hand-upload unsigned binaries to `desktop-latest`.
