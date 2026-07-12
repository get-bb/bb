# Simple Notes: folders, media, HTML, and multi-host plan

## Target experience

Simple Notes remains a filesystem-first notebook. A notebook (“vault”) is a
named, root-confined directory on one connected bb host. Markdown, HTML, and
attachment files stay portable and can be edited outside bb.

The first complete release should support:

- Multiple vaults, each identified by `{ id, name, hostId, rootPath }`.
- Nested folders and root-relative POSIX paths.
- Markdown notes with pasted, dropped, and linked images.
- A portable `::html{src="./report.html" height="480"}` block directive.
- Full-pane previews for `.html` files in the vault tree.
- Host-routed list/read/write/move/remove/mkdir operations.
- A `bb notes` CLI and token-authenticated JSON API using the same service
  layer as the UI.

## Core decisions

### Files remain the source of truth

Markdown, HTML, and attachments live only in the selected vault. Plugin SQLite
stores vault configuration and a rebuildable search/summary cache; it does not
become the canonical note store.

### Paths are vault-relative internally

Every UI, RPC, CLI, and persisted event passes a normalized, root-relative
POSIX path such as `projects/q3/plan.md`. Only the plugin backend combines it
with a vault root. The daemon receives the absolute path, explicit `hostId`,
and explicit `rootPath` on every operation.

Reject absolute paths, empty segments, `.`/`..`, backslash traversal,
NUL bytes, and any symlink escape. Case-collision behavior follows the target
filesystem and is surfaced as a conflict rather than guessed by the frontend.

### One preview transport serves images and HTML

Add a reusable server-owned preview lease. A trusted backend requests a short-
lived lease for `{ hostId, rootPath }` and receives an opaque, path-shaped URL:

```text
/api/v1/file-previews/<leaseId>/projects/q3/report.html
```

Sibling URLs remain beneath the same lease, so HTML-relative images, styles,
scripts, modules, and data files work. The daemon remains responsible for
symlink-safe root confinement.

Preview responses use the daemon MIME type, `X-Content-Type-Options: nosniff`,
and conservative size limits. HTML documents get `Content-Security-Policy:
sandbox allow-scripts`; the UI iframe also omits `allow-same-origin`. Leases
expire, are unguessable, and cannot change host or root.

### HTML is preserved as a Markdown directive

The stored source is exactly:

```md
::html{src="./report.html" height="480"}
```

`src` resolves relative to the containing note. It must remain under the
vault root and end in `.html` or `.htm`. `height` is an integer with the same
bounded range as inline-vis. Unknown attributes are rejected visibly and the
original source remains editable.

## Delivery phases

### Phase 1 — host file primitives and SDK contracts

Add the missing raw host operations before changing Simple Notes:

1. Expose the daemon’s existing recursive `host.list_paths` through the public
   files API and `bb.sdk.files` so callers can request files and directories.
   Include `kind`, root-relative path, and file `modifiedAtMs`/`sizeBytes` to
   support a cheap cache refresh.
2. Add daemon commands and public SDK methods for confined `mkdir`, `move`,
   and `remove`.
3. Give destructive operations optimistic guards:
   - `move`: optional expected source SHA and create-only destination default.
   - `remove`: expected SHA for files; explicit recursive flag for non-empty
     directories.
4. Route every operation through an explicit host selected at the server
   boundary. Keep retry behavior read-only; do not automatically retry writes,
   moves, or removals.
5. Regenerate server contracts and bundled plugin SDK declarations, and update
   plugin-authoring documentation.

Acceptance:

- Unit tests cover traversal, symlink escape, destination collision, stale
  SHA, offline host, Windows/POSIX separators, and idempotent directory create.
- Public route tests prove host routing and default-host resolution.
- Existing file read/write/list callers remain source-compatible.

### Phase 2 — vault model and nested tree

1. Add plugin SQLite migrations for:
   - `vaults(id, name, host_id, root_path, created_at)`.
   - `note_index(vault_id, path, modified_at_ms, size_bytes, title, preview)`.
