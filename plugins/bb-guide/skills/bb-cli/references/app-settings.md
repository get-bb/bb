# bb app settings reference

Server-backed preferences in Settings. They are persisted on the server, so
every window and client sees the same value.

## Setting values

- `bb settings general <key> <value>` accepts any key listed under
  `generalSettings` in `bb settings show`. Boolean preferences take `true`,
  `false`, `on`, or `off`; `null` clears a preference that can be unset.
- Unknown keys and values of the wrong shape are rejected; the error names the
  keys bb knows.

## Sidebar preferences

The sidebar thread list defaults to `__automatic__`: the first installed thread list
plugin other than the bundled Thread list plugin (`thread-list/thread-list`), or the
bundled plugin when there is none. Installing a thread list plugin therefore switches
to it. Legacy `__builtin__` selections resolve to the bundled plugin; other plugin
selections are preserved.
Use `bb settings ui reset sidebar.threadListProvider` to restore Automatic, or
`bb settings ui set sidebar.threadListProvider <plugin-id>/<slot-id>` to select
another plugin. The SDK exposes the same setting through `uiPreferences`.

The sidebar navigation works the same way: `sidebar.navigationProvider` defaults
to `__automatic__`, which prefers an installed navigation plugin over the bundled
Navigation plugin (`navigation/navigation`), and legacy `__builtin__` selections
resolve to the bundled plugin. Navigation order and
visibility stay in `sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`,
so they carry over between navigation plugins.

- The server keeps a keyed, revisioned registry of sidebar layout preferences
  (`sidebar.organizationMode`, `sidebar.threadGrouping.environment`,
  `sidebar.chronologicalSort`, the section
  orders, the collapsed-id lists, `sidebar.hiddenGroups`,
  `sidebar.pluginPanelOrder`, `sidebar.visiblePluginPanels`, `sidebar.navigationProvider`,
  `sidebar.headerProvider`, `sidebar.threadListProvider`).
- The built-in sidebar's Filter selects Active and Archived, defaulting to Active,
  including threads with saved messages. This selection is browser-local, not
  a server-backed preference or SDK/CLI setting. Selected archived rows
  retain their hierarchy placement and offer a restore action. Archived pages load only while selected;
  plugin sidebar replacements keep ownership of their rendering.
- The palette's Filter selects Active and Archived independently of the
  sidebar, defaulting to Active. This selection is browser-local, not configurable
  through SDK/CLI. Active includes threads with saved messages; Search threads
  retains existing title and conversation matching. Archived recents load only while selected and are
  bounded at the server.
- `sidebar.organizationMode` defaults to Custom (`chronological`) on new installs.
  Migrated installs with existing projects, threads, or UI preferences fall back to
  By project (`project`). Saved server choices win over legacy browser choices,
  which win over the installation fallback. Reset saves that fallback explicitly.
- `sidebar.threadGrouping.environment` decides whether sibling threads sharing
  one worktree environment collapse into a single worktree row inside their
  section: `true` groups them and `false` keeps every thread on its own row, in
  every organization mode. The default `auto` groups them in By project and By
  machine and leaves them flat in Custom. Set it through Organize → Groups →
  By environment, settings, or the CLI. Each `sidebar.threadGrouping.*` key
  toggles one grouping dimension independently.
- `bb settings ui list [--json]` prints every key with its value, revision,
  and description; `bb settings ui get <key> [--json]` prints one.
- `bb settings ui set <key> <value> [--json]` takes a plain string for enum
  and provider keys and JSON for lists or `null`; it reads the current
  revision, writes with it, and retries once on a conflict.
- `bb settings ui reset <key> [--json]` writes the default and advances the
  revision.

### Thread-list visibility

- The bundled Thread list plugin owns its layout preferences, including hidden
  groups. Use `bb thread-list prefs list [--json]` to inspect them and
  `bb thread-list prefs get/set/reset <key>` to change them.
- Its installed `thread-list` skill documents accepted keys and values. Keep
  plugin-specific settings out of `bb settings ui`; those legacy values are
  read only during one-time migration.

