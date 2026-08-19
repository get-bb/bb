---
name: submit-a-plugin
description: Submit a bb plugin to the BB Community marketplace. Use this whenever a user asks to submit, list, publish, or add a plugin to the BB marketplace, or asks for a marketplace pull request. This skill checks the plugin, prepares a Git tag or npm release, creates a complete entry and icon, validates the marketplace, and opens the pull request.
---

# Submit a plugin

Submit a public plugin to the BB Community marketplace through a pull request.

The marketplace lists plugin data only. The plugin code stays in its Git repository or npm package.

## Start with current contracts

The marketplace contract can change independently from bb releases.

1. Open the plugin repository and read all applicable instruction files.
2. Inspect the plugin manifest and its current Git state.
3. Read the current marketplace files before you make an entry.

Use this source repository:

```text
https://github.com/get-bb/marketplace
```

Read these files from its default branch:

- `README.md`
- `schema/marketplace.schema.json`
- `icons/README.md`
- Two or more current files in `entries/`

Treat those files as the source of truth. Use this skill for the workflow and quality checks.

## Determine the user request

If the user asks only for instructions, give instructions without external changes.

If the user asks for submission, prepare the release and pull request.

Ask only for information that you cannot obtain from the plugin, Git, npm, or GitHub.

Stop before each release mutation until the user approves the exact release.

Do not expose tokens, npm credentials, private URLs, or local secrets.

## Check the plugin

Find the plugin package before you prepare a release.

1. Read its `package.json`.
2. Find the package `name`, `version`, `engines`, and `bb` fields.
3. Confirm that `bb.name`, `bb.description`, and `bb.branding` describe the plugin.
4. Derive the plugin ID from the package name.
5. Confirm that the derived ID matches the planned marketplace entry ID.
6. Check the Git remote and the repository visibility.
7. Check for a `.bb/plugins.json` file in a repository with multiple plugins.
8. Determine the plugin subdirectory from the repository root.

Use the bundled helper to calculate the same ID that bb uses:

```sh
node /PATH/TO/THIS/SKILL/scripts/derive-plugin-id.mjs /PATH/TO/PLUGIN/package.json
```

The helper reads the package name without putting it into shell source.

The algorithm removes the npm scope and a lowercase `bb-plugin-` prefix.

It then converts the name to lowercase. It changes each other character to a hyphen.

It removes hyphens from both ends. It stops when this process produces an empty ID.

For example, `@acme/bb-plugin-notes` supplies the ID `notes`.

Use the repository package manager. Run its focused tests, type checks, and build commands.

Run this command from the plugin directory when the current bb CLI exists:

```sh
bb plugin build
```

Do not release a plugin with failed checks or uncommitted release changes.

## Get separate release approval

A request to submit a plugin does not approve an npm publication or a Git push.

Prepare and validate everything that does not change remote state first.

Before the first release mutation, show the user these exact values:

- The authenticated account.
- The repository and remote URL.
- The release commit.
- The package name and version.
- The Git tag or npm source.
- Every command that will change remote state.

Ask the user to approve this release. Do not push a commit or tag before approval.

Do not run `npm publish` before approval. Do not treat approval of another release as approval for this release.

## Select a release source

Use one source in the marketplace entry. Prefer a Git semver range for a public Git repository.

Choose npm when the author already distributes a complete npm package.

Use an exact Git ref only when the author intentionally wants a fixed release.

### Git semver release

Use `vX.Y.Z` tags for one plugin at the repository root.

Use `<plugin>/vX.Y.Z` tags when a repository releases multiple plugins independently.

Set `tagPrefix` to the text before `vX.Y.Z` for the second form.

Create a new tag for every release. Never move or replace an existing release tag.

After user approval, use an annotated tag after the release commit exists:

```sh
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin HEAD
git push origin v1.2.3
```

For a plugin-specific tag, use commands such as these:

```sh
git tag -a notes/v1.2.3 -m "Release notes v1.2.3"
git push origin HEAD
git push origin notes/v1.2.3
```

Confirm that the public repository shows the tag:

```sh
git ls-remote --tags https://github.com/OWNER/REPOSITORY.git
```

