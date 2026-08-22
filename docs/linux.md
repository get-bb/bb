<!-- Diátaxis: how-to -->

# Using bb on Linux

Linux has several valid bb setups. Choose the one that matches what you want
the machine to do; the installers are not interchangeable.

| Goal                                                    | Setup                                                                   | What it installs                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Use bb as a local desktop application                   | [Linux x64 AppImage](#install-the-desktop-appimage)                     | A clickable UI, local bb server, and local host daemon                             |
| Run a local server and use a browser                    | [`npx bb-app@latest`](#run-bb-with-npx)                                 | A local bb server and host daemon; no desktop launcher                             |
| Let an existing remote bb run work on this machine      | [Settings → Machines → Add machine](#add-linux-as-an-execution-machine) | An enrolled host daemon and systemd user service; no bb server or desktop launcher |
| Open an existing remote bb without running work locally | The server's browser URL                                                | A browser control surface only; no local processes                                 |

The distinction matters most for **Add machine**: a successful join means the
machine can execute remote work. It does not install the bb desktop app, add a
launcher, or put `bb` on `PATH`.

## Install the desktop AppImage

The published desktop AppImage targets x64, glibc-based Linux distributions.
Check the architecture first:

```bash
uname -m
```

The AppImage requires `x86_64`. On ARM64 or another architecture, use the npm
launcher or open a remote bb in the browser instead.

1. Download the asset ending in `x86_64.AppImage` from the
   [latest desktop release](https://github.com/get-bb/bb/releases/tag/desktop-latest).
2. Put it in a stable, user-writable directory and make it executable. Keeping
   the file and its parent directory writable also lets bb replace the AppImage
   during an update.

   ```bash
   mkdir -p "$HOME/Applications"
   install -m 755 "$HOME"/Downloads/bb-*-x86_64.AppImage \
     "$HOME/Applications/bb.AppImage"
   "$HOME/Applications/bb.AppImage"
   ```

   If Downloads contains more than one matching release, replace the wildcard
   with the exact filename.

The AppImage bundles the bb runtime, so Node.js is not required to launch the
desktop application itself. Git and at least one authenticated provider CLI
must still be available on the host.

### FUSE errors

AppImages normally use FUSE. Install the FUSE 2 compatibility library if the
AppImage reports that `libfuse.so.2` is missing:

| Distribution            | Package       |
| ----------------------- | ------------- |
| Ubuntu 24.04 and newer  | `libfuse2t64` |
| Ubuntu 22.04 and Debian | `libfuse2`    |
| Fedora                  | `fuse-libs`   |
| Arch Linux              | `fuse2`       |

For example, on Ubuntu 24.04:

```bash
sudo apt update
sudo apt install libfuse2t64
```

Do not remove FUSE 3 to install the compatibility package; the two versions can
coexist. If FUSE cannot be enabled, this fallback confirms whether FUSE is the
only blocker:

```bash
"$HOME/Applications/bb.AppImage" --appimage-extract-and-run
```

Prefer the normal AppImage launch for day-to-day use.

### Add bb to the application menu

Downloading an AppImage does not consistently create a launcher across Linux
desktops. An AppImage integration tool can do this for you. To create a
portable per-user launcher manually:

```bash
app_path="$HOME/Applications/bb.AppImage"
icon_path="$HOME/.local/share/icons/bb.png"
desktop_path="$HOME/.local/share/applications/bb.desktop"

mkdir -p "$(dirname "$icon_path")" "$(dirname "$desktop_path")"
curl -fL https://raw.githubusercontent.com/get-bb/bb/main/apps/desktop/assets/icon.png \
  --output "$icon_path"

cat >"$desktop_path" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=bb
Comment=Agentic IDE
Exec=$app_path
TryExec=$app_path
Icon=$icon_path
Terminal=false
Categories=Development;IDE;
StartupNotify=true
EOF

command -v update-desktop-database >/dev/null && \
  update-desktop-database "$HOME/.local/share/applications"
```

Open the application menu, search for **bb**, and pin it to the dock if wanted.
The launcher points at the stable AppImage path, so versioned downloads do not
leave stale menu entries.

## Run bb with npx

Use this setup for a browser-based local installation, Linux ARM systems, or
servers where a desktop application is not useful. It requires Git, npm, and
Node.js 22.19 or newer; Node.js 22.19, 24, and 26 are tested.

```bash
npx bb-app@latest
```

Open `http://localhost:38886` while the command remains running. This command
starts the server and host daemon, but it does not create an application-menu
entry or a persistent system service. Stop it with `Ctrl+C`, or stop a
background instance with:

```bash
npx bb-app stop
```

See the [`bb-app` package guide](../packages/bb-app/README.md) for npm 12 native
module permissions, provider setup, configuration, and other launch options.

## Add Linux as an execution machine

Use this setup only when a bb server already exists elsewhere and should run
threads on the Linux machine.

Prerequisites:

- Node.js 22.19 or newer and npm
- `curl`
- a systemd user session
- Git and authenticated provider CLIs needed by the work you will dispatch

In the existing bb, open **Settings → Machines → Add machine** and run the
generated command on the Linux host. Generate a fresh command instead of
copying an old one: its join code and bb connect machine code are short-lived
credentials, and they should not be pasted into issues or shared logs.

The installer prints the exact server URL, daemon port, data directory, service
file, and uninstall command when it succeeds. Save that output. On Linux, each
server gets isolated paths similar to:

```text
data     ~/.bb-machines/<server-host>
service  ~/.config/systemd/user/bb-host-daemon-<server-host>.service
```

The daemon starts with the user's systemd session. A headless host that must
start the daemon at boot and keep it running after logout may also need systemd
user lingering enabled:

```bash
sudo loginctl enable-linger "$USER"
```

This changes the lifetime of all that user's systemd services, so enable it
only on a machine where that behavior is wanted.

### Verify the enrolled daemon

Use the exact unit name printed by the installer:

```bash
systemctl --user status bb-host-daemon-<server-host>.service
journalctl --user -u bb-host-daemon-<server-host>.service -n 100 --no-pager
```

The status should be `active (running)`, and the log should report that the host
daemon connected. The machine should also appear online under **Settings →
Machines** on the server.

If systemd reports `status=203/EXEC`, the Node.js executable recorded in the
unit no longer exists. This commonly happens after a version manager removes or
changes the active Node installation. Activate a supported Node version, make
sure `command -v node` resolves to a persistent installation, then generate and
run a fresh Add machine command.

If the machine was previously joined to another local or remote bb, inspect all
bb user services before removing anything:

```bash
systemctl --user list-unit-files 'bb-*'
```

Each enrolled server is intentionally separate. Disable only the stale unit
whose server name and data directory you have verified; do not remove a working
daemon for another server.

### Open the remote UI

Enrollment does not open or install the UI. Open the server URL from the
installer output in a browser. For a clickable browser app, use the browser's
**Install app** or **Create shortcut / Open as window** action while viewing
that URL. The browser profile must be signed in to the bb connect account when
the server uses a `getbb.app` address.

See [Using bb on multiple devices](multiple-devices.md) for the difference
between browser devices, desktop clients, and execution machines.

## Remove or replace a Linux setup

- **AppImage:** quit bb, remove its application-menu entry and AppImage, and
  refresh the desktop database. The local bb data under `~/.bb` is retained.
- **npx:** run `npx bb-app stop`. Its data under `~/.bb` is retained.
- **Enrolled machine:** run the exact `systemctl --user disable --now ...`
  uninstall command printed by the Add machine installer. The isolated data
  directory under `~/.bb-machines` is retained so credentials and logs can be
  inspected or backed up before deletion.

When replacing one setup with another, remove only its launcher and service
first. Delete its data directory later, after the replacement works and you no
longer need its configuration or logs.
