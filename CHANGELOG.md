# Changelog

## 0.36.0

A faster web app, a more reliable terminal, steadier model catalogs, and a long list of fixes.

### The server now default binds to loopback

The server used to listen on every network interface, which exposed its unauthenticated API to any host that could reach the machine. It now binds `127.0.0.1`. Use `--server-bind-host 0.0.0.0` or `BB_SERVER_BIND_HOST` to opt back in, only behind a trusted network boundary.

- **Action needed before you upgrade** if a browser or an enrolled machine reaches bb at a direct address such as `http://<LAN-IP>:38886` or `http://<machine>.<tailnet>.ts.net:38886`. Move the route first, then upgrade. This release also raises the host daemon protocol, so every enrolled daemon must update itself — and a daemon that lost its route cannot.
- Move to bb connect, or put bb behind Tailscale Serve, then remove and re-add each machine in Settings → Machines so its installer records the new route. Setup steps: https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md
- The desktop app, the `bb` CLI, agents, plugins, and the host daemon on the same machine reach the server over loopback. They need no change.

### Machines and threads

- An enrolled host daemon no longer collides with another daemon over its local API port.
- Background tasks survive a daemon reconnect.
- Provider subscription rate limits now retry instead of failing the turn.
- New threads pick up the connected provider defaults. A thread that names no model now resolves one from the provider catalog on the target host, instead of a hard-coded default. The thread fails to start when that host cannot list models.
- Provider usage limits normalize correctly.

### Pi and ACP

- A broken extension no longer empties the Pi model list.
- A bare Pi model name resolves through the sole authenticated provider.
- An aggregator model ID keeps its provider prefix.
- The bundled runtime loads your own Pi configuration.
- ACP plugin tools work in packaged Electron builds.
- An ACP agent may send a null model or config-option string without breaking the session.

### Models

- Codex re-reads its model list after a CLI update, and it finds project skills again.
- Voice transcription moves to GPT Transcribe. Helper inference moves to GPT-5.6 Luna.

### Performance

- The web app boot payload is 60% smaller.
- The built-in terminal is more reliable, replays faster over a remote connection, and the terminal panel loads faster.

### Plugins and extensions

- Official plugins now live with the rest of the plugins in one place.
- Plugin installs report progress, the build toolchain downloads on demand, and git plugin dependencies install before bundling.
- Plugin SDK type declarations stay current, so agents read the declarations instead of the bundles.
- Browse is the default Extensions tab.
- Interactive plugin tools stay alive past the Connect timeout.
- The GitHub plugin syncs pull requests for repositories with Issues disabled, finds pull requests on fork branches, renders GFM tables in descriptions, and refreshes status when a turn completes.

### Fixes and polish

- New keyboard shortcuts cycle the model and the reasoning level.
- A `.worktreeinclude` file controls what a new worktree copies in.
- Sandbox network permission prompts are grantable.
- App shortcuts and Escape work in the chat input, and sidebar search resets after you open a thread.
- Cmd+W no longer crashes the About window.
- Git status is correct for a newly initialized repository, and a workspace path claim is scoped to its project.
- Long filenames fit in the Add Project dialog, tab overflow controls are back, and right panel resize is less sensitive.
- File links work in side chat timelines.
- The mobile PWA shell tracks the iOS keyboard, and mobile voice recording controls work again.
- bb connect relays DELETE request bodies.
- First-run onboarding is behind an experiment while it settles.
- New `pnpm dev:status` command for source development.

### Thanks

Much of this release came from outside the core team. Thank you:

- **@ben-vargas** reported the wildcard bind and shipped the loopback default, the `BB_SERVER_BIND_HOST` setting, and its migration guide.
- **@Diffuzmetall** made the built-in terminal more reliable and much faster to replay over a remote connection.
- **@kschrader** fixed GitHub pull request sync for a repository with Issues disabled.
- **@toasterman234** helped cut the web app boot payload by 60%.

## 0.35.0

Plugins ship in this release, enabled by default. Much of bb is already built with them — and an agent inside bb can now write one for you.

### Plugins

- **Plugins leave experiments and are on by default.** Browse and install them in Settings → Plugins, from the store or from a git URL, an npm package, or a local path.
- **bb can extend itself.** A built-in plugin-authoring skill and the `bb plugin` commands let an agent in a thread scaffold, build, install, and reload a plugin without leaving the conversation. Ask bb for something it does not do, and it can write the plugin that does it.
- A plugin can add agent tools and skills, a `bb` CLI subcommand, sidebar pages and panels, homepage and settings sections, thread header controls, message actions, @-mention providers, background services and scheduled jobs, HTTP and RPC endpoints with realtime push, and its own SQLite storage. New this release: a plugin can render bb's full new-thread composer, and it can **replace the sidebar thread list** outright.
- **Much of bb is already a plugin.** Automations, Side chat, bb connect, Custom instructions, Inline visualizations, and Secrets ship built-in and enabled. Workflows and Ask User Question ship built-in and off by default. GitHub, Docs, Memory, and Tasks install from the store.
- Side chat is now entirely the plugin. Existing side chats migrate over and gain their own permission mode and worktree.
- Plugin pages sit in flat sidebar rows you can reorder or hide, and **Automations** is now separate from **Extensions**, which manages Skills and Plugins.

### A permission limit for every machine

- Each machine now carries a **permission limit** — the highest permission mode any thread on it may run with. A sandbox VM can stay at Full Access while a personal laptop stays lower. Every machine ships at Full Access, so nothing changes until an owner lowers one.
- Only an owner can change a limit, from the new per-machine page. Agents can read the limit but can never raise it. The same page collects that machine's projects, provider versions, update status, rename, and remove.

### Performance

Long thread timelines no longer stall while scrolling, streaming stays stable and unclipped inside a long turn, and threads load faster over bb connect.

### Nightly builds

- New automated nightly channel. Install `bb-app@nightly`, or the separate **bb Nightly** desktop app, which sits beside stable bb and updates from its own feed. A nightly build never moves a stable release pointer.

### Fixes and polish

- The iOS standalone PWA fills the screen again, instead of leaving a dead band at the bottom and pushing content under the status bar.
- Browser tab shortcuts are preserved on web: `Mod+number` stays with the browser, and bb uses `Control+number` on macOS and `Ctrl+Shift+number` on Windows and Linux. Desktop is unchanged.
- A host daemon that fails to shut down now force-exits after 15 seconds so the service manager can restart it. This frees machines that stranded on an old protocol version after a self-update.
- The desktop app asks before it attaches to a bb that is already running, and it can stop that copy for you. `npx bb-app stop` gives agents the same ability.
- Settings → Updates is redesigned around a quieter hierarchy, and updates keep running when you navigate off the page.
- The New thread surface sits flush with the window edges.
- The mobile landing page header no longer overflows.
- Sticky launcher headers, the thread detail header separator, and keyboard shortcut pills line up.

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
