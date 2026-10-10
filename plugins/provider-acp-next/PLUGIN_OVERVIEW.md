This is a preview of bb's rebuilt ACP adapter. Turning it on turns the original "ACP providers" plugin off; turning it off brings the original back. Both register the same providers, so your threads and your custom agents carry over either way.

Use one bb workspace with the coding agents you already run on your machine. This plugin connects bb to agents that speak the Agent Client Protocol (ACP). Each agent appears as a provider in the thread composer.

## What you get

- Ready-made providers for Cursor, opencode, omp, Grok Build, and Hermes Agent.
- The official ACP registry. Add any agent it lists that ships through `npx` or `uvx` with one click in the plugin's settings, or with `bb acp add <agent-id>`.
- A `Custom agents` setting. Add any other ACP agent as a JSON array with an `id`, a `displayName`, and a `command`.
- Permission modes `accept-edits` and `full` for every ACP provider.
- Reasoning levels and a model picker where the agent reports them.
- Skills from the agent's own skill directories, listed next to bb skills.

## How it works

The plugin launches the agent command on the host machine and talks to it over ACP. Cursor is always visible. The other agents appear after bb finds their command on a connected host. A background probe checks what each installed agent supports and updates the provider.

## Requirements

- Install the agent CLI on the host: `cursor-agent`, `opencode`, `omp`, `grok`, or `hermes`.
- Sign in with the agent's own command, for example `cursor-agent login` or `opencode auth login`.
- A custom agent needs a command that starts an ACP server on stdio.
- An agent added from the registry needs Node.js (`npx`) or uv (`uvx`) on the host.