## Keyboard shortcuts

- `showKeyboardHints` defaults to true. Set it with
  `bb settings keyboard hints <true|false|on|off>` to control whether
  delayed shortcut badges appear while holding Command or Control. It does not
  disable the shortcuts themselves.
- Settings → Keyboard records sparse per-command chord overrides. `Mod` means
  Command on macOS and Control on Windows/Linux.
- Reset removes the override and follows bb's current default. Clear stores an
  explicit disabled value.
- Bindings for non-native actions apply in browser and desktop clients. Command
  contexts and native-only availability remain server-owned. Reusing a chord
  can be intentional when contexts do not overlap; the UI identifies reuse.
- New Thread, New Window, New Tab, Close, and Settings in the desktop menu use
  the same resolved shortcuts as renderer commands.
- The complete default table is in `docs/configuration.md` in the bb source
  repository.

## Diagnostic events

- `showDiagnosticEvents` defaults to false in all builds. Set it with
  `bb settings general showDiagnosticEvents <true|false|on|off>`.
- Enables provider environment resolution and unhandled provider events in the
  timeline. Warnings, errors, and model fallback stay visible regardless.
- Existing unhandled-provider-events preferences carry over to this setting.

## Active-thread Enter behavior

- `steerActiveThreadOnEnter` defaults to true for a new install. An earlier
  install with saved settings or work keeps false. Set it with
  `bb settings general steerActiveThreadOnEnter <true|false|on|off>`.
- Outside an open composer typeahead menu, disabling it makes Enter queue a
  follow-up and Command+Enter steer the active turn. When enabled, those
  actions are reversed.
- Shift+Enter inserts a newline. On coarse-pointer touch devices, the
  software-keyboard Return path stays a newline; iPadOS WebKit preserves the
  Enter shortcuts for a connected Magic Keyboard.

## Streamer mode

- `streamerMode` defaults to false. Set it with
  `bb settings general streamerMode <true|false|on|off>`.
- When enabled, every `customModels` entry from `~/.bb/config.json` is hidden
  in all model lists: the pickers, `bb provider models`, and
  `sdk.providers.models`. Use it during a screen share so a private or
  early-access model id does not appear.
- The entries stay in `config.json`. A thread request that names a hidden model
  explicitly still runs with it, and default model resolution for a new thread
  keeps the full list.
- A composer whose stored selection is a hidden model falls back to the
  provider default, and the next send records that default. Select the custom
  model again after you turn streamer mode off.

## New branch prefix

- `managedBranchPrefix` defaults to `bb/`. Set it with
  `bb settings general managedBranchPrefix <prefix>`.
- bb puts the prefix in front of every branch name it creates for a managed
  worktree or a new checkout branch, so the default gives
  `bb/fix-login-flow-thr_ab12cd34ef`.
- A prefix does not need a trailing slash. `sawyer/wt-` gives
  `sawyer/wt-fix-login-flow-thr_ab12cd34ef`, and an empty prefix gives
  `fix-login-flow-thr_ab12cd34ef`.
- bb rejects a prefix that cannot start a valid git branch name, such as one
  with a space or a leading `-`. The maximum length is 64 characters.
- The new prefix applies to branches bb creates after the change. It does not
  rename an existing branch or worktree.

## Provider order and default

- `providerOrder` defaults to `[]`. Set it to a JSON array of provider IDs.
- `defaultProviderId` defaults to `null`. Set a provider ID or use `null` to
  clear it.

## Finished turns

- When a turn finishes, bb can collapse its work into one `Worked for` row
  and leave the final answer visible (`collapse`), or keep every step visible
  (`flat`). Each provider declares a default: Claude Code is `flat`; every
  other first-party provider is `collapse`.
- `bb settings completed-turns [--json]` lists every provider with its current
  display and whether it comes from your setting or the provider default.
- `bb settings completed-turns <provider-id> <collapse|flat|default>` sets the
  display for one provider; `default` removes your setting so the provider
  default applies again. Settings → Providers has the same switch per
  provider.
