# SSH machine

Add an existing Linux or macOS machine using SSH access from the BB server machine. Pick a concrete `Host` alias from that machine's `~/.ssh/config`, including `Include` files and glob patterns, or type `user@host`. An empty config does not prevent typed destinations.

The plugin runs OpenSSH with public-key/agent authentication and existing trusted host keys. Password and host-key prompts are disabled. Normal SSH config routing, identity files, and ProxyJump apply. Configure and test access from the server machine first.

Core's `experimental_machines.bootstrap` installs and enrolls the daemon using the instance's default server-access provider. The target must have Node.js 22.19+ and npm and be able to reach that server-access URL. SSH carries command execution; it does not provide a reverse tunnel. Enrollment credentials travel through executor stdin and are never stored in plugin resources.

In Machines, choose **Add machine → SSH machine**. For a new thread through the CLI:

```sh
bb machine providers --json
bb thread spawn --new-machine ssh-machine \
  --machine-inputs '{"target":"dev@buildbox"}' \
  --environment-provider project-checkout --project <project-id> \
  --prompt 'Inspect this checkout'
```

The SDK can make the same selection using `sdk.hosts.create({ machineProviderId: "ssh-machine", projectId: null, inputs: { target: "dev@buildbox" } })`. Machine and environment selection remain independent; the plugin does not clone projects or register project sources itself.

Machines stay enrolled until explicitly removed; they never retire or suspend automatically. `bb machine remove <host-id>` invokes the core local `bb machine uninstall --host-id <id>` command over SSH. Core verifies the installed host identity, canonical data directory, service or daemon process, and port reservation ownership before removing the daemon installation. The remote machine and project checkouts outside that installation remain available. A failed uninstall retains the launch record for cleanup retries.

Before installation, the plugin reserves the core enrollment identity and checkpoints its target, key, and host ID. Cancellation can therefore clean up an allocation even when bootstrap never returns successfully. The pending launch record stays distinct from a completed machine until bootstrap returns the reserved identity.

Removal skips remote work only when the durable launch record proves bootstrap never started. Otherwise it uses the core lifecycle shim; the installer publishes this shim before any installation side effects, so a missing shim is a safe no-op. An existing broken shim or an ownership refusal remains a cleanup failure.

Completed launch records remain durable until removal, so replay after a server crash reuses the same host. In-progress retries reuse the core enrollment key. A key cannot be reused for a different SSH target. Failed creation does not run speculative uninstall.

## Development

```sh
pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk
pnpm exec turbo run typecheck test --filter=bb-plugin-environment-ssh-machine
```

The plugin depends on the public bootstrap helper and the core installer-provided `~/.local/bin/bb` lifecycle entrypoint. Its tests use a fake public plugin host, a fake SSH executable, and temporary files; they do not contact SSH targets or external vendors.
