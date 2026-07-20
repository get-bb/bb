---
id: tools-hub-resource-system-407
name: Tools Hub Resource System
status: approved
created_date: 2026-07-08
description: A cohesive Tools hub for discovering and managing bb skills, plugins, and automations.
---

# Tools Hub Resource System

The Tools hub should make bb capabilities discoverable for new and light users while staying fast enough for heavy users to manage many installed resources.

## Product Summary

Tools is the home for three resource kinds:

| Resource    | User meaning                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Skills      | Reusable instructions and know-how available to agents.                                                    |
| Plugins     | Installed capabilities that add bb surfaces, commands, background services, or provider-specific behavior. |
| Automations | Scheduled or recurring bb work, scoped to projects or folders.                                             |

The target `/tools` route is a mixed overview. It should not expose a visible `All` tab. The resource tabs are focused destinations for Skills, Plugins, and Automations.

## Confirmed Product Goals

| Goal                        | Decision                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary job                 | Discovery and management. Discovery and learning matter most for new users or users with few resources; management matters most for users with many resources. |
| Primary audience            | All bb users. There is no workspace-admin role for this feature.                                                                                               |
| First landing understanding | Users should understand what tools are available, what each kind can do, and how they can create or add them.                                                  |
| Returning-user speed        | Returning heavy users should be able to manage resources quickly.                                                                                              |
| Default route               | `/tools` is a mixed overview.                                                                                                                                  |
| Visible tabs                | No visible tab named `All`.                                                                                                                                    |
| Canonical resource kinds    | Skills, Plugins, Automations.                                                                                                                                  |
| Templates                   | Templates are resource-specific creation/discovery affordances, not a top-level tab.                                                                           |
| skills.sh                   | skills.sh is a skill catalog/discovery surface, not a provider.                                                                                                |

Discovery wins the empty or low-resource state. Management wins the populated state.

## Top Workflows

| Priority | Workflow             | Success criteria                                                                                                                   |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Orient               | A user lands on `/tools`, sees useful discovery surfaces and installed-resource previews, and understands where to go deeper.      |
| 2        | Discover and install | A user finds a skill on skills.sh, inspects it, installs it to the right provider and scope, and sees it appear in installed rows. |
| 3        | Manage automation    | A user scans automations, spots a failing one, opens detail, reads recent run history, then runs now or pauses it.                 |

## User Stories

| User             | Story                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New bb user      | As a new user, I can land on Tools and understand what Skills, Plugins, and Automations do without already knowing bb’s internal model.                  |
| Light user       | As a user with few resources, I can discover useful skills, plugins, and automations that help me get more value from bb.                                |
| Heavy user       | As a user with many resources, I can search, sort, filter, inspect, enable, disable, run, edit, or delete resources without slow navigation.             |
| Provider user    | As a Codex or Claude Code user, I can understand which installed resources are tied to each agent/provider.                                              |
| Automation user  | As a user running scheduled work, I can see what automations exist, where they belong, and what happened recently.                                       |
| No-provider user | As a user without Claude Code or Codex configured, I can understand why provider-specific install actions are unavailable and how to configure an agent. |

## Product Principles

- Treat Skills, Plugins, and Automations as one resource system with shared interaction grammar.
- Keep rows quiet: rows should support scanning and management, not repeat obvious healthy state.
- Use detail pages for heavier taxonomy, history, configuration, and explanation.
- Make creation/discovery visible without turning templates or catalogs into separate top-level product concepts.
- Make unavailable actions understandable without asking users to infer missing provider or project setup.
- Keep color and visual emphasis reserved for Tools-specific meaning and actionable resource state.

## Architecture Output

The Tools hub should be a cohesive view over existing bb primitives, not a new persisted Tool object. The system architecture is a shared UI and taxonomy layer that lets Skills, Plugins, and Automations remain owned by their existing domains while presenting them through one product grammar.

### Capability Model

