# Releasing BB Official plugins

This runbook covers updating and publishing the plugins in the default
**BB Official** marketplace. Official plugins are distributed as GitHub Release
`.tgz` assets by `.github/workflows/publish-official-plugins.yml`; they are not
published to npm and their generated `dist/` directories are not checked in.

The three independently versioned plugins are:

| Workflow input | Directory                    | Package name             | Marketplace entry | Release tag template       |
| -------------- | ---------------------------- | ------------------------ | ----------------- | -------------------------- |
| `github`       | `marketplace/plugins/github` | `bb-plugin-github`       | `github`          | `plugin-github-v<version>` |
| `docs`         | `marketplace/plugins/docs`   | `bb-plugin-simple-notes` | `simple-notes`    | `plugin-docs-v<version>`   |
| `memory`       | `marketplace/plugins/memory` | `bb-plugin-memory`       | `memory`          | `plugin-memory-v<version>` |

## Release policy

- Publish only from a commit already merged to `main`.
- Bump each changed plugin's `package.json` version before publishing. Versions
  are independent; do not bump unchanged plugins unless they are intentionally
  part of the release.
- Use a patch bump for changes compatible with the catalog's existing semver
  range. For example, `^0.1.0` accepts `0.1.x` but not `0.2.0`.
- If a plugin requires newer BB or plugin SDK APIs, stage the new compatibility
  line in two changes so the catalog never points at an unpublished artifact:
  1. bump the plugin package version and `engines` ranges, land that source,
     and publish its release from `main`;
  2. immediately promote the published line by updating the entry's
     `source.githubRelease.range` and `installation.engines` in
     `marketplace.json` plus the bundled catalog snapshot in
     `apps/server/src/services/marketplaces/official-marketplace.ts`.
- Never check in `marketplace/plugins/*/dist`. The workflow builds it and
  includes it in the release archive.
- GitHub Releases are currently allowed to be mutable, but normal release
  practice is append-only: do not replace an asset under an existing version.
  Bump the plugin version and publish a new release instead.
- Always report the plugin, version, source commit, release URL, asset digest,
  workflow result, and smoke-test result.

## Prepare the release change

1. Refresh the release branch from `main`.

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

2. Pick the plugin and next version. Confirm the intended release tag does not
   already exist.

   ```bash
   gh release view plugin-docs-v0.1.1 --repo ymichael/bb
   ```

   A not-found result is expected for a new version. Substitute the appropriate
   tag from the table above.

3. Update the selected plugin's `package.json`. When starting a compatibility
   line, update its package engines now, but leave both copies of the official
   catalog on the last published line until the new release exists.

4. Install after dependency changes and keep the lockfile current.

   ```bash
   pnpm install
   ```

5. Validate through Turbo. The release workflow validates every official
   plugin because they share build and marketplace contracts.

   ```bash
   pnpm exec turbo run typecheck \
     --filter=bb-plugin-github \
     --filter=bb-plugin-simple-notes \
     --filter=bb-plugin-memory \
     --filter=@bb/server \
     --filter=@bb/templates

   pnpm exec turbo run test \
     --filter=bb-plugin-simple-notes \
     --filter=bb-plugin-memory \
     --filter=@bb/server \
     --filter=@bb/templates \
     --force > /tmp/official-plugin-test.log 2>&1

   pnpm exec turbo run build \
     --filter=bb-plugin-github \
     --filter=bb-plugin-simple-notes \
     --filter=bb-plugin-memory \
     --force

   npm pack --dry-run --json marketplace/plugins/github
   npm pack --dry-run --json marketplace/plugins/docs
   npm pack --dry-run --json marketplace/plugins/memory
   git diff --check
   ```

   Inspect the pack output for `dist/server.js`, `dist/server.meta.json`,
   `dist/app.js`, and `dist/app.meta.json`. Remove the ignored local build
   output when finished:

   ```bash
   pnpm exec rimraf \
     marketplace/plugins/github/dist \
     marketplace/plugins/docs/dist \
     marketplace/plugins/memory/dist
   ```

6. Commit the plugin update and land it through a normal pull request. Do not
   publish a feature-branch commit.

## Publish from main

Run a dry run first. It installs, typechecks, tests, builds, packs, and inspects
the selected archive without creating a release:

```bash
gh workflow run publish-official-plugins.yml \
  --ref main \
  -f plugin=docs \
  -f dry_run=true
```

After that run succeeds, publish the same selection:

```bash
gh workflow run publish-official-plugins.yml \
  --ref main \
  -f plugin=docs \
  -f dry_run=false
```

Use `plugin=all` only when all three package versions are new and intentionally
being released. The workflow refuses the entire selection before building if
any selected release tag already exists.

Watch the run:

```bash
run_id="$(gh run list \
  --workflow publish-official-plugins.yml \
  --branch main \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

## Verify the release

Confirm the release points at the intended source commit and contains exactly
the expected package archive:

```bash
tag=plugin-docs-v0.1.1
asset=bb-plugin-simple-notes-0.1.1.tgz

gh release view "$tag" \
  --repo ymichael/bb \
  --json url,tagName,targetCommitish,assets

gh api \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  "repos/ymichael/bb/releases/tags/$tag" \
  --jq ".assets[] | select(.name == \"$asset\") | {name,digest,size}"
```

The digest must be `sha256:<64 hex characters>`. BB reads that digest from
GitHub and verifies the downloaded archive before installing it.

For a new compatibility line, land the catalog-promotion PR described above.
Then exercise the marketplace path from a current BB development build:

```bash
bb plugin marketplace update bb-official
bb plugin search docs
bb plugin install simple-notes@bb-official --yes
bb plugin list
bb plugin remove simple-notes
```

For an update release, keep the previous version installed before publishing,
then use `bb plugin outdated` and `bb plugin update <plugin-id>` to verify the
upgrade path. Use `github`, `simple-notes`, or `memory` as the plugin id.

## Failure handling

- If the release tag already exists, do not overwrite its asset. Bump to a new
  version, update the release commit, and rerun.
- If a dry run fails, inspect the failed job and reproduce its Turbo build/test
  or pack command locally before changing release metadata.
- If `plugin=all` partially publishes before a transient failure, inspect all
  three release tags. Rerun the workflow separately only for plugins whose tags
  are still absent.
- If a published release is incomplete or its digest is missing, do not leave
  it as an install candidate. Deleting a public release and tag is destructive;
  do it only with explicit operator approval, then rerun the same version or
  publish a corrected new version.
- If the release succeeds but BB cannot see it, confirm the tag and asset names
  match `marketplace.json`, the version satisfies the catalog range, the
  release is not a draft, and GitHub exposes its SHA-256 digest.
