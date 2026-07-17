# Changelog

## 0.0.31

Splits headline this release: split views graduate out of experiments for everyone, with twice the pane capacity, per-pane maximize, and a smarter side panel. Queued messages, sidebar organization, and model-fallback visibility also got significant upgrades.

### Splits, out of experiments

- Split views are now on for everyone — no experiment toggle needed. Arrange multiple chats side by side by dragging threads from the sidebar, then resize, rearrange, and move between panes with keyboard shortcuts.
- Splits now hold up to eight panes, up from four, with focus shortcuts for panes 5–8 and smarter layout balancing as you add panes.
- Maximize a single pane and restore the full layout with Mod+Shift+E, the pane header control, or `bb thread pane maximize|restore|toggle` from the CLI and SDK.
- The right panel (diffs, previews, terminals) now lives at the window level: it follows the focused pane and stays open as you move between panes and threads.
- Sidebar actions show a split preview, so you can see where a thread or new chat will open before you click.
- Keyboard commands like focus composer and toggle model picker now act on the focused pane instead of an arbitrary one.
- Polish throughout: precise divider hit testing, smoother resizing, no more stuck sidebar state after dragging a thread into a split, window dragging confined to the top row, correct macOS traffic-light spacing, and refined pane header and focused-pane styling.

### Queued messages and the composer

- Queued follow-ups now live in a compact drawer that scales to long queues, with drag-to-resize and a fullscreen editing mode; editing a queued message keeps its position, grouping, and execution options.
- Queued message actions — send now, edit, delete — are now icon buttons on desktop.
- Agent messages have a consistent action row: Copy, Add to chat, Reply in side chat, and Fork, with Add to chat inserting the response into your current draft.
- Thread mentions render as live pills that follow renames across timelines, thread headers, and the sidebar.
- Prompt attachments are preserved when switching projects.

### Sidebar and navigation

- Top-level sidebar sections (Pinned, your sections, Threads) are unified and drag-reorderable, and you can now pin or unpin a thread by dragging it.
- Archived threads moved out of the sidebar into Settings.
- The Threads sidebar header is unified across organization modes, and the manual sort option is now called Manually.

### Models and providers

- When Claude falls back to another model, bb shows it immediately with a dismissible banner above the composer and updates the model picker to the active model.
- Usage limits now show which account email each provider is signed in with, and Cursor usage limits are now supported.
- Thread creation no longer fails on providers that are slow to start.

### Other improvements

- `bb secret request` can now write credentials to any destination on the thread's host, and the secure form shows the resolved absolute path before you approve.
- The SDK now includes the personal project in project listings and emits a curated `thread.active` lifecycle event.
- The bb website has a new changelog page, with the latest release highlighted on the homepage.

### Fixes and polish

- Fixed desktop light/dark switching when following the system theme.
- Fixed scrolling of long agent questions and sidebar safe-area coverage on mobile.
- Fixed a render loop in collapsed thread previews and paused animations during collapse transitions for smoother sidebars.
- Worktree setup now runs with your resolved shell PATH.
- Development builds no longer send telemetry.
- bb Connect no longer proxies requests through a dead tunnel socket.
- Removed the popout chat experiment, superseded by splits.

## 0.0.30

This release introduces multi-machine workflows and bb Connect, adds more ways to customize how bb works, and gives you clearer visibility into what agents are doing.

### Work across threads and machines

- Multi-machine support lets you add computers to bb and choose which machine runs each task.
- bb Connect lets you securely access bb from other devices and share previews or local servers from any enrolled machine.

### New features

- Custom instructions now have a dedicated Settings editor and are automatically included in future agent turns.
- Agents can securely request API keys and other credentials without exposing their values in the conversation or transcript.

### Faster navigation and more control

- Customize, disable, or reset keyboard shortcuts from Settings → Keyboard.
- Shortcut hints appear contextually and can be delayed or hidden entirely.
- Sidebar organization and sorting now live in one streamlined display menu, including a new By machine view when multi-machine mode is enabled.
- Thread groups are now called Sections consistently across the app, CLI, and SDK; existing group assignments and sidebar preferences migrate automatically.
- Provider settings can disable native Codex or Claude Code subagents, along with Claude Code's Workflow tool.

### Clearer agent activity

- Codex subagents now appear as nested delegations, and Claude Code child threads remain visibly active while their subagents run.
- Background command activity is shown directly in the sidebar.
- Skills and slash-command autocomplete are more consistent across local and remote sessions.

### Experiments

- Split views let you arrange up to four chats in one workspace. Drag threads from the sidebar, resize and rearrange panes, or use keyboard shortcuts to move between them.
- The new plugin ecosystem includes the BB Official catalog, compatibility-aware updates, richer chat and panel experiences, plugin themes, and consistent icons throughout bb.
- Install Docs for filesystem-backed documents with folders, images, Markdown editing, and HTML previews in an editable side panel.
- Install Memory to carry durable global or project-specific context across Codex and Claude Code.

### Fixes and polish

- Fixed microphone input in signed macOS desktop builds.
- Fixed app and Settings navigation resetting as you move between pages and threads.
- Fixed subagent token usage inflating the parent thread's context report.
- Local images now render in assistant Markdown, queued prompts preserve formatting, and file previews refresh reliably.
- Improved narrow and short thread layouts, including the composer, Docs sidebar, split indicators, and inactive-pane contrast.
- Sped up production startup when running bb from source.
- Refined plugin icons, theme behavior, menu alignment, and sidebar drag interactions throughout the app.

## 0.0.29

This release expands agent and model support, introduces a redesigned Settings experience, and includes workflow improvements and reliability fixes across bb.

### More agents, models, and skills

- Added support for Grok Build and Hermes Agent.
- Codex now supports 5.6-Sol, Terra, and Luna.
- Skills and `/` autocomplete now work across Pi and ACP providers, including OpenCode, omp, Grok, Hermes, Cursor, and custom ACP agents.
- Side chats can now use a different model, reasoning level, or service tier while remaining safely read-only.

### Redesigned Settings

- Settings now uses dedicated pages with sidebar navigation.
- Choose which microphone bb uses for voice input.
- Manually check for updates from Settings → Updates.
- On macOS, enable Caffeinate to keep the machine awake while bb is running.
- Discord and GitHub links now live under Settings → Community.

### Workflow improvements

- Right-click local file links to open them in a specific editor, choose a preview, or copy the file name or path.
- Queued messages now render mention pills correctly.
- `bb thread archive` now also archives child threads and side chats.
- `bb thread wait` now waits up to 20 minutes by default, better matching real agent workloads.
- Agent shells more reliably use the correct workspace-managed `bb` CLI.

### Fixes and polish

- Fixed the app becoming unresponsive after creating, renaming, or removing a section from a sidebar menu.
- Fixed manually marked unread threads remaining unread after reopening.
- Fixed sidebar alignment in macOS fullscreen mode.
- Fixed clipped focus rings in the composer toolbar.
- Simplified thread-row cursors and removed the terminal-count badge from the right-panel toggle.
- Renamed the sidebar feedback action to “Report a bug.”

### Experiments

New experiment to let you connect to bb from other computers.