| Dimension     | Decision                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs        | Existing skill summaries and skills.sh catalog data, installed plugins, provider-derived plugin capabilities, automation overview/detail data, provider CLI availability, route state, search/filter/sort state. |
| Outputs       | Mixed overview modules, focused resource tabs, installed resource rows, discovery/install affordances, detail pages, resource states, and stable navigation routes.                                              |
| State         | Persisted state stays with each domain: skills on disk/provider registries, plugins in plugin state, automations in the automations plugin. Tools owns transient UI state only.                                  |
| Lifecycle     | Tools observes, creates, installs, enables, disables, pauses, resumes, runs, edits, deletes, and links into existing resource lifecycles without inventing a parallel lifecycle.                                 |
| Permissions   | Capability follows source and ownership: user-created resources can be edited/deleted; built-in/provider-managed resources are inspectable and may expose only supported actions.                                |
| Relationships | Provider-specific plugins can link to underlying provider skills; skills.sh entries can link to installed provider instances; automations link to projects, folders, threads, and run history.                   |
| History       | History remains resource-specific: automation run history, plugin status/configuration, skill source/content preview. The mixed overview may summarize recent activity but does not own history.                 |
| Automation    | Agents should be able to read the five-facet taxonomy, inspect resource detail pages, and trigger supported actions through existing commands or APIs.                                                           |

### Primitives Reused

| Existing primitive | How Tools uses it                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- |
| Skill              | Installed instructions and catalog-discovered skills.                                   |
| Plugin             | Installed bb or provider-managed capability bundles.                                    |
| Automation         | Scheduled or recurring bb work.                                                         |
| Agent              | Compatibility/runtime facet for Codex, Claude Code, and bb.                             |
| Source             | Catalog, built-in, provider-managed, user-created, or plugin-provided origin.           |
| View               | Mixed overview, focused tabs, and detail pages are projections over existing resources. |
| Metadata           | The five-facet taxonomy: Kind, Source, Scope, Agents, State.                            |
| Action             | Install, create, inspect, enable, disable, pause, resume, run, edit, delete.            |

New primitives should be UI primitives only: shared resource row, toolbar, source/discovery shelf, detail shell, metadata list, action controls, and story fixtures. The spec explicitly rejects a new persisted `Tool` super-entity.

### Interaction Model

| Surface         | Interaction rule                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixed overview  | Show useful resources directly: discovery shelves, installed-resource previews, and links into focused tabs or details. Do not use kind-summary cards or aggregate health modules. |
| Focused tabs    | Own search, filter, sort, discovery, installed rows, and row-level management for one resource kind.                                                                               |
| Detail pages    | Explain one resource, show canonical metadata, expose safe actions, and link related resources/history.                                                                            |
| Create/discover | Templates and catalogs are entry points into each resource kind, not a separate navigation category.                                                                               |

### Lifecycle And Scale

| Stage     | Product rule                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation  | Creation starts from the relevant kind: skill install/create, plugin install/enable, automation template/create path.                                                                                                                                   |
| Editing   | Editing depends on source ownership; unsupported edit paths must be clear rather than fake.                                                                                                                                                             |
| Viewing   | Overview for orientation, focused tab for management, detail page for confidence and action.                                                                                                                                                            |
| Searching | Search belongs inside focused tabs; the mixed overview should not become cross-resource search in this PR.                                                                                                                                              |
| Recovery  | Destructive or disabling actions should be reversible where the underlying resource supports it.                                                                                                                                                        |
| Growth    | With few resources, discovery can stay visible. Once resources exist, management controls must remain easy to reach; at 100 resources, search/filter/sort must dominate. At 10,000 resources, focused tabs and indexed domain queries become mandatory. |

### Architecture Tradeoffs