- The overrides are stored in `providerCompletedTurnDisplay`, a map of provider
  ID to `collapse` or `flat`. The setting applies to every thread of that
  provider, including finished turns in existing threads, the conversation
  outline, and `bb thread log`.

## Message edits

- Eligible accepted root user messages can be edited without enabling an
  experiment. Use `bb thread edit-message` or the message editor in the app.

## Provider session release

- BB releases restorable provider sessions after 30 idle minutes.
- Active turns, commands, agents, workflows, and monitors keep sessions loaded.

## Mobile app

- The `mobileApp` experiment defaults to false while the bb mobile app is in
  early access.
- Enable it with `bb settings experiment mobileApp true`. It shows the
  **Add mobile device** card under Settings → Remote access.

## Changelog preview

- The `changelogPreview` experiment defaults to false.
- Enable it with `bb settings experiment changelogPreview true` to show the
  latest release notes on Settings → Updates.

## Legacy plugin loader

- The `legacyJitiPluginLoader` experiment defaults to false.
- Enable it with `bb settings experiment legacyJitiPluginLoader true`.
- Running plugins are unchanged when it is toggled. The selected loader applies
  the next time a plugin is installed, reloaded, enabled, updated, or loaded
  after a server restart.

## Sidebar progressive disclosure

- The `sidebarProgressiveDisclosure` experiment defaults to false.
- Enable it with `bb settings experiment sidebarProgressiveDisclosure true`.
- In **By project** and **By machine**, it shows the first five groups in the
  current sort order, keeps attention groups visible, and reveals ten more per
  **Show more** click. Revealed groups stay visible through activity and
  sort-order changes. **Manually** is unchanged.

## Timeline windowing

- Long timelines keep stable row wrappers while mounting only rows near the
  active main or nested detail scrollport.

## Server move

- The `serverMove` experiment defaults to false.
- Enable it with `bb settings experiment serverMove true`.
- It shows Move server here in Settings → Machines and lets the server run
  `bb server move`, `bb server export`, and old server copy deletion.

Machine access: `bb settings general machineServerUrl https://bb.example.com`
sets the server URL reachable by machines. Set `null` to use BB_EXTERNAL_URL.
`bb settings general defaultMachineAccess direct` selects direct access;
`connect` selects bb Cloud; `null` selects the first registered access provider,
or direct when none is registered. An unpaired provider remains selected and
reports setup required. `bb settings show --json` includes serverAccess with the
effective direct URL, its source and provider availability. Availability is refreshed
on each read, with failed or timed-out checks reported as unavailable. It does
not acquire a machine grant. These grants carry runtime
requests, including account-pool traffic, after enrolment.

Automatic machine GitHub credentials are enabled by default. Use
`bb settings general machineGitCredentialsEnabled false` to stop forwarding the
server gh credentials to machines; `true` enables them again. In Machines →
Advanced settings, the automatic GH_TOKEN switch controls the same setting.
This does not log the server out or suppress an explicit custom GH_TOKEN.
Changes apply to new turns, setup commands and terminals.

Sidebar footer actions use `sidebar.footerOrder` and `sidebar.hiddenFooterItems`.
Both are string lists shared across clients. Keys are `builtin:settings`,
`builtin:report-bug`, or `plugin:<encoded pluginId>/<encoded registrationId>`.
More is always available and holds hidden actions and actions that do not fit
the current width, without changing saved visibility. More → Customize footer
shows every footer icon with a minus (hide) or plus (show) badge; drag to
reorder. More → Hide footer hides every action, and Show footer restores them.
Right-click an action for Hide from footer or Customize footer.
Settings → Appearance → Sidebar footer edits the same preferences. CLI example:
`bb settings ui set sidebar.hiddenFooterItems '["plugin:provider-usage/usage"]'`.
Use `bb settings ui reset sidebar.hiddenFooterItems` to show everything again.

Disable anonymous usage telemetry with `bb settings general telemetryEnabled false`
or Settings → General → Privacy & diagnostics → Share anonymous usage data. This server-wide preference
applies immediately and persists across restarts. `BB_TELEMETRY=false` overrides it.
