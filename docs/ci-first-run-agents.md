# First-run agent CI

Dispatch the existing CI workflow on a branch containing the harness:

```sh
gh workflow run ci.yml --ref <branch> -f first_run_agents=true
```

This selects only the first-run jobs and their setup. Normal CI also selects
these jobs for provider, provider bridge protocol, host installation/runtime
shell environment, onboarding, and bb-app changes, and on `workflow_dispatch` with `first_run_agents=true`. Full CI and pushes to main don't run them. The jobs are `continue-on-error` until the known product fixes (#5948, #5943, #5429) land, so a red matrix doesn't fail the workflow.

The Windows and macOS jobs build the packaged bb-app through Turbo, boot its
server and daemon with a disposable home containing a space, and exercise the
same installation and health routes as onboarding. They use no account secrets.
The harness records the runner's original executable inventory and the isolated
process environment separately. The disposable server's machine-environment
setting applies its controlled PATH after Windows registry recovery. The harness
does not modify the runner's registry or shared agent installations. Sign-in launch evidence must be a URL or device
code from the actual CLI; that output is not published. Credential files and the
local model server are synthetic. A completed fake-model turn proves transport
and lifecycle integration, not vendor authentication or hosted inference.

Each OS uploads a sanitized JSON report and Markdown summary under the
`first-run-<OS>` artifact. The final job combines them into the six-column
reliability matrix. Missing evidence is a failure, never a passing cell.
Product failures leave the job red while preserving the remaining probes.
Update probes first install an actual preceding vendor release, then request the
same bb update action as the UI and require a version increase. This avoids
calling an unavailable update action against a freshly installed latest release.
On Windows the update phase adds the actual native install directories to PATH
and restarts before probing. This represents a new terminal after installation
and exercises the bare-command/PATHEXT path addressed by PR #5429. Earlier
first-run phases use the stripped PATH. The report captures the actual command
sent to the daemon installer and the executable inventory for this phase.
The Pi phase enables npm's foreground lifecycle output in the disposable home
and requires evidence that the real protobufjs dependency ran its Node
postinstall script. Successful installation without that evidence is labeled
stubbed for the node-shim regression, not a proven pass.
The summary records unsupported or unexercised paths explicitly as stubbed.
The status API can omit a provider when its probe times out. The harness retries
an omitted entry at most twice and records every omission in the evidence;
three missing responses fail the check. Failed install actions are never retried
or converted to success by this polling.

The latest upstream installers are deliberately fetched on every run, so this
job is not cached. Network/vendor availability and changing CLI behavior can
cause failures. Build time is separate from the per-OS harness runtime. CI
retains evidence for 14 days. No raw credential files or sign-in output are
uploaded.
