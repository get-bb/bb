---
name: bb-plugin-authoring
description: Write, build, test, and install BB plugins. Use whenever a task creates or changes a BB plugin, BB CLI command, agent tool, background service, provider, setting, panel, mention provider, file renderer, message action, or other Plugin SDK surface.
---

# Author BB plugins

A BB plugin is a TypeScript package that can add server behavior, agent
capabilities, host-rendered UI, or a frontend bundle.

Use the current SDK types and repository source as the contract. This skill
routes to detailed references, but the installed BB version decides the exact
API.

## Start

1. Read repository instructions and the existing package.
2. Decide whether the feature needs a backend, frontend, or both.
3. Inspect the exact current SDK declaration before you implement a surface.
4. Build with bb plugin build.
5. Test the contract and the user workflow.
6. Install or reload only when the task requires a live check.

Use bb plugin new <name> for a new plugin. The scaffold includes frontend files.
Remove `bb.app` and those files when the plugin is headless.

Every new public Plugin SDK surface starts with an experimental\_ prefix and an
entry in docs/api_to_audit.md. Add its Plugin Guide card and API inventory in
the same change.

## Read only the relevant reference

### Start, package, and release

- Read references/quickstart.md for package structure, manifest fields,
  scaffold output, build, install, and the first plugin.
- Read references/distribution.md for exact API lookup, Git or npm release,
  multi-plugin repositories, and custom marketplaces.

### Backend

- Read references/backend-foundation.md for the factory, logging, settings,
  storage, server information, and host access.
- Read references/backend-sdk.md for projects, environments, threads,
  interactions, provider models, browser sessions, and event history.
- Read references/backend-api-index.md to check every public backend, host,
  AI-service, and test export.
- Read references/backend-events.md for lifecycle events, HTTP, RPC, realtime,
  background services, and schedules.
- Read references/backend-cli-agents.md for CLI commands, input forms, agent
  tools, agent configuration, and helper AI services.
- Read references/providers.md only when the plugin registers an agent provider.
- Read references/provider-bridge-api-index.md to check every public provider
  bridge, bridge-test, and ACP export.
- Read references/backend-ui-lifecycle.md for host-rendered UI, status, cleanup,
  and reload behavior.

### Frontend

- Read references/frontend-registration.md for definePluginApp, thread header,
  sidebar replacement, providers, and top-level registration.
- Read references/frontend-api-index.md to check every public frontend
  runtime value and type export.
- Read references/frontend-core-slots.md for trusted content scripts, homepage,
  settings, navigation, thread panels, interactions, sidebar actions, and file
  openers.
- Read references/frontend-renderer-slots.md for source, diff, message,
  timeline, palette, and provider-icon renderers or actions.
- Read references/frontend-components.md for ThreadChat, provider controls,
  source and diff viewers, links, panels, and the new-thread composer.
- Read references/frontend-hooks-and-ui.md for hooks, composer customization,
  vendored components, runtime shims, styling, and crash isolation.

### Testing

- Read references/frontend-testing-api-index.md to check every frontend test
  runtime value and type export.
- Read references/testing.md before you add tests or run a live plugin loop.

## Contract rules

- Parse freeform input at the boundary and pass typed values internally.
- Declare only manifest fields and settings that the plugin implements.
- Keep secret settings on the server.
- Treat frontend parameters and persisted values as untrusted input.
- Return bounded CLI and agent-tool output.
- Dispose every service, schedule, listener, content script, and resource.
- Use SDK host components and navigation for host-owned behavior.
- Use vendored UI source for plugin-owned controls.
- Keep experimental names until the public API audit stabilizes them.
- Use current names. Compatibility aliases can warn and can expire after one
  release. Removed APIs can throw.
- Run bb plugin types when SDK declaration versions can drift.
- Run bb plugin build before install, release, or marketplace submission.

## Verification

Confirm the backend contract, frontend contract, manifest, generated bundle,
and live behavior that the change affects. Use focused tests for failure-prone
policy and lifecycle behavior.
