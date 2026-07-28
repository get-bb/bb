# Changelog

## 0.34.0

This release refreshes the model catalogs behind Pi and Claude, gives every provider a way to ask you a multiple-choice question, and lets workflows run without holding up the composer.

### Models

- The Pi provider moves to Pi 0.82. Model resolution, authentication, and catalog refresh now share one runtime, so the picker reflects each model's real reasoning levels — including `max` — and newly published models appear without waiting for a bb release.
- Opus 5 (1M) is available in the curated Claude Code model list.
- bb's curated Claude models are always offered, and the picker preloads so it opens with the list already populated.
- The Claude Code bridge no longer silently drops requests.
- **Node.js 22.19 is now the minimum.** 22.19, 24, and 26 are the tested lines. Node 20 is no longer supported.

### Asking and answering

- New cross-provider Ask User Question plugin (builtin, off by default): agents on Codex, Pi, and Cursor can now ask you a real multiple-choice question with option previews instead of guessing or asking in prose. Claude threads keep using their native tool.
- Threads show the pending-question glyph while their runtime is active, so it is clearer when an agent is waiting on you.

### Workflows and plugins

- Claude workflows run without blocking the composer, and every concurrently running workflow is shown there.
- Hidden workflow completion notifications can be steered.
- New experiment-gated Tools Hub brings Skills, Plugins, and Automations into one place with consistent layouts, detail provenance, and safe registry installs.
- Plugins gained thread panel navigation, lifecycle-managed content scripts, compact plugin-owned icons, and banners that render above queued messages.

### Fixes and polish

- The split workspace layout is scoped to one tab, and split-view maps moved into sidebar status slots.
- The mobile submit tap now lands ahead of keyboard dismissal.
- The served bb-app artifact refreshes after a restart.
- Sidebar rows no longer stay greyed out after a section drag.
- Ordered lists keep their starting number when rendered.
- Skills show as bolt icons in the composer typeahead, and the automations panel regained its page frame.
- Docs YAML frontmatter is only treated as frontmatter when it parses as YAML, so a document opening with a thematic break keeps its first section.
- The project machine picker gates on connected machines rather than every enrollment, so one long-offline machine no longer replaces the native folder picker.
- Thread title generation prompt refined.

## 0.33.0

This release brings updates into one quiet place, simplifies approval settings, and improves reliability across threads and connected machines.

### Clearer updates and approvals

- Permission modes are now clearer approval presets: Accept Edits, Approve for me, and Full Access. Codex and Claude use their native automatic-review behavior while keeping workspace sandboxing in place.
- A quiet Updates badge replaces stacked notifications. Settings → Updates now brings together bb, desktop, connected-machine, Codex, and Claude Code updates, with clearer progress and retry actions.
- Connected machines recover from failed updates faster and can be retried from Settings or with `bb machine retry-update`.

### Experiments

- Try the new Side Chat experiment, rebuilt on bb's plugin system. Side chats are lightweight hidden forks that inherit the source thread's execution settings, can be opened as full threads, and can send useful results back to the main conversation.
- Quiet Workflows workers no longer fail just because they have not produced output; they wait until the overall run timeout, cancellation, or a real failure.

### Fixes and polish

- `bb thread tell` now steers an active turn by default, while `--mode queue` remains available for non-urgent follow-ups.
- Plan and Goal activity are now tracked independently, so either can be stopped without disturbing the other.
- Threads recover cleanly when a previously selected Claude model is no longer available to the signed-in account.
- Active turns are less likely to be interrupted when a connected machine's daemon encounters a lock or update problem.
- Daemons now shut down cleanly after a startup failure instead of leaving a broken process behind.
- Adding a machine now works correctly when bb Connect is not paired.
- Assistant-authored thread mentions render as navigable thread-title pills.
- The model and reasoning picker stays open so both settings can be changed together.
- Removed misleading Codex timeline errors and polished keyboard hints and queued messages.
- Source installs now repair native modules correctly when running on Node.js 26.

## 0.0.31

This release brings split views to everyone and redesigns queued messages in the composer.

### Features

- Split views are now available: arrange up to eight chats side by side, drag threads in from the sidebar, and move between panes with keyboard shortcuts.
- Queued messages in the composer got a redesign: a compact drawer that scales to long queues, with fullscreen editing.

### Improvements

- New compact composer on mobile.
- Sidebar sections are unified and drag-reorderable, with drag-to-pin; archived threads moved into Settings.
- Usage limits now show which account email each provider is signed in with, and Cursor usage limits are now supported.

### Experiments

- New Tasks plugin: Linear-style task tracking with agent dispatch — assign agents to tasks, follow their progress in comments, and attach files and GitHub PRs.
- Official plugins are now bundled with the app and update alongside it.
- New Workflows plugin renders live multi-agent workflow runs in chat, across providers.
- Docs gained table editing, easier file management, and a pull/push-based CLI.

### Fixes and polish

- Fixed Claude model fallbacks not being surfaced immediately.
- Fixed `bb secret request` destinations in multi-machine setups.
- Fixed desktop light/dark switching when following the system theme.
- Fixed scrolling of long agent questions and sidebar safe-area coverage on mobile.
- Fixed a performance issue with animations.
- Improved bb Connect reliability.
- Worktree setup now runs with your resolved shell PATH.

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