| Option                                  | Decision           | Rationale                                                                                     |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| New Tool entity                         | Reject             | Adds schema and lifecycle complexity without solving the user problem.                        |
| One mixed searchable table              | Reject for this PR | Cross-kind metadata does not normalize cleanly and would weaken resource-specific management. |
| Three isolated pages                    | Reject             | Repeats UI and fails the cohesive system goal.                                                |
| Shared view layer over existing domains | Adopt              | Preserves ownership boundaries while giving users one mental model.                           |

The core architecture recommendation is to standardize taxonomy and UI primitives first, then let each resource domain provide adapters into that system.

## Resource Taxonomy

Every resource surface should map into five facets:

| Facet  | Meaning                                 | Example values                                                                                |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Kind   | What kind of resource this is.          | Skill, Plugin, Automation                                                                     |
| Source | Where it came from and who owns it.     | bb built-in, Created by you, Provider-managed, Installed from skills.sh, From plugin `<name>` |
| Scope  | Where it applies.                       | User, Project `<name>`, Folder `<name>`                                                       |
| Agents | Which agent/provider can use or run it. | Codex, Claude Code, bb                                                                        |
| State  | Whether it can currently do its job.    | Healthy, Active, Paused, Disabled, Failed, Needs configuration, Completed                     |

Provider is not scope. Ownership and scope must stay separate. For example, a skill can be installed from skills.sh, scoped to User, and available to Codex.

## Mixed Overview

The mixed overview should behave like strong resource hubs: show useful resources directly instead of describing resource kinds as cards.

| Module                        | When shown                                      | Product job                                                                                                  |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Discovery shelf               | When catalog/template data is available         | Show compatible, inspectable resources to try next. For v1 this is the skills.sh shelf.                      |
| Installed skills preview      | Always                                          | Show a short row preview of installed skills with a section-level `View all` link.                           |
| Installed plugins preview     | Always                                          | Show a short row preview of installed bb and provider-specific plugins with a section-level `View all` link. |
| Installed automations preview | Always when the automations plugin is available | Show real automation rows with schedule/location/status and a section-level `View all` link.                 |

The mixed overview does not include kind-summary cards, browse/manage CTA pairs, aggregate health strips, full resource lists, cross-resource search, filters, sort controls, or deep management row actions. Those belong in focused tabs or detail pages.

### Mixed Overview V1 Data Contract

The mixed overview must use existing data sources only. It should hide modules that cannot be populated from current data rather than inventing placeholders or new backend aggregation.

| Module                        | Existing data source                                            | Show/hide rule                                                                                                           | Deferred                                                                  |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Discovery shelf               | skills.sh catalog entries compatible with configured providers. | Show when skills.sh loads. Hide on catalog failure rather than blocking installed-resource management.                   | Plugin marketplace recommendations and automation recommendation backend. |
| Installed skills preview      | Existing skill summaries.                                       | Show rows or an empty state. Limit to a compact preview and link to Skills for full management.                          | Cross-kind search.                                                        |
| Installed plugins preview     | Existing plugins plus provider-derived plugins.                 | Show rows or an empty state. Limit to a compact preview and link to Plugins for full management.                         | Plugin marketplace rows.                                                  |
| Installed automations preview | Existing automations overview data from the automations plugin. | Show rows, loading, unavailable, or empty state. Limit to a compact preview and link to Automations for full management. | Cross-kind activity feed or new health aggregation.                       |

V1 overview layout rule: discovery leads for new/light users, followed by installed-resource previews. For populated users, installed-resource previews must remain visible in the first screen; shorten discovery before pushing management previews too far down.

## Focused Tabs

Each resource tab owns full management for that kind:

| Tab         | Product job                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Skills      | Discover installable skills and manage installed skills.                                          |
| Plugins     | Discover plugin capabilities/templates and manage installed bb and provider-specific plugins.     |
| Automations | Discover automation starting points and manage installed automations across projects and folders. |

The tab structure should be:

1. Tab title or persistent description.
2. Resource-specific discovery or creation affordance.
3. Search, filter, sort, and create controls.
4. Installed resource rows.

