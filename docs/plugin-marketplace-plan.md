# Plugin Marketplace Plan

Status: draft for review. Related: issue #1097 (collection manifest), PR #636
(retired marketplaces), PR #721/#737 (official catalog, then bundled entries).

## Goals

1. Define one marketplace manifest format that anyone can host over HTTPS or in
   a git repository. The BB Official marketplace is the first instance.
2. Let entries link to npm packages or git repositories, including
   subdirectories of multi-plugin repositories.
3. Let entries carry store branding, including an icon by URL, in the same
   formats the plugin manifest supports today.
4. Let git sources track semver ranges resolved from git tags, with recorded
   exact resolutions so moved tags fail loudly.
5. Keep the install pipeline authoritative. A marketplace is a discovery and
   provenance layer only. A refresh never installs, updates, or runs code.

## Layer model

| Layer | File / surface | Role |
| --- | --- | --- |
| Collection manifest | `.bb/plugins.json` in a repository | Bare index of nested plugins for direct installs and local discovery (issue #1097) |
| Marketplace manifest | `marketplace.json`, hosted | Catalog with store branding; entries point at npm or git sources |
| Install pipeline | existing server services | Validates the real package manifest; records source intent and exact resolution |

The layers compose: CI can generate a marketplace manifest from a repository's
collection manifest by pinning a ref and pointing each entry at its subdir.

## Manifest format (schemaVersion 1)

```json
{
  "$schema": "https://getbb.dev/schemas/marketplace.schema.json",
  "schemaVersion": 1,
  "name": "bb-official",
  "displayName": "BB Official",
  "description": "Plugins built and reviewed by the BB team.",
  "plugins": [
    {
      "id": "thread-hover-cards",
      "displayName": "Thread Hover Cards",
      "description": "Preview thread status from the sidebar.",
      "icon": { "url": "./icons/thread-hover-cards.svg" },
      "tags": ["interface", "threads", "sidebar"],
      "author": {
        "name": "BB Team",
        "github": "get-bb",
        "url": "https://getbb.app"
      },
      "source": {
        "git": {
          "url": "https://github.com/brsbl/bb-plugins.git",
          "subdir": "plugins/thread-hover-cards",
          "range": "^1.0.0",
          "tagPrefix": "thread-hover-cards/"
        }
      }
    },
    {
      "id": "agent-sidebar",
      "displayName": "Agent Sidebar",
      "description": "Sidebar for agent status.",
      "icon": { "url": "https://plugins.getbb.dev/icons/agent-sidebar.png" },
      "author": { "name": "BB Team", "github": "get-bb" },
      "source": { "npm": { "package": "bb-plugin-agent-sidebar", "range": "^1.0.0" } }
    }
  ]
}
```

Rules:

- The schema is strict. Unknown fields are an error. `schemaVersion` gates
  evolution. An invalid file is rejected whole; the last-known-good catalog
  stays in place. Entry-level failure isolation applies at install time, not
  at parse time, so consumers always see a deterministic catalog.
- `id` is unique per marketplace and matches `^[a-z0-9][a-z0-9-]*$`.
- `author` is required on every entry: `name` (required), `github` (a GitHub
  login or org, optional), and `url` (https only, optional). It is display
  metadata in the schema; the official registry additionally uses `github` as
  the listing's ownership record (see "Author identity and ownership"). Do
  not put email addresses in the manifest — it is a public, mirrored file.
- `tags` is an optional free-form keyword list for store grouping, search,
  and filters: lowercase kebab-case, at most 10 tags, each at most 32
  characters. Tags are display-only. There is no separate `category` field;
  the Browse tab derives its groupings from tags. The official marketplace
  keeps a curated tag vocabulary (the current `PLUGIN_CATALOG_CATEGORIES`
  set, lowercased) so its sections stay stable.
- A listing declares no compatibility. There is no `engines` field, and the
  strict schema rejects one. A listing's copy of a range is a second source of
  truth that goes stale as soon as the plugin publishes a new version, and it
  hid compatible plugins behind an out-of-date manifest. bb reads `engines.bb`
  and `engines.bbPluginSdk` from the fetched plugin's own `package.json` and
  refuses the install there instead.
- Sources are objects, not strings. Strings stay in the CLI; the manifest is a
  machine contract with per-field validation and no parser to reimplement.
- Display fields exist so the store renders without a clone or an npm fetch.
  After install, the plugin's own manifest is authoritative for identity,
  branding, entry points, and compatibility.

### Source union

```
source = { "npm": { package, range?, tag?, registry? } }   // tag = npm dist-tag
       | { "git": { url, subdir?, ref } }            // branch, tag, or commit
       | { "git": { url, subdir?, range, tagPrefix? } }  // semver over tags
```

- npm `range` and `tag` are mutually exclusive. `tag` is an npm dist-tag such
  as `beta`, matching the CLI's existing `npm:pkg@beta` support. A dist-tag is
  a mutable pointer, so it gets "tracks" semantics: the install records the
  exact resolved version, and `bb plugin update` re-resolves the dist-tag.
- git `ref` and `range` are mutually exclusive; exactly one is required.
- `subdir` is a relative path. Reject absolute paths, empty segments, and
  `..`. Enforce symlink containment with `realPathInside` at stage time.
- `tagPrefix` supports monorepo tagging, in the style of Go subdirectory
  modules: the tag `thread-hover-cards/v1.2.3` versions one plugin
  independently. Default is no prefix (repo-wide `vX.Y.Z` tags).

## Icons

Entry `icon` accepts the same shapes the plugin manifest supports today:

- A host icon name (string), as `GIT_OFFICIAL_PLUGINS` uses now.
- `{ "url": ... }` pointing at an `.svg`, `.png`, or `.webp` file — the same
  format set as `bb.branding.logo`. The URL is absolute `https:` or relative;
  a relative URL resolves against the manifest's own URL, which lets a
  git-hosted marketplace keep icons next to the manifest. Plain `http:` is
  rejected.
- bb masks an SVG icon with the surrounding text color, the same way it
  renders a plugin's own compact `bb.branding.icon`. Most catalog icons are
  single-color glyphs, and an unmasked black-on-transparent SVG is invisible
  on a dark theme. PNG and WebP icons keep their own colors: a mask reads
  alpha only and would flatten an opaque image into a solid block. Use a
  raster for multi-color artwork. A per-entry opt-out would be an unknown
  field to older desktops, which reject the whole manifest, so it needs a new
  `schemaVersion`.

Handling:

1. The server fetches icon URLs during catalog refresh, not the client. The
   app never hot-links third-party URLs. This avoids tracking users' requests,
   works offline from the cached catalog, and gives one validation point.
2. Validate before caching: run SVG content through
   `assertValidPluginCompactIconSvg` (the same sanitizer the plugin manifest
   uses); check magic bytes for PNG and WebP; enforce a size cap (256 KB
   proposed). A failed icon falls back to a default glyph and logs a warning;
   it does not invalidate the entry or the catalog.
3. Cached icons persist with the last-known-good catalog and refresh only when
   the manifest's icon URL or ETag changes.

## Semver from git tags

This applies the conclusions from the Go modules discussion:

- Resolution lists `refs/tags/` with `ls-remote` (already used for ref
  classification), filters tags that match `[tagPrefix]vX.Y.Z` and parse as
  valid semver, and selects the highest version that satisfies `range`.
  Prereleases are excluded unless the range itself permits them, matching the
  npm resolver's behavior.
- BB selects highest-satisfying, not Go's Minimal Version Selection. BB
  installs one plugin at a time; there is no dependency graph to minimize.
- The exact resolution records the tag name and the commit SHA it pointed at.
  Tags are mutable; commits are not. The artifact cache is already keyed by
  repository plus commit, so installed content stays immutable.
- If a later resolution finds the recorded tag pointing at a different commit,
  BB refuses with a security error that names the tag and both commits. Do not
  silently re-resolve. This is the `go.sum` lesson.
- Update model: a git range behaves like an npm range — the plugin "tracks
  compatible". `bb plugin outdated` lists newer satisfying tags from the
  marketplace's current manifest or from `ls-remote`; `bb plugin update`
  applies one manually through the existing staged-activation and rollback
  path.
- The same capability ships for direct installs. Proposed syntax:
  `bb plugin install git:github.com/acme/repo@^1.2.0`. A spec that parses as a
  semver range and is not a valid single ref name resolves against tags.
  Decision point below.

## Refresh and trust

- Persist a validated last-known-good catalog per marketplace. Refresh with
  conditional HTTP (ETag) on startup and on an interval. Failures keep the
  last-known-good catalog. This restores the PR #721 machinery.
- A refresh updates discovery metadata and icons only. It never installs,
  upgrades, or executes anything.
- Adding a marketplace installs nothing. Removing a marketplace keeps its
  installed plugins as direct installs with full provenance (PR #636 rule).
- Install confirmation for third-party entries shows the true resolved source
  (npm package or git URL, ref/tag, subdir) before anything runs.
- Plugin ID collisions across marketplaces resolve through `id@marketplace`
  install routing. A conflicting installed plugin ID is refused, as today.

## Provenance

Generalize the current `builtin | direct | catalog` enum: keep `catalog` as
the stored kind, add a marketplace name column, and make `bb-official` a
reserved marketplace name. Existing rows with `catalog` provenance migrate to
`bb-official`. Phase 3 then needs no further migration. Persisted git state
gains the range, tag prefix, and resolved-tag fields next to the existing
`sourceGitSubdirectory` column.

## Official marketplace: registry repo and submissions

The official marketplace is built from a dedicated registry repository
(proposed: `get-bb/marketplace`), not from this repo. It contains data only:

```
get-bb/marketplace/
  entries/<plugin-id>.json    # one marketplace entry per file; filename = id
  icons/<plugin-id>.svg       # optional local icons (.svg/.png/.webp)
  scripts/build               # validate entries, compose dist/marketplace.json
```

- Each entry file holds exactly one entry object from the schema above. One
  file per plugin means submission PRs never conflict with each other.
- The build step composes `dist/marketplace.json` deterministically: sort
  entries by id, require filename = id, reject duplicate ids, validate against
  the published schema, validate icons (SVG sanitizer, magic bytes, size cap),
  and check source liveness (`git ls-remote`, npm registry lookup).
- CI runs the build on every PR. Merge to main publishes `marketplace.json`
  and the icon files to getbb.app: `https://getbb.app/marketplace/v1/
  marketplace.json` and `/marketplace/v1/icons/<id>.svg`, served with ETags so
  the app's conditional refresh works. Entry icons reference the local files
  relatively, which the relative-URL rule already supports.

  Deployment: getbb.app is the `bb-web` Cloudflare Worker, deployed from the
  main repo — so the catalog cannot live in the site bundle, or every listing
  merge would need a site deploy. Instead:

  1. Registry CI uploads the built files to an R2 bucket
     (`bb-marketplace`) with a Cloudflare API token scoped to that bucket,
     stored as a registry-repo secret. Icons upload first, the manifest
     last, so a reader never sees a manifest that references a missing icon.
  2. `bb-web` adds an `r2_buckets` binding and one route: `/marketplace/v1/*`
     reads the object from R2 and serves it with the R2 ETag,
     `content-type`, and cache headers. Icons get long-lived caching; the
     manifest gets a short TTL plus conditional revalidation.
  3. The site deploys once to add the route; every publish after that is a
     registry-repo action only. A staging bucket bound to the staging worker
     (vibecodethis.site) mirrors the flow for testing.

  Serving through the worker (rather than a public R2 custom domain) keeps
  the catalog on the getbb.app origin and keeps header control in one place.
- The schema is the cross-repo contract. This repo publishes it at the
  `$schema` URL (and the icon validator as a small package); the registry CI
  consumes it. Nothing else couples the repos.

Why a separate repo instead of this one:

- Submissions are PRs from strangers. The registry repo runs a small,
  data-only CI with no secrets and no app code paths. PRs against the main
  monorepo would run heavy CI and widen the supply-chain surface.
- Curation rights differ from app commit rights. Registry maintainers can
  review and merge listings without write access to BB itself.
- Listing changes publish on merge, on the registry's own cadence. No app
  release, no main-repo CI queue, and the registry's git history is the
  catalog's audit log — a revert is a de-listing.
- Submitters fork a tiny repo, not the monorepo, and submission issues stay
  out of the app's issue tracker.

The costs — schema version sync across repos and one more repo to watch — are
covered by the published-schema contract and by CI ownership.

`brsbl/bb-plugins` stays what it is: the source repo for BB's own plugins.
The registry's official entries point at it; third-party entries point at
their authors' repos or npm packages. The registry never hosts plugin code.

### Submission flow

Submission uses the built-in `submit-a-plugin` skill. The skill completes the
release and marketplace pull request without a product-specific form.

1. **Read what BB already knows.** For a locally developed plugin, the agent
   reads the package manifest and Git remote: plugin id, display
   name, description, icon, repository URL, subdir from the collection
   manifest, and current version tags. The author reviews and completes the
   entry — tags, `url`, the range — rather than typing it from scratch.
2. **Create the PR as the author.** The agent composes `entries/<id>.json` and uses
   the author's own GitHub credentials — `gh` auth on the host, which BB's
   audience overwhelmingly has — to fork the registry repo, push a branch,
   and open the PR from their account. This makes `author.github`
   self-verifying: the listing's owner is the account that opened the PR.
3. **Fallback without `gh`.** The agent writes the composed entry to disk.
   It then gives the manual fork and pull request steps.
4. Registry CI validates the entry. A maintainer reviews the plugin itself —
   source, behavior, requested engine ranges — and merges to approve.
5. Merge publishes the updated catalog; the app picks it up on its next
   conditional refresh.

The skill uses `gh repo fork` and `gh pr create` on the host when available.

### Author identity and ownership

The schema requires `author.name`; the official registry additionally
requires `author.github` and treats it as the listing's ownership record:

- The submission flow fills it from the GitHub account that opened the
  listing PR, so it is verified at listing time, not self-reported.
- Entry-change PRs must come from the owner's account (or a registry
  maintainer). CI checks the PR author against `author.github`; org-owned
  listings accept any public member of the org.
- Ownership transfer is an entry PR that changes `author`, approved by a
  maintainer, ideally with an approving review from the departing owner.
- The listing workflow does not collect contact email.
- CI warns (does not fail) when the entry author disagrees with the
  `author` field of the plugin's own package manifest at the pinned or
  resolved source, so drift is visible in review.

The store shows the author on entry cards and detail pages: `name`, linking
to `url` or the GitHub profile. Third-party marketplaces can use the same
field purely as display metadata; the ownership semantics are official-
registry policy, not schema.

### Listing review and updates (high-trust model)

The official marketplace reviews the listing once, then trusts the author to
release. Entries use ranges by default — a git tag range or an npm range or
dist-tag. An author ships an update by tagging or publishing in their own
repository or on npm; no registry PR is involved, and the catalog does not
change.

- **New listings get human review.** A maintainer reviews the plugin's
  source, behavior, and requested engine ranges before the first merge. That
  approval covers the source location, not one frozen version.
- **Releases flow from the author's side.** The client resolves the range
  against tags or the npm registry and records the exact commit or version it
  installed. Nothing on the registry blocks or gates a release.
- **Entry changes still get review.** Retargeting the source URL or subdir,
  renaming the plugin, changing branding, or widening a range is a registry
  PR, reviewed by a human. The identity of a listing stays curated even
  though its versions do not.
- **Range bounds are the review boundary.** Recommend `^1.0.0`-style ranges:
  patches and minors flow freely, and a major release does not match the
  range, so it returns to the registry as an entry PR. Breaking releases get
  a natural human touchpoint without any per-release process.

Safety nets that remain in the high-trust model:

- The client never auto-installs. A refresh feeds `bb plugin outdated`;
  applying an update is a manual, staged, rollback-protected action.
- The moved-tag check records tag-to-commit resolutions and refuses a tag
  that later points elsewhere.
- De-listing is a revert in the registry, live on the next publish.
- A maintainer can switch any entry to an exact pin if an author or source
  loses trust. The pinned-plus-automated-bump model described in this plan's
  history remains the documented fallback if the catalog later needs lower
  trust as it grows.

The accepted risk: a compromised author account can ship a bad in-range
release to users who choose to update, with de-listing as the remedy after
the fact. That is the npm trust model, and it is the right trade while the
catalog is small and authors are known.

## Phases

**Phase 0 — collection manifest and nested installs (issue #1097).**
Fill `sourceGitSubdirectory` at install time (the update pipeline already
honors it). Add `--subdirectory` as the primitive and `--plugin` to resolve a
name from `.bb/plugins.json`. Publish the collection schema.

**Phase 1 — the BB Official marketplace.**
Publish the marketplace schema. Create the registry repo with per-plugin entry
files, the compose-and-validate build, and publishing to
`getbb.app/marketplace/v1/`. Seed it with the current `GIT_OFFICIAL_PLUGINS`
entries. The app bundles a seed snapshot as offline fallback. Restore the
refresh loop. Replace `GIT_OFFICIAL_PLUGINS` with catalog rows; the Browse tab
reads the catalog. Generalize provenance. Server-side icon fetch and
validation. Add the built-in submission skill after the registry contract
stabilizes.

**Phase 2 — semver from git tags.**
Add the tags candidate path to the update resolver, `tagPrefix`, moved-tag
detection, and the direct-install range syntax. Marketplace git entries may
then use `range` instead of a pinned `ref`.

**Phase 3 — third-party marketplaces.**
`bb marketplace add | list | remove` for `https:`, `git:`, and `path:`
sources. `id@marketplace` install routing. Browse sections per marketplace.
Trust UX: true-source confirmation on first install from a new marketplace.

Each phase ships its CLI, SDK, `bb guide`, and skill-doc surfaces in the same
change, per the repository guidelines. Database changes go through Drizzle
schema plus regenerated migrations. The work is server-side; no
`HOST_DAEMON_PROTOCOL_VERSION` bump is expected, but verify whenever a session
payload changes.

## Decision points

1. **Direct-install range syntax.** Implicit detection (`@^1.2.0` parses as a
   range, so resolve tags) or explicit (`@semver:^1.2.0`). Implicit reads
   better; explicit is unambiguous when a tag is literally named `^1.2.0`.
   Recommendation: implicit, with a loud error if the spec matches both a
   range and an existing ref name.
2. **Bare `bb plugin install <id>`.** Resolve across marketplaces only when
   exactly one match exists; otherwise fail and list matches. Recommendation:
   yes, matches the #636 behavior.
3. **Icon size cap.** 256 KB proposed; confirm against real logo assets.
4. **No hosted submission service.** Decided: the in-app `gh` flow is the
   submission path, and the no-`gh` fallback is the generated entry file
   plus manual PR steps. No form ships on getbb.app.
5. **Sandboxed install check in registry CI.** Running a submitted plugin's
   build in CI improves review but executes third-party code; if added, it
   needs an isolated runner with no secrets.

## Implementation notes

- A marketplace entry ID is also the installed plugin ID. The package
  manifest must use the same ID.
- The official fallback uses a typed TypeScript seed. This stack does not add
  a checked-in registry snapshot.
- A Git marketplace source follows one literal ref. It does not accept a tag
  range.
- A bare Git version such as `v1.2.3` stays a literal ref. The `semver:` prefix
  selects a tag range.
- Browse categories come from entry tags. The marketplace manifest has no
  category field.
- Published schemas use `https://getbb.app/schemas/` URLs.
- This stack adds the R2 reader and its binding. The registry repository,
  publication credentials, and publication workflow remain future work.
- The submission skill creates registry pull requests. No hosted submission
  service or in-app submission dialog exists.

> AGENT GENERATED: by Claude Fable 5
