# Assumptions — bb wn

Values assumed without asking, as instructed. Each is reversible, and this file
records where to change it.

| # | Assumption | Value | Where to change |
|---|---|---|---|
| A1 | Product name | `bb wn` | Windows override in `run-electron-builder.mjs` |
| A2 | Application id | `cl.bb.wn` | same |
| A3 | Data directory | `%APPDATA%/bb` | host-daemon path resolution |
| A4 | Code signing | `sign:false` | no certificate available; see K1 |
| A5 | Default shell | `powershell.exe -NoLogo -NoProfile` | `resolveDefaultTerminalShell()` |
| A6 | Test directory | `C:\bb-test` | `qa/CHECKLIST-WIN11.md` |
| A7 | Architecture | x64 only | electron-builder target |
| A8 | Installer | per-user NSIS (`perMachine: false`) | `nsis` block |
| A9 | Release version | `v1.0.0-win` | release tag |
| A10 | Fork account | `zqkra` | `fork` remote |

## Why `-NoProfile` (A5)

Not an oversight. A user's PowerShell profile can print banners, change the
encoding, or alter `PATH`, which makes terminal output non-deterministic and
tests flaky. Honouring the user profile should be an explicit option, never the
default.

Note the deliberate asymmetry: the **runtime environment probe** does *not* pass
`-NoProfile`, mirroring the `-ilc` behaviour of the POSIX path, and tolerates
profile noise through marker-delimited parsing.

## Why a per-user installer (A8)

`perMachine: false` installs without a UAC prompt. A per-machine installer
requires elevation, which is friction without benefit for a first downloadable
build.

## Assumptions deliberately **not** made

- **Not assumed that `%APPDATA%` is writable or present.** The code must degrade
  with a readable error rather than crash.
- **Not assumed parity with `/proc`.** Windows does not cheaply expose a
  process's working directory; pretending otherwise was explicitly forbidden, and
  the partiality is declared in the type (`approximateCwd`).
- **Not assumed symlinks work.** They require privilege or Developer Mode on
  Windows; directory junctions do not. Flagged as a risk rather than relied upon.