V1 keeps discovery above the toolbar in focused tabs, but discovery must stay compact enough that management controls remain in the first viewport for populated users. If a discovery module would push search/filter/sort too far down, collapse or shorten discovery rather than moving management out of reach.

## Discovery And Recommendation

“Recommended” means compatible with configured agents first, ranked by catalog popularity, with first-party resources labeled but not automatically boosted. If compatibility is unknown, the UI should use honest labels such as “Popular on skills.sh” instead of “Recommended.”

Trust signals before adding a resource:

| Signal          | Product requirement                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Source identity | Show the repo, author, plugin, provider, or first-party bb source.                                                             |
| Usage           | Show install counts or equivalent catalog popularity when available.                                                           |
| Inspectability  | Let users inspect the skill content, template prompt, plugin capability, or automation behavior before installing or creating. |
| Reversibility   | Explain what adding does and make delete, uninstall, disable, or pause paths visible.                                          |

Per-kind add-decision metadata:

| Kind       | Decision metadata                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Skill      | Works-with agents, install count, scope choice, already-installed-on indicator, full content preview. |
| Plugin     | Surfaces, commands, or services added; version; whether configuration is needed after enabling.       |
| Automation | Trigger cadence, project/folder/environment, execution mode, and what output it creates.              |

## Resource State

Resource state belongs on the resource row or detail page, not in a special mixed-overview aggregate. The overview may show the same quiet row state that a focused tab would show, but it should not create a separate health strip or “to fix” module.

| Kind       | Problem state examples                                                                                              | Not a problem state                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Skill      | Installed for a provider that is no longer configured, file unreadable if already detected by the existing summary. | Healthy installed skills, skills not yet installed from a catalog. |
| Plugin     | Error, incompatible, needs configuration, degraded.                                                                 | Intentionally disabled by the user.                                |
| Automation | Last run failed, missing required runtime if already detected.                                                      | Paused by user intent, completed one-shot, empty run history.      |

Healthy resources should not carry loud success badges just to prove they are healthy. Problem states should be specific labels such as `Failed`, `Needs configuration`, or `Unavailable`, with explanatory detail in the row description or detail page.

### State Matrix

| Kind       | Default unshown state | Visible states                                               |
| ---------- | --------------------- | ------------------------------------------------------------ |
| Skill      | Healthy/installed     | Unavailable provider, unreadable file when already detected. |
| Plugin     | Enabled and healthy   | Disabled, Needs configuration, Failed, Incompatible.         |
| Automation | Active                | Paused, Failed, Completed, Disabled.                         |

`Healthy` is the conceptual default, not a row badge. `Active` is automation-specific because running scheduled work needs an explicit control state; it should still be visually quiet.

State reasons such as unavailable provider, read-only source, needs configuration, incompatible, degraded, failed run, or unavailable runtime should appear as explanation text near the canonical state, not as duplicated row metadata.

## Row Semantics

Rows are for scanning and fast management.

Healthy rows show identity and useful location/source metadata only: icon, name, description or schedule, and quiet meta. State appears on rows only when it deviates from the expected default: Paused, Disabled, Needs configuration, Failed, Completed, or Unavailable.

Primary row actions differ by kind:

| Kind        | Primary row action model                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Skills      | Open detail, inspect, edit when user-owned, delete when user-owned. No enable/disable concept.                 |
| Plugins     | Open detail, enable/disable, configure when needed, delete/uninstall when applicable.                          |
| Automations | Open detail, pause/resume, run now, delete. V1 does not show a row edit control if editing is CLI/agent-owned. |

Destructive and rare actions can live in overflow menus. Hover actions should be consistent in placement and tooltip behavior across kinds, with the same actions reachable by keyboard focus.

## Detail Pages

All detail pages use one shared detail shell and one shared metadata order while allowing resource-specific sections.

