# bb app settings reference

Server-backed preferences in Settings. They are persisted on the server, so
every window and client sees the same value.

## Setting values

- `bb settings general <key> <value>` accepts any key listed under
  `generalSettings` in `bb settings show`. Boolean preferences take `true`,
  `false`, `on`, or `off`; `null` clears a preference that can be unset, such
  as `onboardingCompletedAt`.
- Unknown keys and values of the wrong shape are rejected; the error names the
  keys bb knows.

## Keyboard shortcuts

- `showKeyboardHints` defaults to true. Set it with
  `bb settings keyboard hints <true|false>` to control whether
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

## Unhandled provider events

- `showUnhandledProviderEvents` defaults to false. Set it with
  `bb settings general showUnhandledProviderEvents <true|false>`.
- When enabled, packaged builds show raw provider events that bb has persisted
  but does not yet understand. These diagnostic payloads can be noisy.
- Development builds always show unhandled provider events regardless of the
  saved preference.

## Active-thread Enter behavior

- `steerActiveThreadOnEnter` defaults to false. Set it with
  `bb settings general steerActiveThreadOnEnter <true|false>`.
- Outside an open composer typeahead menu, disabling it makes Enter queue a
  follow-up and Command+Enter steer the active turn. When enabled, those
  actions are reversed.
- Shift+Enter inserts a newline. Zen mode also makes unmodified Enter insert a
  newline. On coarse-pointer touch devices, the software-keyboard Return path
  stays a newline; iPadOS WebKit preserves the Enter shortcuts for a connected
  Magic Keyboard.

## New onboarding

- The `newOnboarding` experiment defaults to false.
- Enable it with `bb settings experiment newOnboarding true`.
- Use `bb settings replay-onboarding` to enable the experiment and show the
  agent and project setup guide again.