Use a marketplace source such as this:

```json
{
  "git": {
    "url": "https://github.com/OWNER/REPOSITORY.git",
    "range": "^1.2.3"
  }
}
```

Add `subdir` for a plugin below the repository root. Add `tagPrefix` for plugin-specific tags.

### Exact Git release

An exact ref prevents automatic selection of later compatible releases.

Use an immutable tag or full commit hash:

```json
{
  "git": {
    "url": "https://github.com/OWNER/REPOSITORY.git",
    "ref": "v1.2.3"
  }
}
```

### npm release

An npm marketplace source must refer to a published package.

The npm package must contain the prebuilt bb files. A Git install can build source during installation.

1. Run `bb plugin build`.
2. Run the plugin tests and type checks.
3. Run `npm pack --dry-run --ignore-scripts`.
4. Confirm that the package includes its manifest and required `dist` files.
5. Confirm the npm account with `npm whoami`.
6. Publish the exact manifest version with `npm publish --ignore-scripts` after approval.
7. Add `--access public` for a new public scoped package.
8. Confirm publication with `npm view PACKAGE@VERSION name version`.

Do not publish a version that already exists. Increase the package version and rebuild instead.

Use a marketplace source such as this:

```json
{
  "npm": {
    "package": "@acme/bb-plugin-notes",
    "range": "^1.2.3"
  }
}
```

Use `tag` instead of `range` only when the author intentionally tracks an npm distribution tag.

## Prepare the entry

Create one file named `entries/<plugin-id>.json`.

Use the current schema. Do not add fields that the schema does not define.

Include these required fields:

- `id`
- `displayName`
- `description`
- `icon`
- `author`
- `source`

Use `tags` and `engines` when they provide useful search or compatibility data.

The `id` must match the filename and the plugin manifest ID.

Write `displayName` as the product name. Do not repeat the package name unless it is the product name.

Write one concrete sentence for `description`. State what the plugin adds and the user value.

Do not use claims such as "best," "powerful," or "easy." Describe observed behavior instead.

Use up to ten specific lowercase tags. Use hyphens in tags with multiple words.

Copy honest engine ranges from the plugin manifest. A marketplace entry can narrow those ranges but cannot widen them.

Set `author.github` to the GitHub account that opens the pull request.

Run this command to get that account when `gh` exists:

```sh
gh api user --jq .login
```

Do not put an email address in the public entry.

Use this shape as a guide. Confirm every field against the current schema.

```json
{
  "id": "notes",
  "displayName": "Notes",
  "description": "Keeps project notes beside each bb thread.",
  "icon": { "url": "./icons/notes-1234abcd.svg" },
  "tags": ["notes", "interface"],
  "author": {
    "name": "Acme",
    "github": "acme",
    "url": "https://acme.example"
  },
  "engines": {
    "bb": ">=0.40.0",
    "bbPluginSdk": ">=0.5.0"
  },
  "source": {
    "git": {
      "url": "https://github.com/acme/bb-plugin-notes.git",
      "range": "^1.2.3"
    }
  }
}
```

## Add the icon

Always vendor the plugin's icon. Copy the icon file into the marketplace `icons/` directory. Reference only that vendored copy from the entry.

Do not reference a remote URL, a CDN, a `raw.githubusercontent.com` link, or a path in the plugin repository. The marketplace must serve the icon from its own repository, so the icon stays available when the plugin repository changes or moves.

Use the plugin's existing brand icon when it meets the marketplace rules.

The entry can use a supported BB host icon name. It can also use a vendored icon file.

Use `.svg`, `.png`, or `.webp` for an icon file. Keep the file at or below 256 KB.

Prefer a simple square image with clear contrast at small sizes.

BB masks an SVG icon with the surrounding text color, so a single-color SVG follows the user's theme. PNG and WebP icons keep their own colors. Use PNG or WebP for multi-color artwork.

Do not include scripts, remote resources, or private data in an SVG.

Copy the file into `icons/`. Use a content hash in the filename to prevent stale cached icons.

Use a name such as `<plugin-id>-<first-eight-sha256-characters>.svg`.

Calculate the hash with this command:

