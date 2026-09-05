# BB verification feature map

This map inventories the features discoverable in this checkout across the
core app, CLI/SDK, all 28 repository plugins, native clients and hosted services.
Each group page has separate recipes with a drive action, observable success,
source entry points and prerequisites. Shared behaviors can appear in more than
one recipe because provider/platform behavior needs separate verification.

**Documentation coverage and test results are separate.** The four smoke
journeys below were driven twice on an isolated Linux/Chromium dev app. All
other recipes are source-documented and pending live execution. Hardware,
authentication and external-service requirements stay in the map even when
they prevent execution here. See [VALIDATION.md](../VALIDATION.md).

## Starting a run

1. Run the source inventory check from [SKILL.md](../SKILL.md). Inspect any drift
   before choosing coverage; [INVENTORY.md](../INVENTORY.md) links declarations
   and source groups to their recipe owners.
2. Select the changed capabilities plus their shared/provider/platform recipes.
   For a whole-product audit, make one result entry per recipe and platform.
3. Follow the main isolated launch/doctor rules and the selected page’s extra
   setup. Record actual entry point, source commit, result, evidence and cleanup.
4. Keep `not run` distinct from `blocked` (an attempted check missing a concrete
   prerequisite), and both distinct from a pass. Do not omit unavailable features.

## Previously executed smoke journeys

| Feature group | Recipes | Verification status |
| --- | --- | --- |
| [Add a local project](local-project.md) | 1 | Live pass at the recorded revision |
| [Run and organize a thread](thread-lifecycle.md) | 1 | Live pass at the recorded revision |
| [Persist appearance choices](appearance.md) | 1 | Live pass at the recorded revision |
| [Use a compact persistent menu](compact-menu.md) | 1 | Live pass at the recorded revision |

## Core app and shared behavior

| Feature group | Recipes | Verification status |
| --- | --- | --- |
| [Navigation, search, and thread organization](navigation.md) | 11 | Source-documented |
| [Projects, sources, environments, and Git](projects-environments.md) | 15 | Source-documented |
| [Compose, mentions, attachments, and voice](composer.md) | 12 | Source-documented |
| [Active turns, queues, plans, goals, and recovery](execution-controls.md) | 14 | Source-documented |
| [Approvals, questions, and permission escalation](interactions.md) | 7 | Source-documented |
| [Conversation history, message actions, and rendered output](timeline.md) | 12 | Source-documented |
| [Panels, files, terminals, splits, and embedded browser](workspace-panels.md) | 15 | Source-documented |
| [Settings, keyboard, appearance controls, and usage](settings.md) | 13 | Source-documented |
| [Skills, plugins, marketplaces, and plugin development](extensions.md) | 13 | Source-documented |
| [Machines, daemon lifecycle, and updates](hosts-updates.md) | 8 | Source-documented |
| [Agent interfaces, route compatibility, and error contracts](compatibility-api.md) | 8 | Source-documented |
| [Responsive layouts, accessibility, and performance](responsive-accessibility.md) | 8 | Source-documented |

## Repository plugins

| Feature group | Recipes | Verification status |
| --- | --- | --- |
| [Account pooling](plugin-account-pool.md) | 7 | Source-documented; enable in test store |
| [Fallback question cards](plugin-ask-user-question.md) | 5 | Source-documented; enable in test store |
| [Scheduled agent and script automations](plugin-automations.md) | 8 | Source-documented; enable in test store |
| [Agent concurrency limits](plugin-concurrency-limit.md) | 5 | Source-documented; enable in test store |
| [Remote Connect and port sharing](plugin-connect.md) | 7 | Source-documented; enable in test store |
| [Custom agent instructions](plugin-custom-instructions.md) | 3 | Source-documented; enable in test store |
| [Docs vaults and editing](plugin-docs.md) | 9 | Source-documented; enable in test store |
| [GitHub issues and pull requests](plugin-github.md) | 8 | Source-documented; enable in test store |
| [Inline HTML visualizations](plugin-inline-vis.md) | 5 | Source-documented; enable in test store |
| [Keep machines awake](plugin-keep-awake.md) | 4 | Source-documented; enable in test store |
| [Persistent agent memory](plugin-memory.md) | 6 | Source-documented; enable in test store |
| [Code editor and file tree](plugin-monaco-editor.md) | 6 | Source-documented; enable in test store |
| [PDF preview](plugin-pdf-preview.md) | 3 | Source-documented; enable in test store |
| [Plugin Guide](plugin-plugin-api-docs.md) | 4 | Source-documented; enable in test store |
| [Plugin API tester](plugin-plugin-api-tester.md) | 2 | Source-documented; enable in test store |
| [ACP providers](plugin-provider-acp.md) | 6 | Source-documented; enable in test store |
| [Claude Code provider](plugin-provider-claude-code.md) | 7 | Source-documented; enable in test store |
| [Codex provider](plugin-provider-codex.md) | 7 | Source-documented; enable in test store |
| [Pi provider](plugin-provider-pi.md) | 5 | Source-documented; enable in test store |
| [Automatic provider retry](plugin-provider-retry.md) | 5 | Source-documented; enable in test store |
| [Provider usage limits](plugin-provider-usage.md) | 3 | Source-documented; enable in test store |
| [Web, desktop, and mobile notifications](plugin-push-notifications.md) | 6 | Source-documented; enable in test store |
| [Scheduled messages](plugin-scheduled-send.md) | 5 | Source-documented; enable in test store |
| [Secure credential requests](plugin-secrets.md) | 5 | Source-documented; enable in test store |
| [Side chats](plugin-side-chat.md) | 4 | Source-documented; enable in test store |
| [Tasks, boards, and delegation](plugin-tasks.md) | 13 | Source-documented; enable in test store |
| [Theme preview workbench](plugin-theme-preview.md) | 4 | Source-documented; enable in test store |
| [Durable workflows](plugin-workflows.md) | 8 | Source-documented; enable in test store |

## Platform and support surfaces

| Feature group | Recipes | Verification status |
| --- | --- | --- |
| [Desktop application](desktop.md) | 12 | Source-documented; platform setup required |
| [Native mobile shell](mobile.md) | 12 | Source-documented; platform setup required |
| [Hosted website, dashboard, and marketplace](hosted-web.md) | 12 | Source-documented; platform setup required |
| [Cloud gateway and tunnel behavior](cloud-gateway.md) | 7 | Source-documented; platform setup required |
| [Developer tools, fixtures, and scope boundaries](developer-fixtures.md) | 5 | Source-documented; platform setup required |

## Scope reconciliation

- **Compatibility:** legacy app routes and removed manager commands are
  tracked in compatibility-api; they are not additional modern product features.
- **Developer-only:** demo server, dev launchers, Plugin API tester, Guide, theme
  workbench and gated mobile diagnostics are explicitly mapped.
- **Native wrappers:** repeat core web recipes in Electron and the mobile WebView,
  then run native-only recipes. Chromium emulation does not verify Safari/iOS.
- **Third-party plugins:** code absent from this checkout cannot be enumerated
  from repository source. List installed extras during doctor and add their own
  recipes when auditing that installation.
- **Mechanical completeness:** every discovered CLI family and repository plugin
  has an owner; route/API declarations and broader source fingerprints are
  tracked. This detects drift, but a human/source review still has to identify
  capabilities hidden behind dynamic registrations and behavior changes.

The map should grow with the product. Do not restore a fixed starter count or
drop a feature merely because it is difficult to automate.
