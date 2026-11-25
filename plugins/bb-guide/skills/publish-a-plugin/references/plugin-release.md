# Plugin validation and release

Read this file before you validate or release the plugin.

## Validate the plugin

1. Read package.json.
2. Inspect name, version, engines, bb, keywords, and bbMarketplace.
3. Confirm that bb.name, bb.description, and bb.branding describe the plugin.
4. Calculate the plugin ID with scripts/derive-plugin-id.mjs.
5. Inspect the Git remote, visibility, worktree state, and release state.
6. For a multi-plugin repository, inspect .bb/plugins.json and find the plugin
   subdirectory. The crawler reads only the directories that file lists, or
   the repository root when there is no such file.
7. Run focused tests, type checks, and builds with the repository package
   manager.
8. Run bb plugin build from the plugin directory.
9. Run bb plugin publish --check from the plugin directory.

The ID algorithm removes the npm scope and a lowercase bb-plugin- prefix. It
converts the remaining value to lowercase, replaces other characters with
hyphens, trims edge hyphens, and rejects an empty result.

For example, @acme/bb-plugin-notes supplies notes.

Do not release a plugin with failed checks or uncommitted release changes.

## Get release approval

Prepare every read-only check and local file before approval. Then show the
user:

- The authenticated account.
- The repository and remote URL, or the npm package.
- The release commit.
- The package name and version.
- The Git tag or npm version.
- Every command that will change remote state, including the topic change.

Get approval for these exact values. Approval for another release does not
apply. Do not push a commit or tag, change repository topics, or run npm
publish before approval.

## Select one source

Prefer a public GitHub repository with release tags. Use npm when the author
already distributes a complete npm package. When the same plugin is on both,
the crawler lists it once, from npm, if the package's `repository` points at
the repository.

### GitHub release

The crawler lists the highest stable semver tag and reads every listing field
from that tag. A prerelease tag, a branch, or the default branch is never
listed.

- A plugin at the repository root uses `vX.Y.Z`.
- A plugin in a subdirectory uses its directory name as a prefix:
  `notes/vX.Y.Z` for `plugins/notes`. The plugin id also works as a prefix
  (`<id>/vX.Y.Z`).
- The `v` is required. bb installs only tags named `<prefix>vX.Y.Z`, so a
  bare `1.2.3` or `notes/1.2.3` tag is never listed (`no-release-tag`). If the
  repository already uses bare tags, add a `v` tag for the release.

Create a new immutable tag for every release. After approval, add the topic
once, then tag the release commit:

```sh
gh repo edit OWNER/REPOSITORY --add-topic bb-plugin
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin HEAD
git push origin v1.2.3
```

For a plugin in a subdirectory:

```sh
git tag -a notes/v1.2.3 -m "Release notes v1.2.3"
git push origin HEAD
git push origin notes/v1.2.3
```

Verify the public tag:

```sh
git ls-remote --tags https://github.com/OWNER/REPOSITORY.git
```

bb refuses a plugin whose installed tag later moves to another commit. Publish
a fix as a new version rather than retagging.

### npm release

An npm package must contain the prebuilt BB files and the listing assets:
PLUGIN_OVERVIEW.md, a file icon, and every screenshot. When package.json has
`files`, add them to it.

1. Run bb plugin build.
2. Run tests and type checks.
3. Run npm pack --dry-run --ignore-scripts.
4. Confirm that the package contains its manifest, the required dist files,
   and the listing assets. bb plugin publish --check confirms the assets.
5. Confirm that `keywords` includes `bb-plugin`.
6. Confirm the account with npm whoami.
7. After approval, run npm publish --ignore-scripts.
8. Add --access public for a new public scoped package.
9. Confirm publication with npm view PACKAGE@VERSION name version keywords.

Do not republish an existing version. Increase the version and rebuild. A
deprecated `latest` version is not listed.
