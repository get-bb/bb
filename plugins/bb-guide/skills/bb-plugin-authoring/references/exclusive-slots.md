# Exclusive slots

The composer, thread list, sidebar navigation, diff renderer, source code
renderer and thread header title each show one plugin. File openers (per
extension), code fence renderers (per language) and message directives (per
name) show one plugin per key. Which one wins is a user setting, stored as a
synced UI preference whose value is `<pluginId>/<registrationId>`,
`__automatic__` or `__builtin__` (bb's own view, where bb has one):

| Slot                              | Pick key                                      |
| --------------------------------- | --------------------------------------------- |
| `experimental_composer`           | `composer.provider`                           |
| `experimental_threadList`         | `sidebar.threadListProvider`                  |
| `experimental_sidebarNavigation`  | `sidebar.navigationProvider`                  |
| `experimental_diffRenderer`       | `diff.provider`                               |
| `experimental_sourceCodeRenderer` | `sourceCode.provider`                         |
| `experimental_threadHeaderTitle`  | `threadHeader.titleProvider`                  |
| `fileOpener`                      | `fileOpener.byExtension` (`{ ext: pick }`)    |
| `experimental_codeFenceRenderer`  | `codeFence.byLanguage` (`{ language: pick }`) |
| `messageDirective`                | `messageDirective.byName` (`{ name: pick }`)  |

The user's pick wins while that plugin is installed and enabled. Otherwise
Automatic picks the first plugin the user installed (by plugin id), then
bb's own (bundled or from bb's official marketplace), then bb's built-in view; a map key that is missing means
Automatic. bb's own plugins go through the same rule. While plugins are still
loading, a surface waits for its picked plugin instead of drawing another one.
A crashing composer or thread list is replaced by the bundled one, with a
Reload in the toast; the pick does not change.

A message directive claimed by more than one plugin has no automatic winner:
it shows as text with a Choose link until the user picks, because each
plugin understands only its own directive data.

Users change picks in Settings → Installed plugins → Plugin choices or with
`bb settings ui set <key> <value>` (maps take JSON). Your plugin may write a
pick through `sdk.system.uiPreferences.set`, for example on install or when
the user turns your view on (see backend-ui-lifecycle.md). The user can change
it back at any time. Write only when the current value is `__automatic__` (or
the map has no entry for your key) or the user asked for it, pass
`expectedRevision`, and treat a key missing from `list()` as unavailable
rather than reading `.revision` off it.
