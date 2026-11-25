---
name: publish-a-plugin
description: "List a BB plugin on the public marketplace (bb-community), or update an existing listing, when publication or a marketplace listing is requested."
---

# Publish a plugin

List a public plugin on the BB marketplace at https://getbb.app/marketplace
and in the app's bb-community catalog. Listing is self-service. There is no
pull request and no review: a crawler finds plugins that opt in and reads
their listing from the plugin's own latest release. Every listing says "Not
reviewed by BB".

- **GitHub:** a public, non-fork, non-archived repository with the topic
  `bb-plugin` and a semver release tag.
- **npm:** a published package with `bb-plugin` in package.json `keywords`.

The listing appears within about 30 minutes of the release.

An existing marketplace entry keeps working. Its author updates the listing
(description, screenshots, category, version range) the same way: self-publish
from the same repository or package, or from a repository of the same GitHub
owner. The self-published listing replaces the old entry. Its category,
icon, screenshots, and overview carry over only where the release has none, so put
the current ones in the release. Do not open a pull request to
get-bb/marketplace.

## Choose the task

If the user asks only for instructions, explain the process without remote
changes.

If the user asks for a listing, prepare and validate everything possible. Ask
only for information that the plugin, Git, npm, or GitHub cannot supply.

A listing request does not approve a release. Before the first Git push, tag,
topic change, npm publication, or other remote mutation, show the exact
account, repository, commit, package, version, tag, and commands. Get approval
for that release.

Do not expose credentials, private URLs, or local secrets.

## Workflow

1. Read repository instructions, package.json, Git state, and release state.
2. Validate the plugin with its package manager and `bb plugin build`. Read
   references/plugin-release.md before this step.
3. Fill in the listing in the plugin itself: `bbMarketplace` (category,
   optional secondaryCategories and screenshots), `keywords`,
   `bb.description`, `bb.branding.icon`, and PLUGIN_OVERVIEW.md. Capture the
   screenshots. Read references/listing.md before this step.
4. Run `bb plugin publish --check` in the plugin directory. Fix every error
   and decide about every warning. Run it again until it reports no errors.
   It never pushes, tags, or publishes.
5. Commit the listing changes.
6. Get approval for the release (references/plugin-release.md).
7. Publish:
   - GitHub: add the `bb-plugin` topic
     (`gh repo edit OWNER/REPO --add-topic bb-plugin`), then push the commit
     and a new tag (`vX.Y.Z`, or `<dir>/vX.Y.Z` for a plugin in a
     subdirectory). The `v` is required; a bare `X.Y.Z` tag is never listed.
   - npm: keep `bb-plugin` in `keywords`, then `npm publish`.
8. Wait for the next crawl, then confirm the listing (below).

`bb plugin publish --check` prints the exact topic, tag, push, and publish
commands for this plugin. Use them rather than composing your own.

Use scripts/derive-plugin-id.mjs to calculate the plugin ID that BB and the
marketplace use when `bb` is not available:

```sh
node /PATH/TO/THIS/SKILL/scripts/derive-plugin-id.mjs /PATH/TO/PLUGIN/package.json
```

## Confirm the listing

The crawler publishes one verdict per source at
https://getbb.app/marketplace/index/v1/report.json. The key is
`github:OWNER/REPO`, `github:OWNER/REPO/SUBDIR`, or `npm:PACKAGE`.

```sh
curl -s https://getbb.app/marketplace/index/v1/report.json | jq '.sources["github:acme/bb-plugin-notes"]'
```

`"status": "listed"` with the new version means the listing is live; open
https://getbb.app/marketplace/PLUGIN-ID to see it. `"status": "skipped"` has a
`reason` code, the same code `bb plugin publish --check` prints: fix it,
release a new version, and check again. `id-claimed` means another source
holds the id; rename the package.

## Completion

Return the released source (repository and tag, or package and version), the
`bb plugin publish --check` result, and the report verdict or the time you
checked it. Do not wait more than one crawl unless the user asks.

A later release updates the listing on its own. Every new tag or npm version
is read again, so change the description, screenshots, or category in the
plugin and release.
