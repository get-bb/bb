# SSH sandbox

Enroll any SSH-reachable host as a BB machine. BB copies the installer over
SSH and starts the host daemon, so you do not log into Daytona, E2B, Modal-like
boxes, or a plain VM to download BB yourself.

Install the optional official plugin, then create a machine with an SSH
destination. The project picker exposes **SSH sandbox** under **New machine**.

```sh
bb plugin install environment-ssh-sandbox --yes
bb ssh-sandbox probe --destination ubuntu@sandbox.example.com --json
bb machine create --provider ssh-sandbox --inputs '{"destination":"ubuntu@sandbox.example.com"}' --json
```

The remote host needs `node`, `npm`, `curl`, and a POSIX shell. Core installs
the matching BB daemon during bootstrap, then clones the selected project and
runs `.bb-env-setup.sh`. The SSH box is yours: removing the BB machine revokes
access and does not destroy the remote host.

## Settings

| Setting                 | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `identityFile`          | Optional private-key path on the BB server. Blank uses ssh-agent. |
| `knownHosts`            | `accept-new` (default), `yes`, or `no`.                           |
| `connectTimeoutSeconds` | SSH handshake timeout, default 15.                                |

Machine inputs are `{destination, port?}`. `destination` is an SSH config
alias, hostname, `user@host`, or `user@[IPv6]`. Put the port in `port`, not in
the destination string. Credentials stay in SSH keys or agent; never in machine
inputs or resource JSON.

Server access must be reachable from the sandbox (bb Connect or a public/direct
URL). A configured URL does not prove reachability.

See the [command reference](skills/ssh-sandboxes/SKILL.md).
