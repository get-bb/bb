# Docs

Docs is a filesystem-first document library for bb. Documents remain ordinary
Markdown, HTML, and asset files while the plugin adds nested navigation,
multi-host vaults, rich editing, images, sandboxed HTML, automation, chat
mentions, and links that open inside a thread.

The package and installed plugin ID remain `bb-plugin-simple-notes` and
`simple-notes` for compatibility with existing settings and stored vaults. The
user-facing product name, catalog listing, panel route, CLI, mention
provider, and directive are all Docs.

## Features

- **Vaults on connected hosts:** each vault is a named `{ hostId, rootPath }`
  pair. A new installation starts with a Personal vault at `~/Notes` on the
  primary host. Manage local and remote vaults from the Docs panel.
- **Nested folders:** the resizable right sidebar recursively displays folders,
  Markdown documents, and HTML pages. It can be collapsed, and search stays
  hidden until requested.
- **Safe host-routed operations:** all list/read/write/mkdir/move/remove calls
  go through `bb.sdk.files` with an explicit vault root. Saves retain SHA-256
  compare-and-swap conflict handling. Local vaults use native filesystem
  watching for immediate UI refreshes; remote or unwatchable vaults fall back
  to polling.
- **Default Markdown editor:** Docs registers for `.md`, `.mdx`, and
  `.markdown` files, so it can be selected under Settings → File openers or
  chosen from a file link's Open with menu. Workspace, absolute host, and
  thread-storage files retain compare-and-swap saves even when they are outside
  a Docs vault.
- **YAML frontmatter:** an opening fenced block that parses as a YAML mapping
  supplies the document title when it has a string `title`, stays out of the
  rendered body and search preview, and is preserved byte-for-byte when the
  rich editor saves body changes. A document that opens with a thematic break
  instead keeps that content in the editor. Docs leaves the filename unchanged
  on save when frontmatter sets the title; otherwise the H1 still drives it.
- **Tables:** GitHub-flavored Markdown tables render as editable cells. Use Tab
  and Shift+Tab to move between cells (Tab from the final cell adds a row), and
  drag column boundaries to resize them. Saves remain portable Markdown.
- **Images:** paste or drop PNG, JPEG, GIF, WebP, or SVG files into a document.
  Attachments are stored beside it under `_attachments/` and serialized as
  portable relative Markdown image links.
- **Embedded HTML:** a Markdown block directive renders a sibling HTML file in
  an opaque-origin iframe:

  ```md
  ::html{src="./report.html" height="480"}
  ```

  Heights are clamped from 120–1200 pixels. The source remains a Markdown
  directive when saved.

- **Full HTML pages:** `.html` and `.htm` files appear in the vault tree and
  open as full-pane previews.
- **Relative assets:** images and HTML use short-lived, path-shaped preview
  leases. Relative styles, scripts, modules, images, and data files stay under
  the selected vault root. HTML responses use `sandbox allow-scripts`, and the
  iframe never receives `allow-same-origin`.
- **Chat mentions:** `@` searches every vault's titles, previews, filenames,
  and folders. A selected document resolves to its latest content at send time.
- **Thread links:** agents can emit a Docs directive that renders as a document
  card. Clicking the card opens an editable, autosaving document in the thread
  side panel; its secondary action opens the full Docs editor. The side-panel
  editor can quote its selection (or full document) into the thread composer or
  insert a live Docs mention. These composer actions are intentionally absent
  from the full nav editor and generic file-opener tabs.

  ```md
  ::docs{vault="personal" path="plans/release-plan.md" title="Release plan"}
  ```

## Agent skill

The plugin ships `skills/docs/SKILL.md`. Installed agents are taught to use the
Docs CLI, understand that a Docs `@`-mention is user-provided document context,
store plans and HTML artifacts in a vault when asked, and return `::docs` links
that the user can open in bb.

## CLI

The plugin registers the agent-discoverable `bb docs` command:

```sh
bb docs vaults --json
bb docs vault-add Work /home/me/work-docs host_workstation
bb docs list --vault personal --json
bb docs read projects/plan.md --vault personal
bb docs pull projects/plan.md --vault personal --into ./docs-work
# Edit ./docs-work/projects/plan.md with an ordinary editor or agent file tool.
bb docs status ./docs-work --diff
bb docs push ./docs-work

bb docs pull projects --folder --vault personal --into ./docs-work
bb docs pull --all --vault personal --into ./docs-work
bb docs push ./docs-work --dry-run --diff
bb docs push ./docs-work --delete
```

### Sync workspace contract

- **Layout and identity:** the destination keeps exact vault-relative paths
  beneath one workspace root and stores a versioned `.bb-docs-state.json`
  manifest at that root. Manifest entries map `vault id + remote path` to a
  local path and retain the pulled SHA-256, byte size, content encoding, MIME
  type, and modification time. A single-file pull still keeps its vault path,
  so every scope has the same layout.
