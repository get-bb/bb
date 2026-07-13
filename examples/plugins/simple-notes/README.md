# Docs

Docs is a filesystem-first document library for bb. Documents remain ordinary
Markdown, HTML, and asset files while the plugin adds nested navigation,
multi-host vaults, rich editing, images, sandboxed HTML, automation, chat
mentions, and links that open inside a thread.

The package and installed plugin ID remain `bb-plugin-simple-notes` and
`simple-notes` for compatibility with existing settings and stored vaults. The
user-facing product name, panel route, CLI, mention provider, and directive are
all Docs.

## Features

- **Vaults on connected hosts:** each vault is a named `{ hostId, rootPath }`
  pair. The default Personal vault uses the primary host and the legacy
  `directory` setting (`~/Notes` by default). Add remote vaults from the panel
  with an absolute path on that host.
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
  chosen from a file link's Open with menu. Workspace and absolute host files
  retain compare-and-swap saves even when they are outside a Docs vault.
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
bb docs write projects/plan.md --vault personal --content '# Plan'
bb docs mkdir projects/archive --vault personal
bb docs move projects/draft.md projects/plan.md --vault personal
bb docs remove projects/old.md --vault personal
```

`write` accepts UTF-8 content through `--content`; the HTTP API is better for
large bodies.

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
```

Example request body:

```json
{ "vaultId": "personal", "path": "projects/plan.md" }
```

The API, CLI, UI RPC, and mention provider share the same path parser and vault
service.

## Install

```sh
bb plugin install examples/plugins/simple-notes
bb plugin config simple-notes set directory "~/Notes"
bb plugin reload simple-notes
```
