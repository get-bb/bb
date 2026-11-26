# Exact API lookup and distribution

## Looking up the exact API

This skill is a guide, not the contract. For an exact signature or a symbol it
does not cover:

1. **`bb plugin types`**, run in the plugin directory (or given its path),
   syncs that plugin's SDK surface to the running bb — no server needed. It
   repins the exact `@get-bb/plugin-sdk` to this bb's SDK version and brings
   the declared runtime-shimmed packages' type-only devDependencies to the
   versions this bb ships, moving them out of `dependencies` when needed (run
   `npm install` after). The SDK goes in `devDependencies`, unless an entry
   imports an SDK subpath that the build bundles from the plugin's own
   install (see the host-entry dependency rule in backend-foundation.md);
   then it goes in `dependencies`, because Git installs omit dev
   dependencies. For an older plugin that still vendors `types/*.d.ts` it
   rewrites those declarations instead. `--check` compares declared files
   and package pins without writing, and fails when the SDK is in the wrong
   field. Build
   and dev refresh vendored declarations and warn about stale package pins;
   they do not repin installed packages or lockfiles.
2. **Read the bundled declarations** — the authoritative surface, with doc
   comments:
   - a plugin that depends on the npm package (every current scaffold) has
     them after `npm install` at
     `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`
     (`bb-plugin-sdk-app.d.ts` for frontend symbols and
     `bb-plugin-sdk-host.d.ts` for the host entry);
   - an older plugin carries `types/bb-plugin-sdk.d.ts` (plus
     `types/bb-plugin-sdk-app.d.ts` for an app), which its `tsconfig.json`
     maps `@get-bb/plugin-sdk` onto. That layout lacks the `/host` and
     `/testing/host` subpaths, so migrate before adding `bb.host`.
     `bb plugin migrate` converts such a plugin to the npm package: it prints
     the plan and asks first (`--yes` when stdin is not a terminal), pins the
     SDK in the field `bb plugin types` picks (raising an older
     `engines.bbPluginSdk` floor), drops the tsconfig path map, deletes the
     vendored declarations (keeping `types/` if it holds your own files), and
     rewrites `@bb/plugin-sdk` imports; rerunning is a no-op, and you run
     `npm install` after. Never migrate a plugin the user did not ask you to
     migrate.
3. **`git clone --depth 1 https://github.com/get-bb/bb`** for host behavior or
   a reference implementation: `packages/plugin-sdk/src/`,
   `apps/server/src/services/plugins/`, `plugins/`, and the provider contract
   in `docs/provider-plugin-api.md` and `docs/provider-bridge-protocol.md`.

Never answer an API question from a generated bundle. The app bundle is
minified. Server and host bundles have source maps, but the declarations and
source files remain the contract.

## Distributing a plugin

Users can install third-party plugins directly from a local path, npm package,
or Git repository:

```sh
bb plugin install ./bb-plugin-notes
bb plugin install npm:bb-plugin-notes@^1.0.0
bb plugin install https://github.com/acme/bb-plugin-notes
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@main
bb plugin install git:https://github.com/acme/bb-plugin-notes.git@^1.2.0
```

A bare HTTP(S) repository URL tracks its default branch. Use the `git:` form
with an explicit branch, tag, or commit when that tracking intent matters.
Install and update run third-party code with full trust. Interactive commands
show the resolved source and ask for confirmation. Pass `--yes` only after the
user confirms that exact source and version. quickstart.md covers what each
install builds and which files an npm package must publish.

### Updates

`bb plugin outdated` checks tracking sources and `bb plugin update` applies
compatible candidates; installing an already-installed managed plugin again is
refused. Updates select only candidates whose `engines.bb` and
`engines.bbPluginSdk` ranges the host satisfies, and report newer
incompatible releases as blocked. Checking reads the candidate's manifest and
never installs dependencies or builds, so a candidate that fails to build is
reported as available and fails when applied. A failed activation rolls back
to the previous state snapshot and records the failure for the user. Keep the
`engines` ranges honest and ship load-safe factories so an update never
strands users.

### Releasing a git plugin with semver tags

