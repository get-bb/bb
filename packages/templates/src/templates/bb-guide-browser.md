# Built-in browser automation

`bb browser` is the experimental core API for automation integrations controlling BB desktop tabs. The Browser Automation plugin adds its own script/session commands; another plugin can use the same core connection independently.

`bb browser-automation open --machine <name-or-id>` accepts an exact host ID or an unambiguous machine name. Exact IDs take precedence; unknown or ambiguous names fail before session creation. Use `--backend local --headless` for headless sessions or `--backend desktop --desktop <instance-id>` for a desktop session.

Start with `bb browser instances --host <host-id> --json`. For every tab/control operation provide `--host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id>`. The browser host can differ from the agent host. Never infer an active desktop window.

- `tabs`: list native tabs and their control state.
- `create [--url <http(s)-url>] [--reveal]`: create a tab with a separate automation profile. Defaults: hidden, about:blank.
- `acquire <tab-ids...> --controller <label> [--ttl-ms <ms>] [--allow-personal]`: acquire exclusive tab control. If the owning thread is already focused, open the side panel and select the first tab. New or activated CDP tabs follow the same rule. No thread switching or desktop window activation. Default expiry is five minutes, maximum thirty minutes. Personal tabs require the explicit handoff flag and carry their profile's authenticated authority.
- `connection <lease-id> --output <new-file>`: write private connection JSON with mode 0600 on the CLI host. The loopback WebSocket endpoint is usable only on the browser host. Pass it privately to an integration worker; never expose it through a shared port or chat output.
- `release <lease-id>`: revoke automation while keeping tabs open.
- `reveal <tab-id>`: open the side panel and select the existing native tab only if its thread is already focused; otherwise leave the current view unchanged.
- `capture <tab-id> --output <new-file>`: save a bounded JPEG to the CLI host without focusing the tab.
- `close <tab-id>`: explicitly close that native tab.
- `watch`: print changed tab snapshots every two seconds until interrupted. Disconnects report errors; this is not a lossless event log.

Cookie import copies signed-in sessions from a browser installed on the desktop host into a BB browser profile. These two commands take `--host`, `--instance`, and `--generation` but no `--thread`:

- `import-sources`: combine known-browser entries (Chrome, Chromium, Helium (macOS), Edge, Brave, Vivaldi, Opera, Arc (macOS), Dia (macOS), Firefox, Zen, Safari (macOS)) with automatically detected Chromium/Firefox cookie stores, their profiles with cookie counts, and why one is unavailable (`notInstalled`, `browserRunning`, `needsFullDiskAccess`, `needsKeychainApproval`, `unsupportedPlatform`).
- `import-cookies --from <source-id> --profile <directory> [--into personal|automation:<profile-id>]`: read that profile's cookie store and write it into the personal BB browser (default) or a named automation profile. The source browser must be quit first. macOS prompts for Keychain access for Chromium browsers and needs Full Disk Access for Safari. The result reports imported and skipped counts plus skipped hosts; `ok: false` carries a reason. A one-time copy, never a sync; partitioned cookies and non-default Firefox containers are skipped. Desktop only (macOS and Linux). Use the exact source ID returned by `import-sources`; additional stores have stable opaque `storage-…` IDs.

Discovery checks cookie database schemas in macOS Application Support, Linux configuration directories (honoring an absolute `XDG_CONFIG_HOME`), hidden home directories, and Flatpak/Snap data directories. Known entries take precedence and retain browser-specific encryption settings; canonical database paths deduplicate additional stores. Discovery does not read encryption secrets. Unknown sources must match a browser application registered for HTTP and HTTPS (and the WebBrowser category on Linux); cookie databases belonging to other applications are excluded. Names are matched against macOS bundle metadata or Linux desktop-entry metadata. Standard user/system application directories and Flatpak/Snap desktop exports are checked. Known-browser entries remain available if application registration is missing. Additional profiles are labeled with their detected storage family.

Scanning is bounded (2,000 directories, 100 additional stores, 100 profiles per store; three directory levels in standard locations and five inside Flatpak/Snap data). BB's own desktop profile is excluded. Arbitrary custom locations, other cookie formats, and custom encryption are not universally supported. Additional Chromium stores use matching known encryption metadata when available, otherwise the directory name with the conventional macOS `<name> Safe Storage` / `<name>` Keychain identity or Linux keyring application name. A missing key reports an import failure; unsupported versioned encryption is skipped. Refresh rescans, and import resolves discovered IDs again before reading a selected profile.

All commands support JSON output. In plugin code use `bb.sdk.experimental_desktopBrowsers`; the Plugin Guide documents the typed surface. Stop/Take over revokes native control; stopping the owning thread also releases its server control leases. Old connection generations cannot control replacement windows.

Cloud browsers are not supported. Headless Chrome on an enrolled host belongs to the Browser Automation plugin.
