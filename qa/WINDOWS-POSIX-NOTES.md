# POSIX assumptions in `tests/**` that would fail on the Windows runner

Review requested by S8. Status: **reviewed on Linux, not tested on Windows**.
Each finding says whether it was fixed here (my files: `tests/**`) or needs
coordination (product behaviour or another team's files). The applied fixes do
not change behaviour on Linux: verified with the `@bb/qa` suite and the
`@bb/integration-tests` typecheck.

## Fixed here

- `tests/qa/scripts/run-root-command.mjs` — `run()` launched `pnpm`/`turbo`
  with `shell: false`. On Windows `pnpm` is a `pnpm.cmd` shim and spawn
  without a shell fails with ENOENT, so `standalone:start|stop|cleanup` never
  started. Now `shell: process.platform === "win32"` (identical to before on
  Linux). The `ps -o ppid=` in `readParentPid` already degraded fine without
  `ps` (falls back to `process.ppid`); untouched.
- `tests/integration/vitest.config.ts:13` — hardcoded
  `BB_DATA_DIR: "/tmp/bb-integration-test"`. On Windows `/tmp/...` hangs off
  the current drive root and is not the user's temp dir. Now
  `path.join(tmpdir(), "bb-integration-test")` (on this Linux `tmpdir()` is
  `/tmp`: identical).
- `tests/qa/test/spawn-logged-process.test.ts` — `/tmp/standalone-server-data`
  and `/tmp/standalone-server.log` labels passed as `dataDir`/`logPath`. Now
  under `tmpdir()`. On Linux the value is the same; on Windows they no longer
  point at the drive root.
- `tests/qa/test/standalone-restart-command.test.ts` — the 4 tests running
  `sh -c` (`runShellCommand`, `runRestartProviderEnvBlock`, real daemon
  detaches) cannot pass on Windows: no `sh`, no `kill`, and none of the
  `curl | jq` block the generated command assumes. Marked
  `it.runIf(process.platform !== "win32")`: they run as before on Linux and
  skip on Windows instead of breaking the suite. The generated POSIX command
  is still covered by the string tests, which are portable.
- `tests/qa/test/standalone-restart-command.test.ts` — `/tmp/bb root`,
  `/tmp/bb logs/...`, `/tmp/bb-restart.pid` paths used as input and as
  expected substrings. Now under `tmpdir()` with the same basename (the space
  is kept on purpose: it covers the quoting).

## Reviewed, no bug (do not touch)

- `tests/qa/src/shared.ts` (`loadDotEnv`) — splits on `split("\n")`, but key
  and value come from a line already passed through `trim()`, which eats the
  `\r`. A CRLF `.env` (Notepad) parses fine. No change.
- `tests/qa/src/shared.ts` (`listStandaloneProcesses`, `listOpenFilePids`) and
  `tests/integration/global-setup.ts` (`listOpenFilePids`) — split `ps`/`lsof`
  output on `"\n"`. On Windows those binaries do not exist and both functions
  already return `[]`/`""` on `ENOENT`, so the `\n` never meets a CRLF. The
  real problem is a different one (next section), not the line ending.
- Record writer/reader of scripted-echo (`provider-bridge.ts:recordRequest`,
  `helpers/scripted-echo.ts:33`, `runtime-test-harness.ts:read`) — the writer
  appends an explicit `\n` with `appendFileSync` (Node does no EOL
  translation) and `* text=auto eol=lf` stops git from converting the
  `.jsonl`. Symmetric on Windows. No change.
- `tests/integration/mobile-e2e/connect-stub.ts:612,626,630` — the `\r\n`
  sequences are deliberate HTTP protocol, not file EOL. No change.
- There is no `toMatchSnapshot` / `toMatchFileSnapshot` /
  `toMatchInlineSnapshot` in `tests/**`: the classic "`\n` snapshot read with
  CRLF" hazard does not apply today. If anyone adds file-content snapshots,
  normalize with `replaceAll("\r\n", "\n")` before comparing.
- `killProcess` (`SIGTERM`→`SIGKILL`, `process.kill(pid, 0)`) — on Windows
  Node emulates both signals with `TerminateProcess`; the signal-0 probe
  works. No change.
- `spawnLoggedProcess` with `command: "node"` (`start.ts`) — `node.exe`
  resolves via PATHEXT without a shell. No change.

## Needs coordination (not `tests/**` or a product decision)

- `tests/qa/src/shared.ts:556` (`lsof -t +D`) and `:605` (`ps eww -Ao
  pid=,command=`) — on Windows there is no `lsof` or `ps`, so orphan cleanup
  (`cleanupStandaloneOrphans`, `cleanupStandaloneInstance`) is blind there: it
  kills what it knows from the pidfile and little else. The real path is
  `Get-CimInstance Win32_Process` (`ProcessId`, `ParentProcessId`,
  `CommandLine`; cwd is NOT exposed, a different strategy is needed) or
  `tasklist`. Owner: the team owning standalone QA / daemon (S2/S4).
- `tests/qa/src/shared.ts` (`buildDaemonRestartCommand`) — generates `sh`
  with `kill`, `. envfile`, `curl | jq`. The `RESTART_DAEMON_COMMAND` that
  `standalone:start` prints does not run in PowerShell. The PS twin is missing
  (product decision: same contract in PowerShell or via the `bb` CLI). The
  runbook (`qa/manual-runbook.md`, ~40 uses of `curl|jq`) has the same problem
  for the Windows operator: `curl.exe` exists but `jq` does not ship with the
  OS. Owner: daemon/CLI owners.
- `tests/integration/vitest.config.ts` — the hardcoded
  `BB_SERVER_PORT`/`BB_HOST_DAEMON_PORT` (49161/49162) collide the same way on
  every OS when two runners share a machine; not Windows-specific, noted for
  the record.
- `spawn-logged-process.test.ts` (`useIsolatedStandaloneTmpDir`) — the tests
  pin `TMPDIR` and expect `tmpdir()` to see it. On Windows `os.tmpdir()` may
  ignore `TMPDIR` (it uses `TEMP`/`TMP`/profile): pending confirmation on the
  runner; if it fails, pin all three or `GetTempPath`. Cannot be tested here.
- `apps/server/src/assets/install-machine.sh` — says `supports macOS and Linux
  only` and registers launchd/systemd. Windows enrollment (NSIS + service) is
  daemon/desktop work, not a QA twin. See `qa/PS-SCRIPTS.md`.
