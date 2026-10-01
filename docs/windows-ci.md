# Windows CI foundation

The `Windows foundation (process-utils, Node 22.x)` job in
`.github/workflows/ci.yml` runs on Blacksmith Windows Server 2025 x64. It runs on
every pull request and main push, alongside the existing Linux checks. A failure
fails the job; the Windows tests are not advisory.

The first package is `@bb/process-utils`. The job runs its full test suite and
typecheck through Turbo with `--force`, so a cached result from another OS cannot
stand in for Windows execution. The package uses shared Vitest workers with
isolation for tests that mutate global state.

The native Windows coverage exercises:

- Native executable and PATH-resolved `.cmd` launches with spaces and Unicode in
  paths, literal arguments, stdin, stdout, stderr, and nonzero exit status.
- Missing executable errors and case-insensitive runtime environment cleanup.
- Drive-letter and UNC path containment, sibling-prefix escapes, and cross-drive
  or cross-share rejection.
- The existing diagnostic and environment tests.

Install and run the same slice from the repository root in PowerShell:

```powershell
npm install --global pnpm@9.15.0 --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts --filter bb --filter @bb/process-utils...
pnpm exec turbo run typecheck test --filter=@bb/process-utils --force --output-logs=full
```

The filtered install includes root tooling and the package's dependencies. Install
scripts are disabled because the root prepare step generates the entire product;
this slice needs neither those generators nor native addons. The package's Turbo
test task consequently depends on its source dependencies, not the global native
addon preparation task. Native dependencies for later packages must be installed
and verified explicitly when their CI coverage is added.

## Remaining Windows work

This check does not establish native Windows support for the app. The existing
POSIX process-tree tests remain POSIX-only: Windows process-tree termination,
leader-first shutdown, and process enumeration by working directory are not
covered or implemented by this slice. Provider discovery, terminals, Git/worktree
operations, native modules, and desktop installation/update verification are
subsequent slices.

Add packages to the install and Turbo filters as their real Windows tests pass.
Keep the Linux suite running to protect existing behavior. Windows Server CI must
eventually be supplemented with Windows 11 desktop verification for installation,
interactive terminals, updates, and process lifecycle behavior.
