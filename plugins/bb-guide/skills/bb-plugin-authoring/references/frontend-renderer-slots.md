# Renderer and action slots

- `experimental_sourceCodeRenderer` / `experimental_diffRenderer` →
  replace bb's source or diff renderer everywhere it draws supplied content:
  the native file preview, timeline file diffs, the environment diff panel's
  file bodies, and every plugin calling the host components. Registration:
  `{ id, title, description?, component }`. Like `experimental_threadList`
  each slot is **exclusive** — one renderer at a time; a plugin the user
  installed wins over one bundled with bb, then the first in slot order, and
  a missing, disabled, or crashing replacement falls back to bb's
  renderer. Installing and enabling the plugin activates it, and the user can
  pin bb's renderer or a specific provider under
  **Settings → Appearance** ("Source code" / "Diffs"), per client. There are no
  scope or extension filters on the registration, so conditional behavior
  belongs in the component. Source props:
  `{ content, path, overflow, highlightedLines, Original }`;
  diff props:
  `{ patch, path, view, overflow, showLineNumbers, experimental_fullFileContents,
Original }`. `experimental_fullFileContents` is either
  `{ old: { path, content }, new: { path, content } }` or `null`; a replacement
  can use those complete UTF-8 sides to implement context expansion.
  Every value is already resolved. Render `Original` (bb's
  renderer, bound to this call) to delegate without re-entering resolution —
  behind a plugin setting, by language, over a size threshold:

  ```tsx
  app.slots.experimental_diffRenderer({
    id: "compact",
    title: "Compact diffs",
    component: ({ patch, path, Original }) =>
      patch.length > 20_000 ? (
        <Original />
      ) : (
        <MyDiff patch={patch} path={path} />
      ),
  });
  ```

  Experimental: see `docs/api_to_audit.md`.