Every detail page should answer:

1. What is this?
2. Where did it come from?
3. Where does it apply?
4. Which agents can use or run it?
5. Is it healthy?
6. What happened recently?
7. What action can I safely take next?

Canonical detail metadata order:

| Order | Facet                        | Notes                                                                            |
| ----- | ---------------------------- | -------------------------------------------------------------------------------- |
| 1     | Kind                         | Skill, Plugin, Automation.                                                       |
| 2     | Source                       | bb built-in, Created by you, Provider-managed, skills.sh, plugin source.         |
| 3     | Scope                        | User, project, folder.                                                           |
| 4     | Agents                       | Codex, Claude Code, bb, or runtime agent.                                        |
| 5     | State                        | Healthy, Active, Paused, Disabled, Failed, Needs configuration, Completed.       |
| 6     | Resource-specific properties | Schedule, version, script path, SKILL.md path, plugin capabilities, run history. |

## Provider-Specific Plugins

Provider-specific plugins are a product concept when they represent installed provider-managed bundles of capabilities, such as Codex or Claude Code plugin packages.

They may appear in Plugins as provider-managed plugin rows and their underlying skills may also appear in Skills. The UI must make that relationship explicit so double-listing reads as cross-linking, not duplication.

## Navigation Model

Target navigation:

- `/tools` renders the mixed overview.
- `/tools` does not redirect to `/tools/skills`.
- The tab bar shows Skills, Plugins, and Automations only.
- The tab bar has no selected tab at `/tools`.
- Clicking the Tools nav item returns to the mixed overview.
- The page title or breadcrumb `Tools` label should also link back to `/tools` from focused tabs and detail pages.
- Detail breadcrumbs use `Tools / <Kind> / <Name>`, with `Tools` linking to the mixed overview and `<Kind>` linking to the focused tab.
- Deep links remain stable for skills, plugin details, automation details, and legacy redirects.
- Legacy top-level routes such as `/skills` and `/automations` may redirect into the Tools hub.

## Design Output

The design should feel like an operational resource manager with built-in discovery, not a marketing page and not three unrelated settings pages.

### User Flow

| Flow                 | Steps                                                                                                                         | Success state                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Orient               | Land on `/tools` → scan discovery and installed-resource previews → choose a focused tab or detail.                           | User understands the available resource kinds and where to act next.       |
| Discover and install | Open Skills → inspect skills.sh card/detail → choose provider and scope → install → see confirmation and installed row.       | User understands what was installed, where it applies, and how to undo it. |
| Manage automation    | Open Automations → search/filter/sort → identify failing or relevant row → open detail → run now, pause, or diagnose history. | User can control scheduled work without guessing state or origin.          |
| Manage plugin        | Open Plugins → find installed/provider-managed plugin → inspect capabilities/configuration → enable, disable, or configure.   | User knows what the plugin adds and whether it is healthy.                 |

### Screen Model

| Screen          | Primary content                                                      | Primary action                                 | Secondary content                                                  |
| --------------- | -------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Mixed overview  | Discovery shelf plus compact installed-resource previews by kind.    | Enter a focused tab or open a resource detail. | Section-level `View all` links and compact catalog cards.          |
| Skills tab      | skills.sh discovery followed by installed skill rows.                | Install/create or open a skill.                | Agent filter, alphabetical sort, provider compatibility and scope. |
| Plugins tab     | Plugin discovery/templates followed by installed plugin rows.        | Enable/disable or open plugin detail.          | Provider-specific plugin rows and configuration state.             |
| Automations tab | Automation starters followed by installed automation rows.           | Pause/resume, run now, or open detail.         | Project/folder filters, schedule metadata, run state.              |
| Detail page     | Header, canonical metadata, resource-specific configuration/history. | The safest resource-specific action.           | Overflow actions and related resource links.                       |

### State Model

