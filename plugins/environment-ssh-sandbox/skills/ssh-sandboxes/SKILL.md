---
name: ssh-sandboxes
description: Enroll Daytona, E2B, or any SSH host as a BB machine without logging in to install the daemon.
---

# SSH machines

1. Install `builtin:environment-ssh-sandbox`. SSH must be on the bb server PATH.
   Optional settings: `identityFile` (server-local key path), `knownHosts`
   (`accept-new` / `yes` / `no`), `connectTimeoutSeconds` (1–120, default 15).
   Leave `identityFile` blank to use ssh-agent and default keys. Do not paste
   private keys into chat or machine inputs.
2. The remote host needs Node, npm, curl, and a POSIX shell, plus machine server
   access reachable from that host. Resolve the project with
   `bb project list --json`. It needs a Git remote if you want a project checkout.
3. Probe without installing the daemon:
   `bb ssh-sandbox probe --destination user@host [--port N] [--json]`.
   Exit status 1 means SSH or the preflight tools failed. SDK:
   `sdk.plugins.callRpc` with `sshSandboxRpcContract` method `ssh.probe`.
4. Create a standalone machine with
   `bb machine create --provider ssh-sandbox --inputs '{"destination":"user@host"}' --json`.
   Optional `"port": 2222`. SDK:
   `hosts.experimental_create({machineProviderId:"ssh-sandbox",inputs,key})`.
   Use a stable creation key for retries. Removal revokes BB access; it does not
   delete the remote VM.

`destination` is an SSH config Host alias, hostname, `user@host`, or
`user@[IPv6]`. It cannot carry a port, SSH options, or shell metacharacters.
Put extras in `~/.ssh/config` on the bb server (ProxyJump, IdentityFile, User).

### New thread with a new SSH machine

Use `bb thread spawn --project <id> --environment-provider ssh-sandbox --machine-inputs '{"destination":"user@host"}' --prompt "..."`.
The composed environment creates the SSH machine and uses core project-checkout
setup to clone the project. Do not pass machine selectors with this environment.
Existing SSH hosts retain their normal checkout/worktree choices.

Daytona, E2B, and similar sandboxes: create the vendor sandbox first, copy its
SSH destination (and port if not 22), then pass those values to probe/create.
BB does not allocate vendor compute.