2. Add a settings section for listing, adding, renaming, and removing vault
   configurations. Populate the host picker from `bb.sdk.hosts.list()`.
3. On upgrade, seed one “Personal” vault from the existing `directory`
   setting on the primary host. Do not silently reinterpret a server-local
   path as belonging to a remote host.
4. Replace the flat filename validator with a single shared `NotePath` parser.
5. Replace direct `node:fs` usage in the plugin with `bb.sdk.files` calls.
6. Return a tree contract containing folders and supported files. Refresh the
   rebuildable note index from list metadata, reading only new or changed
   Markdown files with bounded concurrency.
7. Render collapsible folders plus virtual Recent and Starred sections.
   Create notes inside the selected folder; title-based rename preserves the
   parent directory. Add new folder, move, rename, and delete actions.
8. Encode deep links segment-by-segment and include the vault id in the panel
   route so two vaults can contain the same relative path.

Acceptance:

- Create/open/save/rename/move/delete work at least three levels deep.
- Browser history and direct links restore the correct vault and file.
- External edits produce a refresh; open-note saves retain CAS conflict UI.
- An unavailable host shows an offline state without erasing the cached tree.
- Large trees are bounded and expose truncation rather than silently omitting
  entries.

### Phase 3 — reusable asset and HTML preview leases

1. Add the server preview-lease service and path-shaped content route.
2. Add `bb.sdk.files.createPreviewLease({ hostId, rootPath, ttlMs? })`.
3. Constrain TTL and total live leases; dispose plugin-owned leases on plugin
   reload where possible and let expiry handle abnormal termination.
4. Serve all relative resources through the same lease. Preserve query strings
   and fragments while validating only the decoded path portion.
5. Match existing generic HTML preview limits and sandbox policy.

Acceptance:

- Nested relative CSS, JS, image, module, and fetch paths load.
- Traversal (including percent-encoded and backslash variants), symlink escape,
  expired lease, wrong host, oversized HTML, and MIME confusion fail closed.
- HTML cannot reach the parent bb DOM, cookies, or storage.
- Preview URLs do not reveal host ids or absolute roots.

### Phase 4 — Markdown images and attachments

1. Add the Tiptap image extension and Markdown parse/serialize support.
2. Render relative image paths through the active vault preview lease; leave
   remote `https:` images supported according to browser policy, but reject
   `file:`, `javascript:`, and unsafe data URLs.
3. Add paste, drag/drop, and file-picker upload. Store files under an
   `_attachments/` directory next to the note or at a documented vault-wide
   location; prefer note-relative `_attachments/` for portable folder moves.
4. Generate collision-resistant filenames, preserve a safe original-name
   suffix, MIME-sniff server-side, impose per-file size limits, and write with
   base64 plus create-only semantics.
5. Serialize portable Markdown such as
   `![diagram](./_attachments/diagram-<id>.png)`.
6. Do not automatically delete attachments when a reference disappears;
   orphan cleanup should be a separate explicit command after scanning the
   vault.

Acceptance:

- PNG/JPEG/GIF/WebP/SVG policy is explicit and tested; SVG is either sandboxed
  as an image or excluded from v1.
- Paste/drop/upload round-trip through Markdown without rewriting unrelated
  source.
- Folder moves keep note-relative attachments working.
- Offline and upload-conflict states are recoverable.

### Phase 5 — embedded and full-page HTML

1. Add a Tiptap atom/block node for the `::html` directive with a custom
   Markdown parser and serializer.
2. Render a small header with source path, sandbox state, reload, open full
   page, and edit-source actions.
3. Resolve the source relative to the note and validate it through the backend
   before constructing the preview URL.
4. Add `.html` and `.htm` entries to the vault tree. Selecting one opens a
   full-pane preview with reload, view source, and open-in-panel actions.
5. Reuse the exact same preview lease and sandbox component for embedded and
   full-page rendering.
6. Preserve malformed or missing directives as visible source plus an error;
   never drop them during editor serialization.