| State                   | Design requirement                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty overview          | Lead with discovery and explain each installed-resource section through empty states.                                                          |
| Populated overview      | Lead with useful discovery, then show compact installed-resource previews by kind.                                                             |
| Empty focused tab       | Explain what belongs in that tab and show a resource-specific starting action.                                                                 |
| Loading                 | Preserve the layout frame; use skeleton rows/cards where content will appear.                                                                  |
| Healthy                 | Keep visual treatment quiet; avoid success badges that compete with real issues.                                                               |
| Failed/problem state    | State the specific problem and the direct recovery path on the row or detail page.                                                             |
| Disabled/unavailable    | Explain whether the user disabled it intentionally or setup is missing.                                                                        |
| No configured provider  | Disable provider-specific install actions and link or point to provider setup.                                                                 |
| Partial catalog failure | Keep installed resources manageable. In focused tabs, show a retry path for catalog content; on the mixed overview, hide the discovery module. |
| Destructive action      | Use confirmation when deletion is not trivially reversible.                                                                                    |

### Visual Hierarchy

| Rank | Information                                  | Treatment                                                                                  |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | Current resource context and primary action. | Page title/detail header, focused row action, or detail action.                            |
| 2    | Resource identity.                           | Icon/logo, title, one-line description or schedule.                                        |
| 3    | Local resource state.                        | Warning/error treatment only on the row/detail when a specific resource cannot do its job. |
| 4    | Taxonomy metadata.                           | Quiet meta text or detail properties in canonical order.                                   |
| 5    | Rare/destructive actions.                    | Overflow menus or confirmed detail actions.                                                |

Rows should align across kinds. The differences should come from resource semantics, not from bespoke layouts.

### Edge Cases

| Edge case                                            | Design response                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| User has no resources                                | Overview and tabs emphasize teaching and creation/discovery.                                                                       |
| User has many resources                              | Focused tabs prioritize search, filter, sort, and quiet rows.                                                                      |
| User has no provider configured                      | Discovery remains visible, but install actions explain the missing provider setup.                                                 |
| Installed catalog item appears in browse results     | Browse surfaces should indicate installed state or omit it from compact carousels; installed rows remain canonical for management. |
| Provider-specific plugin duplicates skill visibility | Cross-link the relationship so it reads as two views of one provider-managed capability bundle.                                    |
| Automation failed but is paused                      | Keep the row scoped to the current state and expose failure detail in the automation detail/run history.                           |
| Plugin disabled by intent                            | Muted state, not warning state.                                                                                                    |

Install/create success should confirm completion with a toast or equivalent feedback and, when practical, reveal the newly installed row without disrupting the user's context.

### Design Rationale And Tradeoffs

| Decision                                        | Rationale                                                                                                                          | Tradeoff                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Mixed overview without `All` tab                | Keeps `/tools` as orientation while tabs remain focused filters.                                                                   | Requires a clear return path to the overview.                                                         |
| Resource previews instead of kind-summary cards | Strong resource hubs show useful items directly; users learn by seeing real resources, not by choosing generic Browse/Manage CTAs. | The overview needs compact previews and section-level links to avoid becoming a full management page. |
| Discovery above installed rows in focused tabs  | Helps new/light users while preserving installed rows as canonical management.                                                     | Heavy users may want discovery to collapse later.                                                     |
| Quiet healthy rows                              | Reduces noise and makes specific problem states visible.                                                                           | Some users may initially expect explicit healthy status everywhere.                                   |
| Shared detail shell                             | Makes resource taxonomy learnable and maintainable.                                                                                | Some resource-specific detail layouts need adaptation.                                                |
| No cross-resource search on overview            | Avoids shallow global search and inconsistent metadata.                                                                            | Heavy users must enter a focused tab before searching.                                                |

### Open Design Follow-Ups

- Decide whether discovery modules become collapsible after enough installed resources exist.
- Decide whether later versions should add cross-kind recent activity beyond automation run data.
- Decide whether automation edit UI should become first-class in a later PR.