Tag each release `vX.Y.Z` and users can install a range instead of a ref:
bb reads the repository's tags, installs the highest release the range allows,
and `bb plugin update` moves them to later releases in the same range.
Prereleases stay out unless the range names one. Give each plugin of a
multi-plugin repository its own tag prefix — `notes/v1.2.3` — and users add
`--tag-prefix notes/`. For the public marketplace, the prefix is the plugin
directory's name plus `/` (`notes/` for `plugins/notes`); see
[Getting listed](#getting-listed-on-the-public-marketplace).

bb records the tag it installed together with the commit that tag pointed at,
and refuses the plugin if that tag is ever moved to another commit. Publish a
fix as a new version rather than retagging.

### Several plugins in one repository

Keep each plugin in its own directory with its own `package.json`, then index
the directories in a `.bb/plugins.json` collection manifest at the repository
root:

```json
{
  "$schema": "https://getbb.app/schemas/plugins.schema.json",
  "schemaVersion": 1,
  "name": "acme-plugins",
  "plugins": [
    { "name": "notes", "source": "./plugins/notes" },
    { "name": "status", "source": "./plugins/status" }
  ]
}
```

Each `source` is a repository-relative directory that starts with `./`. The
file is an index only — it never overrides a plugin's identity, branding,
entry points, or engine ranges. Users install one plugin at a time:

```sh
bb plugin install git:https://github.com/acme/bb-plugins.git@main --plugin notes
bb plugin install git:https://github.com/acme/bb-plugins.git@main --subdirectory plugins/notes
bb plugin install path:. --plugin notes
```

`--subdirectory` works without a collection manifest; `--plugin` resolves an
entry name from it. If the repository is not itself a plugin, an install with
neither flag fails and lists the entry names.

### Publishing your own marketplace

A marketplace is one `marketplace.json` file. It lists plugins with their
store branding and their npm or git source; it never hosts plugin code, and
installing an entry runs the same install pipeline a direct install runs.

```json
{
  "$schema": "https://getbb.app/schemas/marketplace.schema.json",
  "schemaVersion": 1,
  "name": "acme-plugins",
  "displayName": "Acme Plugins",
  "description": "Plugins the Acme team maintains.",
  "plugins": [
    {
      "id": "notes",
      "displayName": "Notes",
      "description": "Keep notes beside a thread.",
      "icon": { "url": "./icons/notes.svg" },
      "tags": ["notes", "interface"],
      "author": { "name": "Acme", "github": "acme", "url": "https://acme.dev" },
      "source": {
        "git": {
          "url": "https://github.com/acme/bb-plugins.git",
          "subdir": "plugins/notes",
          "range": "^1.0.0",
          "tagPrefix": "notes/"
        }
      }
    }
  ]
}
```

Schema version 1 is strict: an unknown field rejects the whole document.
Version 2 ignores unknown fields except inside npm and git source objects,
where an unknown key is rejected because it would change the installed code.
A rejected manifest leaves the last catalog bb validated serving. `name` is the
marketplace's identity and must be unique on the user's machine;
`bb-official` and `bb-community` are reserved.
Compatibility belongs in each plugin package manifest. Icons are `.svg`,
`.png`, or `.webp`, either an absolute https URL or a path relative to the
manifest — bb fetches and validates them server-side and serves them from its
own origin.

Host it three ways, and users add whichever fits:

```sh
bb marketplace add https://plugins.acme.dev/marketplace.json
bb marketplace add git:github.com/acme/bb-marketplace@main
bb marketplace add git:github.com/acme/agent-plugins@main --subdirectory bb
bb marketplace add path:/work/acme-marketplace
bb marketplace list
bb marketplace refresh acme-plugins
bb marketplace remove acme-plugins
```

`list` shows configured catalogs. `refresh` updates discovery metadata and
icons without installing code. `remove` forgets the catalog, while installed
plugins continue as direct installs.

An https marketplace is re-read with a conditional request; a git one is
read from a fresh checkout on each refresh, with `marketplace.json` and any
relative icons read from the repository root, or from the directory named by
`--subdirectory <relative-path>`. An entry's `source.git.subdir` stays
relative to the repository root. Prefer git tag ranges over
pinned refs so a release reaches users without a catalog change. Before
installing from any marketplace other than `bb-official`, bb resolves and
shows the true source — including the exact release tag and commit a range
lands on — so keep your listed URL, subdirectory, and range honest.

Two marketplaces ship with bb. `bb-official` lists the plugins bundled inside
the app, which install from that local copy with no network fetch; inclusion
there is a BB release decision. `bb-community` lists public third-party
plugins that BB does not review; to list one there, see the next section.

### Getting listed on the public marketplace

`bb-community` and https://getbb.app/marketplace list every public plugin that
opts in. There is no pull request and no review, and every listing says "Not
reviewed by BB". A crawler finds the plugin, reads its listing from its latest
release, and refreshes the catalog about every 30 minutes. The
`publish-a-plugin` skill walks an agent through the whole flow.

Opt in one of two ways:

- **GitHub:** give a public repository (not a fork, not archived) the topic
  `bb-plugin`, and push a semver release tag. A root plugin uses `vX.Y.Z`.
  A plugin in a subdirectory uses its directory name as a prefix:
  `notes/v1.2.3` for `plugins/notes` (the plugin id works too). The `v` is
  required: bb installs only `v` tags, so a bare `1.2.3` tag is never listed
  (`no-release-tag`). The crawler
  reads the plugins `.bb/plugins.json` lists, or the repository root when there
  is no such file. Prereleases, branches, and the default branch are never
  listed; every field is read from the highest stable tag.
- **npm:** include `bb-plugin` in package.json `keywords` and `npm publish`. A
  deprecated `latest` is not listed. When the package's `repository` is a
  crawled GitHub repository, the plugin is listed once, from npm.

The listing comes from the plugin's own files:

```json
{
  "name": "bb-plugin-notes",
  "keywords": ["bb-plugin", "notes", "markdown"],
  "bb": {
    "name": "Notes",
    "description": "Keep project notes beside each thread.",
    "branding": { "icon": "./icon.svg" }
  },
  "bbMarketplace": {
    "category": "thread-content",
    "secondaryCategories": ["memory-and-context"],
    "screenshots": ["./screenshots/notes-panel.png"]
  }
}
```

- The id is `derivePluginId(name)`. Ids that start with `bb--`, ids of plugins
  bundled with BB, and ids another source already holds are refused; rename
  the package.
- `bb.name`, `bb.description`, and `bb.branding.icon` become the display name,
  description, and icon. The icon is a BB icon name or a relative `.svg` of at
  most 256 KiB.
- `keywords` become tags: `bb-plugin`, `bb`, and `bb-plugins` are dropped, the
  rest are lowercased, and only kebab-case words of at most 32 characters are
  kept, up to 10.
- `bbMarketplace` is a top-level key that bb ignores when it loads the plugin.
  Set `category`: it is optional, but a plugin without one is listed
  uncategorized. An unknown category id is an error, `secondaryCategories`
  holds at most 3 other categories, and an unknown key is an error.
  `bb plugin new` scaffolds an empty `bbMarketplace` to fill in.
- `bbMarketplace.screenshots` holds at most 6 relative paths inside the plugin
  directory: PNG, JPEG, or WebP files whose extension matches their data, at
  most 2 MiB and at least 1200 px wide.
- PLUGIN_OVERVIEW.md beside package.json becomes the overview (see
  [Store listing text](#store-listing-text)). It is optional, and an invalid
  one drops only the overview, not the listing.
- npm: the overview, a file icon, and every screenshot must be in the
  published tarball, so add them to `files` when package.json has one.
- The author is the GitHub owner, or for npm the owner of `repository`.

Run the same checks locally before you release:

```sh
bb plugin publish --check            # this directory
bb plugin publish --check ./plugins/notes --json
```

It validates everything above, checks the release tag, the GitHub topic or
the npm tarball, and the id against the live catalog, then prints the exact
topic, tag, push, or publish commands. It never pushes, tags, or publishes,
and it exits 1 when an error would keep the plugin out. The crawler's verdict
for each source, with the same reason codes (`no-release-tag`,
`missing-category`, `invalid-screenshot`, `id-claimed`, …), is in
https://getbb.app/marketplace/index/v1/report.json under
`github:OWNER/REPO[/SUBDIR]` or `npm:PACKAGE`.

To update a listing, release a new version. Plugins that were added to
get-bb/marketplace by pull request keep working; their authors update them the
same way, by self-publishing from the same source or a repository of the same
GitHub owner. The self-published listing then replaces the old entry; the old
category, icon, screenshots, and overview carry over only where the release has
none.

### Store listing text

A store listing has two text fields. The short `bb.description` in
package.json is the one-sentence hook. It appears on every browse card and as
the lead paragraph on the detail page. Keep it under about 140 characters.
State the outcome the user gets.

`PLUGIN_OVERVIEW.md` beside package.json holds the long-form description. The
detail page shows it in an Overview section under the lead paragraph, in the
app and on the public getbb.app marketplace. `bb plugin new` scaffolds one,
the public marketplace reads it from your release, and a plugin that is only
installed from a local path or a private source still reads better with one.

The file is the same claim as `bb.description` at length: the same outcome, the
same surfaces, no capability the short text does not imply. Treat the two as
one text in two lengths. Whenever you change `bb.description`, or add or remove
a surface, update this file in the same change so the lead paragraph and the
Overview section never disagree.

The marketplace crawler reads the file at your release tag (or from the npm
tarball) and publishes it as the listing's overview. A bundled BB plugin uses
the same file, and the bb-official generator folds it into the built catalog.

Follow these rules. `bb plugin publish --check` reports a file that breaks
one (`invalid-overview`), and the crawler then publishes the listing without
the overview.

- UTF-8 text with a maximum of 4000 characters. Aim for 700 to 1800.
- Headings, paragraphs, emphasis, strong text, strikethrough, inline code,
  code blocks, blockquotes, lists, thematic breaks, and links only.
- No raw HTML, images, tables, footnotes, or task lists. Put images in
  screenshots instead.
- Each link is an absolute https URL. The store opens it in the browser.
- Use `##` headings for sections. The page renders each heading as a small
  uppercase label. Do not start with a `#` title, and do not repeat the short
  description as the first sentence.

Lead with the outcome, then sections such as What you get, How it works, and
Requirements. Name every cost: an external service, an account, a separate
install, or a limited operating system. Name agent surfaces with their exact
tool or `bb` command names in inline code.