- `experimental_composer` → `{}` — draw bb's composer input box everywhere
  bb shows a composer (a thread's composer, the New thread screen, queued and
  sent message editors): the editor, @-mention and slash-command menus,
  attachments, voice, the `+` and send menus and the send and stop controls.
  Banners, approval cards and queued messages above the box stay bb's.
  Registration: `{ id, title, description?, component }`. Exclusive like
  `experimental_threadList`: a composer from a plugin the user installed wins
  over the bundled Composer plugin; users choose under **Settings → Appearance
  → Composer** (`composer.provider`). With no composer plugin enabled, no
  composer is shown. bb's own composer is the bundled `plugins/composer`
  plugin, built on this slot; copy it to make your own.

  Read and write the draft with `useComposer()` (`draft`, `replace`) and
  submit with `useComposer().submit()`: inside the component they are bound
  to this box, and submit runs the box's own Enter action, which can steer a
  running thread. `submit({ experimental_mode })` picks queue or steer
  explicitly.

  `experimental_useComposerRenderer()` returns `input` (`surface`,
  `submission`, `mentionTriggers`, `commandTriggers`, `resolveMentionLink`,
  `attachments`, `history`, `voice`, sizing and
  collapse state, and bb's `executionControls`, `handoff` and
  `compactBeforeSend` controls to place as you like), `view`, `key`,
  `inputLocked`, `focusComposerShortcut`, `decorationSources` (bb's and
  other plugins' highlight rules, in paint order), and host services
  (`threadLinks.parse`/`cached`/`resolve`, `clipboard.readMessage`/
  `readMessageImage`, `attachmentSrc`, `dispatchAppCommandKey`,
  `showError`). `input.submission.enter` and `.modifier` are the box's
  actions: `kind` (`send`, `queue` or `steer`), `requiresInput`,
  `shortcut`, and `run()`; gate each on `requiresInput` and your own
  upload and voice state. `input.compact` (`when: "always" | "narrow"`,
  `placeholder`) says when to show a one-line form; report the form you
  show in `editor.state.layout`. Pass your menu element and open state to
  `experimental_ComposerRoot` (`menuRef`, `menuOpen`). Mentions, attachments and history entries
  use the same `ComposerMention`, `ComposerAttachment` and
  `ComposerDraftSnapshot` shapes as `useComposer()`, and
  `input.resolveMentionLink(mention)` says what clicking any pill or
  attachment does. Search with `experimental_useComposerMentionSearch()`
  and `experimental_useComposerCommandSearch()`: call `search(query)` from the
  event that opens, changes or closes (`null`) the menu, next to your own
  state update, and the ranked `groups` for that query arrive in the same
  render. Each mention suggestion carries the `mention` to insert, its `text`
  and per-kind display fields. Call `dispatchAppCommandKey(event)` from the editor's key
  handler before handling a key, so bb's shortcuts work inside an editor that
  swallows keys. Pills look and copy like bb's own with
  `experimental_describePromptMention(mention)` (classes, tooltip, text) and
  `experimental_promptMentionClipboardAttributes(mention, text)`;
  `experimental_readPromptMentionClipboard(element)` reads a pill copied from
  any bb composer or message back on paste.

  Render `experimental_ComposerRoot` inside the composer's root element with
  `rootRef` and an `editor` (state, caret insertion, focus, thread drops,
  other plugins' popups and, optionally, voice transcript delivery). bb
  reaches the composer only through this editor. It publishes the editor to other plugins'
  `useComposer()`, runs bb's and other plugins' composer commands for keys
  inside the root, and makes the root the target of pane focus and of
  threads dragged from the sidebar. `experimental_useComposerContributions()`
  returns other plugins' `popups`, `plusMenuItems` and `sendMenuItems` with
  their host renderers (`Popup`, `MenuEntry`) and an `Actions` component for
  their inline actions; surfaces that hide plugin customizations return none.
  Other host components: `experimental_VoiceInputButton`,
  `experimental_VoiceRecordingBar`, `experimental_FailedVoiceRecordings`,
  `experimental_ShortcutHint`, `experimental_ImageLightbox`,
  `experimental_PromptMentionIcon`, `experimental_PluginIcon`,
  `experimental_ThreadTitleText`, plus `experimental_useThreadTitleDisplayText`.

  ```tsx
  app.slots.experimental_composer({
    id: "plain",
    title: "Plain composer",
    component: () => {
      const composer = useComposer();
      const { input } = experimental_useComposerRenderer();
      return (
        <textarea
          value={composer.draft.text}
          placeholder={input.placeholder}
          onChange={(event) =>
            composer.replace({ text: event.target.value, mentions: [] })
          }
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void composer.submit();
          }}
        />
      );
    },
  });
  ```

  Experimental: see `docs/api_to_audit.md`.

- `messageDirective` → `{ attributes, source, message,
openWorkspaceFile }` — register a leaf
  assistant-message directive. Registration:
  `{ id, component }` where `id` is lowercase kebab-case beginning with a
  letter (e.g. `inline-vis` matches `::inline-vis{file="demo.html"}`).
  Props: `attributes` is a `Readonly<Record<string, string>>` of untrusted
  parsed key/values (validate your own fields); `source` is the original
  directive text (useful for diagnostics); `message` is
  `{ id, threadId, turnId, projectId }` for the enclosing assistant (or
  nested agent) message. `openWorkspaceFile` is either
  `(path: string) => boolean` or `null`; pass it a worktree-relative path to
  open that file in the host's workspace viewer. It is `null` when the message
  surface has no workspace viewer, and it returns whether the host accepted
  the path. To open one of the same plugin's side-panel tabs, call
  `experimental_useAppPanel().openTab({ tab, params?, title? })`
  ([Panel controller](frontend-hooks-and-ui.md#panel-controller)); use normal
  plugin navigation as the fallback when it returns false.
  **Host behavior / fallbacks:** only assistant and
  nested agent Markdown activate directives — user messages, file previews,
  and other Markdown surfaces stay plain. Directives inside inline code or
  fenced code blocks stay literal. Incomplete streaming directives stay
  literal until the closing syntax arrives. Unknown, disabled, malformed,
  conflicting, or crashing directives fall back to rendering the original
  `source` (the component ErrorBoundary still isolates a throw). Treat
  attributes as attacker-controlled even though the model emitted them;
  load workspace data through `bb.sdk.files` with root/host confinement
  rather than trusting paths. Reference implementation:
  `plugins/inline-vis` (a workspace or thread-storage HTML file shown in a
  borderless, sandboxed frame that follows the page's height and bb's theme,
  including relative assets and normal web loading).
- `experimental_codeFenceRenderer` → `{ code, language, status, index,
message, Original }` — render fenced code blocks of chosen languages in
  assistant-message Markdown with a plugin component (e.g. a ` ```ui `
  block rendered live as the reply streams). Registration:
  `{ id, languages, component }`; `id` uses letters, digits, `-`, `_` and is
  unique within the plugin; `languages` is non-empty and each entry matches
  `/^[a-z0-9][a-z0-9+#._-]*$/`. A plugin may claim a language once across its
  registrations (duplicates are rejected at load). Props: `code` is the fence
  body so far, without the delimiters; `status` is `"streaming"` while the
  closing fence has not arrived and the reply is still being written,
  `"closed"` once the closing fence is present (`code` is final), and
  `"unclosed"` when the reply ended without one (for example an interrupted
  reply); `index` is the zero-based ordinal among fences of the same language
  in the message (other languages don't shift it); `message` matches
  `messageDirective`'s; `Original` renders BB's code block (highlighting,
  copy button, mermaid diagrams). BB mounts the component once per fence and
  keeps that instance while the message stays on screen, so component state
  survives the whole stream, including the fence closing and the reply
  finishing. State that must outlive the mounted component (a reload, the
  message scrolling out of the rendered window) belongs under
  `${message.id}#${language}#${index}`. `experimental_useAppPanel()`
  works inside it as for `messageDirective`. **Host behavior / fallbacks:**
  activates only where `messageDirective` does (assistant and nested agent
  Markdown); user messages, file previews, and plugin Markdown keep BB's code
  block. BB's code block also renders when two plugins claim the same
  language (BB logs a console warning naming them), when the plugin is
  missing or disabled, and for a fence whose component throws. A throw
  affects that fence only, and BB tries the component again when the fence's
  `code` or `status` changes, so a renderer that fails on a half-streamed
  body recovers on the next chunk. Treat `code` as attacker-controlled even
  though the model emitted it: run generated markup or scripts in a sandboxed
  frame, never in the bb page. Reference implementation:
  `plugins/inline-vis` (a ` ```inline-vis ` block holding an HTML page).
  Experimental: see `docs/api_to_audit.md`.
- `experimental_messageMetadata` → React metadata beside realized user and assistant
  messages in the main timeline and embedded `ThreadChat`. Registration:
  `{ id, placement?: "above" | "actionRow", component }`; omitted placement
  means above. `"actionRow"` renders in the message's action row, shows and hides
  with the actions, and never narrows them; components decide their own device
  policy (bb's own inline time hides itself on touch);
  bb's own inline message time uses it. The component receives `{ message }` with
  stable `id`, `threadId`, `createdAt`, `turnId`, and `role`; user messages also
  have `initiator`. Filter by returning null. Contributions retain bb, then
  plugin/registration order within each placement; each throw is contained
  independently. Text streaming does not update this context, and windowed-out
  rows unmount the component. See the Plugin Guide message metadata card for the
  public contract and examples.
- `messageAction` → an action on chat messages: an icon button in the
  per-message action bar (user and assistant messages) and an entry in the
  assistant-message text-selection menu. Slot actions are limited to the main
  timeline; embedded `ThreadChat` suppresses them on both surfaces. Host-rendered chrome, no plugin
  component — registration: `{ id, title, icon?, run }`. Activating it calls
  `run(context)` with `{ threadId, message, selectedText?, experimental_panel, composer }`:
  `message` is a narrow stable reference
  `{ id, threadId, role: "user" | "assistant", text, sourceSeqEnd, experimental_messageSeq }` (never
  an internal timeline row); `experimental_messageSeq` is the recorded message
  sequence used by `?msg=`, `sdk.threads.message`, and `bb thread log --message`,
  while `sourceSeqEnd` anchors provider-history forks; `selectedText` is present only for
  selection-menu invocations and holds the exact highlighted text; and
  `experimental_panel` is the thread view's
  [panel controller](frontend-hooks-and-ui.md#panel-controller). Errors from `run` (sync or
  async) are contained and
  logged, never breaking the timeline.
- `app.commands.register` → a row in bb's quick palette (Mod+Shift+P), listed
  under "Plugins" beside bb's own commands. Host-rendered chrome, no plugin
  component — registration: `{ id, title, defaultShortcut?, isAvailable?, run }`. Both callbacks
  receive `{ threadId, projectId, experimental_panel }`, where `threadId` and
  `projectId` are null on surfaces without one and `experimental_panel` is the
  focused surface's [panel controller](frontend-hooks-and-ui.md#panel-controller). `isAvailable` is called for palette listing and keyboard invocation — keep
  it cheap and synchronous — and hides the row when it returns false; a row
  that needs a thread should use it, because the palette opens anywhere and
  `experimental_panel` declines (returning false) when the focused surface has
  no such tab.
  Errors from either callback are contained and logged, never breaking the
  palette. Write self-identifying titles ("Linear: open issue for this
  thread"): the palette matches the query against the title.
  `app.slots.commandPaletteAction` is a deprecated alias accepting the same
  fields. Both entry points share one ID namespace; registering the same ID
  through either path twice rejects plugin setup.
  `defaultShortcut: { key: "i", mod: true, shift: true }` supplies an initial
  binding. `mod` means Command on macOS and Control elsewhere; omitted `meta`,
  `control`, `alt`, `shift`, and `mod` are false. Use a Command/Control/Alt
  chord or function key. Every command appears in Settings → Keyboard, even
  without a default. Colliding plugin defaults remain unbound with an
  explanation; assigning an occupied shortcut offers Replace binding or
  Cancel. User overrides survive plugin reload, disable, and re-enable under
  `plugin:<plugin-id>/<command-id>`. Keyboard invocation uses the same current
  context and error handling as the palette and is suppressed while a modal
  is open. Shortcuts run only while the plugin frontend is active.
  A command that acts on the composer the user is typing in registers through
  `app.composer.experimental_registerCommand` instead; see the composer
  section of frontend-hooks-and-ui.
- `experimental_timelineRenderer` → the expanded body of the timeline rows a
  provider plugin owns. Registration: `{ kind, component }`, where `kind` is
  one of the plugin's own extension item kinds (`"<pluginId>/<name>"`, as
  declared in `bb.providers.register({ extensionKinds })`) or
  `"tool"` for the generic tool items of the providers this plugin
  registered. Core kinds (messages, commands, file changes, reads, searches,
  delegations, plan steps) always use bb's renderers and are customized only
  through the bridge's presentation. The component receives `row` (id,
  threadId, turnId, kind, toolName, status, startedAt, completedAt),
  `payload` (the extension item's validated payload, or `{ arguments,
output }` for a tool call), `presentation` (the bridge's label, icon,
  title, detail, suppress and tint for the row, or null for a row without
  one), `thread` (`{ id, providerId }`) and `Original`, the host's
  declarative base for the body — render `<Original />` to keep it beside
  your own content. The row header (label, glyph, tint, headline) stays
  host-rendered. With no renderer registered,
  the declarative base renders, so a row never goes blank; a crash in the
  component is contained to that row.
- `experimental_providerIcon` → the React component bb draws as one agent, machine,
  or environment provider's icon. Registration:
  `{ providerKind, providerId, icon }`, with required `providerKind` (`"agent"`, `"machine"`, or `"environment"`); `providerId` is the provider's id (`"codex"`,
  `"git-worktree"`) — not the plugin id — and
  `icon` is a component receiving only `className` (host sizing plus the
  provider color class). Provider logo assets render as a `currentColor`
  mask; use an inline component when the mark needs custom theme-aware or
  multicolor rendering.
  A component beats the file logo for that provider; disabling the plugin
  falls back to it, and so does every surface shown before the plugin's
  deferred `app.tsx` has loaded. One registration per provider kind and id
  per plugin; if two plugins claim one provider kind and id the host keeps
  the first by plugin id and warns. providers.md shows an example; the
  `experimental_ProviderIcon` resolution order is in frontend-components.md.