## Product Scope

In scope:

- Mixed Tools overview without a visible `All` tab.
- Focused Skills, Plugins, and Automations tabs.
- Shared overview primitives for tabs, descriptions, discovery shelves, preview sections, search, filters, sort, create actions, rows, row actions, and states.
- Shared detail-page primitives and consistent detail-page taxonomy.
- Provider-specific plugin visibility for Codex and Claude Code resources.
- skills.sh as a skill catalog/discovery surface, not as a provider section.
- Ladle stories that show the shipped resource system and component sets.

Out of scope:

- Cross-resource global search on the mixed overview.
- New recommendation, health, or catalog backends beyond existing queries.
- Plugin marketplace or registry backend work.
- skills.sh publishing, accounts, ratings, or reviews.
- Workspace roles or workspace administration.
- A top-level Templates tab.
- A new persisted Tool super-entity or schema-level resource abstraction.
- Full automation creation/editing UI beyond existing composer, CLI, or agent paths.
- Mobile-specific redesign beyond preserving current responsive behavior.

## Technical Context

The current branch already has real resource surfaces that should be reused rather than replaced:

| Area                        | Existing surface                                                |
| --------------------------- | --------------------------------------------------------------- |
| Shared resource UI          | `packages/shared-ui/src/components/ui/resource-list.tsx`        |
| Tools hub shell and plugins | `apps/app/src/views/ToolsView.tsx`                              |
| Skills                      | `apps/app/src/views/SkillsView.tsx`                             |
| Automations                 | `plugins/automations/app.tsx`                                   |
| Stories                     | `apps/app/src/components/tools/ToolsResourceSystem.stories.tsx` |
| Icons                       | `packages/shared-ui/src/components/ui/icon.tsx`                 |

Known branch gaps:

- `/tools` currently redirects to `/tools/skills`; the target product requires a real mixed overview.
- The current stories contain parallel fixtures and should render shared presentational components wherever possible.
- Provider-plugin inference and double-listing need a deliberate product and implementation rule.
- Automation preview rows depend on the automations plugin overview data being available in the Tools shell.

The implementation should continue to reuse the PR’s existing data, queries, detail views, and shared UI components. New primitives are acceptable only when they make the Tools resource system easier to maintain across all three resource kinds.

## Acceptance Criteria

- `/tools` renders a mixed overview that supports both discovery and management by showing real discovery shelves and installed-resource previews.
- The default mixed overview exists without a visible `All` tab.
- The mixed overview follows the v1 data contract: discovery hides on catalog failure, and installed preview sections render from existing domain queries or show loading/empty states.
- Skills, Plugins, and Automations use a cohesive layout, taxonomy, and interaction model.
- Resource rows map to the five facets without conflating source, scope, and agents.
- Healthy rows stay quiet; disabled, failed, configuration, and unavailable states appear only when meaningful on rows or detail pages.
- Shared components cover repeated resource surface patterns rather than duplicating layouts per page.
- Installed resources are represented as rows designed for scanning and management.
- Discovery/catalog/template content does not masquerade as installed resources.
- Detail pages use a shared layout and aligned metadata taxonomy while allowing resource-specific content.
- Unavailable install/create actions explain what setup is missing.
- Hover-revealed row actions are also reachable through keyboard focus.
- Install/create success gives explicit feedback and preserves user context.
- Provider-specific plugin rows and their underlying skills are cross-linked or otherwise explained.
- Ladle stories show the overview page, overview component system, detail component system, and skills.sh discovery system using shipped components where possible.
- Typecheck stays green for the app, shared UI, automations plugin, and SDK packages.

## Review Notes

This spec is intentionally retroactive. It captures the product direction emerging from PR #407 feedback, Fable approval from `thr_spwq9hzizv`, and Fable `/crit` ship verdict from `thr_p65beeca6n`.