```sh
sha256sum path/to/icon.svg
```

Use `shasum -a 256 path/to/icon.svg` when `sha256sum` is not available.

Reference the file from the entry:

```json
"icon": { "url": "./icons/notes-1234abcd.svg" }
```

If the plugin has no suitable artwork, use a current BB host icon name. Do not invent an unsupported name.

## Clone the marketplace and create a branch

Use the submitter's GitHub account. Verify authentication before you make remote changes.

```sh
gh auth status
gh api user --jq .login
```

Create or reuse the submitter's fork. Clone it into a new, narrow directory.

```sh
gh repo fork get-bb/marketplace --clone=false
git clone https://github.com/GITHUB_LOGIN/marketplace.git /SAFE/NEW/PATH/marketplace
cd /SAFE/NEW/PATH/marketplace
git remote add upstream https://github.com/get-bb/marketplace.git
git fetch upstream main
git switch -c submit-PLUGIN_ID upstream/main
```

If `upstream` already exists, verify its URL instead of adding it again.

Do not reuse a directory with unrelated changes. Do not overwrite an existing branch.

## Continue without gh

The missing `gh` command must not prevent local entry preparation and validation.

If `gh` is missing or authentication fails, clone the public repository directly:

```sh
git clone https://github.com/get-bb/marketplace.git /SAFE/NEW/PATH/marketplace
cd /SAFE/NEW/PATH/marketplace
git switch -c submit-PLUGIN_ID
```

Create the entry and icon in this clone. Complete all local validation steps.

Return the local clone path, entry path, icon path, branch name, and validation results.

Give the user these manual steps:

1. Fork `get-bb/marketplace` in GitHub.
2. Add the fork as a Git remote.
3. Push `submit-PLUGIN_ID` to that fork.
4. Open a pull request from that branch to `get-bb/marketplace:main`.

Do not stop with only general instructions when you can prepare validated local files.

## Validate the marketplace

Install only the marketplace repository dependencies. Do not run code from the submitted plugin during this step.

```sh
npm ci --ignore-scripts
npm run build
npm run check
```

The build checks the JSON contract and icon path. The check also confirms the public release source.

Inspect the result before you commit:

```sh
git status --short
git diff --check
git diff -- entries/PLUGIN_ID.json icons/
```

Confirm these facts:

- The entry ID matches the filename and plugin manifest.
- The public source contains the selected release.
- The release contains the reviewed plugin code.
- The source subdirectory is correct.
- The engine ranges do not exceed the plugin manifest ranges.
- The author GitHub name matches the pull request account.
- The description states the real user value.
- The icon is clear and follows the size and format rules.
- The icon file is vendored in `icons/`, and the entry does not reference a remote icon URL.
- `npm run build` and `npm run check` succeed.

## Open the pull request

Commit only the new entry and its icon. Do not commit `dist/` or unrelated files.

```sh
git add entries/PLUGIN_ID.json icons/PLUGIN_ICON
git commit -m "Add plugin entry: PLUGIN_ID"
git push -u origin submit-PLUGIN_ID
```

Open the pull request against `get-bb/marketplace:main`.

```sh
gh pr create \
  --repo get-bb/marketplace \
  --base main \
  --head GITHUB_LOGIN:submit-PLUGIN_ID \
  --title "Add plugin entry: PLUGIN_ID" \
  --body-file /SAFE/PATH/pr-body.md
```

Use only the validated plugin ID in shell arguments. Keep display names and descriptions in data files.

Write a short pull request body with these sections:

- What the plugin does.
- The source release and selected range or ref.
- The plugin checks that succeeded.
- The marketplace checks that succeeded.
- Any permissions, external services, or security facts that reviewers need.

Follow all pull request instructions from the marketplace repository and the current environment.

Return the pull request URL, the released source, and the validation results to the user.

Do not wait for merge unless the user asks you to monitor or finish the pull request.

## Future releases

A tracking range usually needs no marketplace pull request for a compatible release.

Publish a new npm version or create a new immutable Git tag. BB can then show the compatible update.

Open another marketplace pull request for source, branding, description, ownership, tag, or range changes.