Acceptance:

- Directive source survives open/save/open byte-for-byte except documented
  formatter normalization.
- Relative assets and anchors work in embedded and full-page modes.
- Missing files and invalid heights show localized errors without crashing the
  editor.
- Scripts run inside the opaque-origin sandbox and cannot access bb chrome.

### Phase 6 — automation API, CLI, and agent access

Build a `NotesService` in the plugin backend and make RPC, HTTP, CLI, mentions,
and agent tools call it rather than duplicating filesystem logic.

1. Register `bb notes` with discoverable command metadata:
   - `vault list|get|add|remove`
   - `list [path] --vault <id>`
   - `read <path> --vault <id>`
   - `write <path> --vault <id> [--create]`
   - `mkdir`, `move`, and `remove`
2. Add optional stdin forwarding to the core plugin CLI proxy so this is safe
   and useful for real content:

   ```sh
   bb notes write projects/plan.md --vault personal < plan.md
   ```

   Only read stdin when it is non-interactive, cap its size, and add it as an
   explicit optional field at the CLI/server/plugin boundary.

3. Add token-authenticated plugin HTTP routes (`list`, `read`, `write`,
   `mkdir`, `move`, `remove`) with strict JSON schemas. Keep UI RPC local-auth
   only. Never use unauthenticated routes.
4. Add native agent tools only if tool ergonomics materially beat the CLI;
   otherwise rely on the generated plugin-commands skill.
5. Update the Simple Notes README and CLI command metadata. Document token
   creation and examples without logging token values.

The daemon does not call into the plugin. A CLI or API caller contacts the bb
server; the plugin selects the vault and applies policy; `bb.sdk.files` routes
the raw operation to the vault’s connected daemon.

Acceptance:

- CLI supports text larger than shell-argument limits through stdin.
- `--json` outputs stable machine-readable contracts.
- API token, missing token, rotated token, invalid vault, traversal, stale SHA,
  and offline host cases are covered.
- UI, CLI, and HTTP produce identical path and conflict behavior.

### Phase 7 — realtime refresh, migration, and rollout

1. Add a host-routed filesystem watch primitive or a bounded polling service.
   Publish `vault-changed` via plugin realtime and have the frontend refetch.
   Prefer a daemon watcher for responsive external edits; polling is an
   acceptable first release if its interval and tree limits are conservative.
2. Rebuild the cache when a vault changes hosts/roots or cache schema changes.
3. Keep the legacy single-directory setting readable for one migration window,
   then remove it rather than accepting and ignoring it.
4. Gate HTML and multi-vault behavior behind plugin-internal capability checks
   until the required server SDK methods are present.
5. Run live QA with one local and one remote daemon, including disconnect and
   reconnect while a dirty note is open.

## Suggested pull-request sequence

1. **Core file operations:** public list-paths/mkdir/move/remove plus SDK and
   daemon tests.
2. **Vaults and tree:** Simple Notes storage migration, settings UI, nested
   operations, remote host selection.
3. **Preview leases:** reusable path-shaped host preview service and security
   tests.
4. **Images:** Tiptap image round-trip and attachment workflow.
5. **HTML:** directive node and full-page viewer.
6. **Automation:** shared NotesService, CLI stdin support, `bb notes`, and
   token-authenticated API.
7. **External changes and hardening:** watcher/polling, migration cleanup,
   cross-host end-to-end QA, docs.

Each PR should typecheck with Turbo for every touched package and run focused
tests through Turbo. Plugin database tests use in-memory SQLite with migrations;
daemon and server routes use their real command/route harnesses rather than
mocking the database.

## Explicit non-goals for the first release

- Obsidian plugin or vault-format compatibility beyond ordinary Markdown and
  folders.
- Collaborative editing or server-authoritative note storage.
- Automatic cross-host vault replication or offline write queues.
- Executing HTML outside a sandbox.
- Automatic attachment garbage collection.
- A general-purpose binary editor.
