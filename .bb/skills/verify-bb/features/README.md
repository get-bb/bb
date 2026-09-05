# BB verification feature map

| Feature                                 | User journey                                                      | Prerequisite                                        |
| --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| [Local project](local-project.md)       | Add a local Git folder and select it for a new conversation       | Connected local daemon; synthetic folder            |
| [Thread lifecycle](thread-lifecycle.md) | Send a prompt, receive a response, rename, archive, and unarchive | Local project; installed and authenticated provider |
| [Appearance](appearance.md)             | Change theme and palette, reload, and restore                     | Fresh browser profile and isolated server           |
| [Compact menu](compact-menu.md)         | Open, use, close, and reopen the compact Theme drawer             | Appearance route; narrow touch viewport             |

Run local-project before thread-lifecycle. Appearance and compact-menu can run
without an authenticated provider. Each file names the source that owns its
behavior and the observations needed for a live pass.

This is a starter map, not complete BB coverage. It excludes steering and
cancellation, host disconnect/reconnect, remote enrollment and Connect,
notifications, plugin install/update, worktree creation, terminal interaction,
native desktop behavior, performance budgets, and Safari/iOS. Those require
their own fixtures and recipes. Chromium mobile emulation proves neither
WebKit behavior nor iOS animation performance.

The tested source revision and live coverage are recorded in
[the validation summary](../VALIDATION.md). Re-run affected recipes on the
current revision; an old pass is not current evidence.