- **Collisions:** exact relative paths are the stable identity. Pull rejects
  case-folding collisions before writing, rather than choosing an unstable
  filename on case-insensitive filesystems. Hidden vault path segments are not
  part of the accessible Docs contract and are skipped.
- **Fidelity and assets:** every accessible file in a folder or vault scope is
  included, not only Markdown/HTML. UTF-8 stays UTF-8; other bytes use base64
  across the host RPC and are written back byte-for-byte. Empty accessible
  directories are retained.
- **Safe refresh:** pulling into an existing valid workspace performs a
  three-way comparison between manifest, local bytes, and current vault bytes.
  It updates only locally unchanged files, preserves local-only edits and new
  files, removes remotely deleted files only when their local copy is
  unchanged, removes remotely deleted empty directories only when they are
  still empty locally, and stops before any write on a true conflict.
- **Safe push:** push preflights the entire scope. Existing writes use their
  pulled SHA-256 as a compare-and-swap guard and new files use create-only
  writes. Remote additions, remote deletions, or concurrent edits are
  conflicts until the workspace is pulled and reconciled.
- **Deletion:** missing local files and empty directories produce warnings and
  are ignored by default. `--delete` removes only paths tracked by the manifest;
  files additionally require the remote SHA to still match, and directories
  must still be empty. A pulled folder root is retained; pull its parent or the
  whole vault to delete that directory. The CLI never infers deletion from an
  untracked path.
- **Dry run and diff:** `status` and `push --dry-run` make no remote changes.
  `--diff` adds a compact unified diff for changed UTF-8 files; binary changes
  remain path summaries. `status` exits 4 when actionable changes/warnings are
  present.
- **Atomicity and recovery:** all conflicts are found before mutation, but
  host filesystems do not provide a cross-file transaction. A daemon or I/O
  failure can therefore yield `partial`; successful remote CAS writes are not
  rolled back. The old manifest remains in place, so rerunning `status`, then
  `pull` or `push`, reconciles already-applied bytes without clobbering them.
  The manifest itself is CAS-written last. Deletes receive a final hash check
  immediately before removal, but the underlying remove primitive is not
  transactional with that check. A compare-and-swap race before any mutation
  is reported as `conflict`; it becomes `partial` only if another mutation was
  already applied.
- **Malformed state:** invalid, duplicate, out-of-scope, or wrong-version
  manifests fail closed. Move the directory aside for inspection and pull into
  a clean destination; the CLI never guesses or repairs identity metadata.
- **Workspace host:** agent invocations resolve the workspace host from the
  current thread environment. Standalone multi-host callers can pass
  `--workspace-host <id>`; omission intentionally targets the primary host.

Human output is concise and `--json` returns a stable structured result on
both success and failure. Exit codes are 0 success/no-op, 1 validation or
operational/partial failure, 2 usage error, 3 stale/conflict, and 4 `status`
found changes or ignored deletions. Options are command-specific; an option
not shown in a command's usage is rejected before any mutation.

The legacy `write`, `mkdir`, `move`, and `remove` CLI commands remain for one
backward-compatibility window and emit a deprecation warning. New agent
workflows must use pull/edit/push. UI/RPC editing remains supported and keeps
its existing compare-and-swap behavior.

## Token-authenticated HTTP API

The stable internal plugin ID remains `simple-notes`. Generate or inspect its
token with `bb plugin token simple-notes`, then send it in
`x-bb-plugin-token` to these JSON endpoints:

```text
POST /api/v1/plugins/simple-notes/http/list
POST /api/v1/plugins/simple-notes/http/read
POST /api/v1/plugins/simple-notes/http/write
POST /api/v1/plugins/simple-notes/http/mkdir
POST /api/v1/plugins/simple-notes/http/move
POST /api/v1/plugins/simple-notes/http/remove
POST /api/v1/plugins/simple-notes/http/sync/snapshot
POST /api/v1/plugins/simple-notes/http/sync/apply
```

Example request body:

```json
{ "vaultId": "personal", "path": "projects/plan.md" }
```

The API, CLI, UI RPC, and mention provider share the same path parser and vault
service. `sync/snapshot` returns a validated file/folder/all snapshot including
content and version metadata. `sync/apply` requires `writes`, `deletes`,
`directories`, `deleteDirectories`, and `dryRun`; it rejects colliding paths,
preflights every expected SHA, reports only directories actually created, and
returns `applied`, `conflict`, or `partial`. Callers must keep local workspace
state client-side.

## Install

```sh
bb plugin install simple-notes
bb plugin config simple-notes set directory "~/Notes"
bb plugin reload simple-notes
```
