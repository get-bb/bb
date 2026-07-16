# bb plugin API and SDK reference

Status: final Plugin 1.0 contract reference<br>
Snapshot date: 2026-07-14<br>
Integrated source base: `e185d27094eab68b2f39d5ca50923c009e773d45`<br>
Plugin SDK and product versions at this source snapshot: `@bb/plugin-sdk` is `0.3.0`; this document fixes the contract selected for the eventual 1.0 compatibility boundary while keeping it on a pre-1.0 compatibility line.

## Purpose and coverage

This is the exhaustive contract map selected for the bb plugin platform's 1.0 compatibility promise. It covers:

1. plugin packaging and manifest fields;
2. every callable member of the backend `BbPluginApi`;
3. every frontend `@bb/plugin-sdk/app` runtime export, slot, prop contract, and callback;
4. every method reachable through `bb.sdk`, including nested thread APIs and realtime;
5. the standalone `@bb/sdk` constructors and errors relevant to consumers;
6. every public driver and inspection API in the official backend and frontend testing harnesses;
7. the exported type surface and the compatibility/lifecycle rules that make those types meaningful;
8. routing, parity, security, registration, reload, and compatibility policy.

The authoritative source files for this snapshot are:

- `packages/plugin-sdk/src/backend-contract.ts`
- `packages/plugin-sdk/src/app-contract.ts`
- `packages/plugin-sdk/src/app.ts`
- `packages/plugin-sdk/src/testing/index.ts`
- `packages/plugin-sdk/src/testing/app.tsx`
- `packages/sdk/src/core.ts`
- `packages/sdk/src/areas/*.ts`
- `packages/sdk/src/realtime-types.ts`
- `packages/server-contract/src/api/*.ts`
- `packages/domain/src/plugin-manifest.ts`
- `apps/server/src/services/plugins/manifest.ts`
- `apps/server/src/services/plugins/plugin-api.ts`
- `apps/app/src/lib/plugin-sdk-app-impl.tsx`
- `apps/app/src/views/PluginPanelView.tsx`

The committed root/app declarations under `packages/plugin-sdk/bundled-types/` are copied into newly scaffolded external plugins. The testing declarations ship with the installed package and reuse its public root declaration rather than duplicating the full SDK contract. Differences between any bundled declaration and its source contract are release-significant.

## Surface at a glance

| Layer | Public surface in this snapshot |
| --- | --- |
| Manifest | package identity plus required `bb.name`, `bb.description`, explicit branding, server/app entries, skills, and themes |
| Backend plugin API | complete root and nested logging, settings, storage, wire, background, CLI, agent, UI/input, event, host, status, server, SDK, and disposal capabilities |
| Frontend app SDK | 7 runtime exports and 9 registration slots |
| `bb.sdk` | 144 callable paths across 13 named areas plus realtime `subscribe()` |
| Backend testing | externally shipped fake host, fake SDK, fixture builder, behavior/inspection/lifecycle views |
| Frontend testing | runtime installer, app loader, slot renderer, realtime driver, and call logs |

## Compatibility model

- Plugins are full-trust TypeScript packages loaded in-process by the bb server.
- `engines.bb` describes compatible bb product versions.
- `engines.bbPluginSdk` describes compatible plugin SDK versions. The current advertised version is `0.3.0`; the scaffold emits `^0.3.0`.
- This release line does not publish 1.0. It advances the pre-1.0 SDK compatibility boundary from `0.2.x` to `0.3.x`; the source snapshot remains `0.x`.
- Before 1.0 there is no compatibility promise: additions may land in a minor release, and breaking removals, renames, DTO changes, validation changes, or host-behavior changes require a documented deprecation/removal decision and the appropriate pre-1.0 minor bump. Never silently reinterpret an existing field or routing default.
- Once 1.0 is declared, additive optional fields and new methods are compatible; removing or renaming a symbol, making an optional input required, narrowing accepted values, changing a result's meaning, error code, lifecycle ordering, security boundary, routing classification, or documented fallback is breaking and requires the next major. Deprecations remain functional for at least one documented migration window before removal.
- **D1 — SDK scope:** all of `BbSdk` reachable as `bb.sdk`, including administrative areas, is the supported full-trust plugin contract. There is no narrower capability facade.
- **D2 — testing and distribution:** `@bb/plugin-sdk`, `/app`, `/testing`, and `/testing/app` are shipped package entrypoints with portable bundled declarations and are all covered by the compatibility policy.
- Artifact metadata stores `sdkMajor` and `sdkVersion`. While every `0.x` release has major `0`, engine ranges remain the pre-1.0 compatibility gate; managed installs refuse mismatches and path installs report them.
- `bb plugin build` stamps `sdkMajor`, `sdkVersion`, `artifactFormatVersion`, plugin identity/version, and `builtWith` into server and app artifact metadata.
- Frontend slot prop contracts are intended to be additive-only within an SDK major.
- Backend root imports must be type-only. The server supplies the runtime `bb` object; plugin source must not expect a runtime module implementation from `@bb/plugin-sdk`.
- Frontend imports from `@bb/plugin-sdk/app` are runtime imports replaced by the build shim and resolved from `globalThis.__bbPluginRuntime.pluginSdkApp` inside bb.

## Plugin package and manifest

The manifest is the plugin package's `package.json`.

| Field | Required | Contract |
| --- | --- | --- |
| `name` | yes | npm package name. Plugin id is the name with a leading `bb-plugin-` removed and then sanitized by `derivePluginId`. |
| `version` | yes | plugin version string; artifact identity metadata must match it. |
| `description` | no | npm metadata only; plugin UI identity comes from required `bb.description`. |
| `engines.bb` | no | semver range for compatible bb product versions. |
| `engines.bbPluginSdk` | no | valid semver range for the plugin SDK. Absence means a legacy manifest. |
| `bb.server` | yes | manifest-relative backend entry. It must exist and remain inside the plugin root. |
| `bb.app` | no | manifest-relative frontend entry. Built into `dist/app.js` and `dist/app.css`. |
| `bb.name` | yes | trimmed, non-empty human-facing name used on host-rendered plugin surfaces. |
| `bb.description` | yes | trimmed, non-empty human-facing description used in plugin management. |
| `bb.branding` | yes | strict object containing at least `icon` or `logo.light`. There is no implicit root-logo discovery and no legacy top-level `bb.icon`, `bb.logo`, or `bb.logoDark`. |
| `bb.branding.icon` | conditional | non-empty host icon-name hint used on compact surfaces even when a logo is also present. If it is omitted, compact surfaces fall back to a contribution icon where available and then the generic plugin icon; unknown hints also render the generic icon. |
| `bb.branding.logo.light` | conditional | manifest-relative `.svg`, `.png`, or `.webp` branded asset. Required when `branding.logo` exists. The host uses it in light mode and as dark-mode fallback. |
| `bb.branding.logo.dark` | no | manifest-relative dark-mode `.svg`, `.png`, or `.webp`; only valid beside `logo.light`. |
| `bb.skills` | no | array of manifest-relative skill roots. Default is `['skills']`; `[]` opts out; a trailing `/*` is ignored. |
| `bb.themes` | no | array of `{ id, name, description?, css }`; ids are unique and match `[a-zA-Z0-9][a-zA-Z0-9._-]*`, maximum 64 characters; CSS paths must exist inside the plugin root. |

`bb` is strict: unknown fields fail manifest validation. Manifest paths must be non-empty and relative, may not escape the plugin directory lexically or through a branding symlink, and declared server/branding/theme files must exist. Branding assets must be files with an allowed extension; theme CSS must end in `.css`; duplicate theme ids fail. The server entry is required and must exist; the optional app entry is resolved under the same root. Builtin-reserved ids cannot be installed from non-builtin sources. Manifest errors are human-readable and put the plugin in an install/load error rather than accepting ignored fields.

## Backend entry and lifecycle

```ts
import type { BbPluginApi } from "@bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  // Register the plugin's surfaces.
}
```

The factory runs on initial load, enable, and reload and has a 30-second time box. A thrown initial factory error puts the plugin into `error`; `bb.status.needsConfiguration()` is the non-error path for missing configuration. Reload is atomic: the host first builds a complete candidate registration set. If that factory throws, the prior load stays live. Only a successful candidate replaces it.

After a replacement factory succeeds—or directly on disable/shutdown—the host:

1. aborts background services and waits for bounded shutdown;
2. runs `onDispose` hooks in last-in-first-out order, isolating each hook;
3. drains in-flight HTTP, RPC, and event handlers;
4. closes every tracked SQLite handle;
5. invalidates the old `bb` handle;
6. publishes the candidate registration set as the new live load.

Using an invalidated handle throws `PluginContextStaleError`. Do not keep `bb` in module-level state across loads.

## Backend `BbPluginApi`

### Root properties

| Property | Type/purpose |
| --- | --- |
| `pluginId` | read-only id for the current plugin; namespaces storage, settings, routes, and contributions. |
| `log` | plugin-scoped logger. |
| `settings` | declarative settings registry. |
| `storage` | namespaced KV and per-plugin SQLite. |
| `http` | exact-match HTTP routes. |
| `rpc` | local-auth JSON RPC for the plugin frontend. |
| `realtime` | ephemeral frontend signals. |
| `background` | services and cron schedules. |
| `cli` | one agent/human-facing top-level `bb` command. |
| `agents` | native tools plus conditional tool/skill/instruction selection. |
| `ui` | blocking request input plus host-rendered thread actions and mention providers. |
| `events` | additive thread lifecycle listeners. |
| `status` | plugin-reported status. |
| `server` | read-only server facts. |
| `hosts` | server-to-daemon shared-port control plane. |
| `sdk` | complete `BbSdk`, documented later. |
| `onDispose` | registers load-scoped cleanup hooks. |

### `bb.log`

| Method | Signature | Behavior |
| --- | --- | --- |
| `debug` | `(message: string) => void` | debug line |
| `info` | `(message: string) => void` | informational line |
| `warn` | `(message: string) => void` | warning line |
| `error` | `(message: string) => void` | error line |

All four write to the server log with a plugin prefix and to the plugin's rotated JSONL log at `<dataDir>/plugins/<id>/logs/plugin.log`. `bb plugin logs <id>` reads this stream.

### `bb.settings`

| Method | Signature | Behavior |
| --- | --- | --- |
| `define` | `<Ds>(descriptors: Ds) => PluginSettingsHandle<Ds>` | validates and registers descriptors; the returned handle is typed from the descriptor object. |
| handle `get` | `() => Promise<PluginSettingsValues<Ds>>` | gets current effective values; safe during factory load. |
| handle `onChange` | `(listener: (next, prev) => void) => void` | runs after a settings save. |

Descriptor variants:

- string: `{ type: 'string', label, description?, secret?: true, default?: string }`
- boolean: `{ type: 'boolean', label, description?, default?: boolean }`
- select: `{ type: 'select', label, description?, options: string[], default?: string }`
- project: `{ type: 'project', label, description?, default?: string }`

Keys use letters, digits, `-`, and `_`. A descriptor with a default produces a non-optional value. Without a default, `get()` returns `undefined` when unset. Secret string values live in mode-0600 files, never in the database or frontend settings hook. A save does not reload a healthy or degraded plugin; its live `onChange` listeners receive the update. A save for a `needs-configuration` plugin automatically retries plugin load so valid configuration can recover it.

### `bb.storage`

| Method | Signature | Behavior |
| --- | --- | --- |
| `kv.get` | `<T>(key: string) => Promise<T | undefined>` | reads a JSON value. |
| `kv.set` | `(key: string, value: unknown) => Promise<void>` | writes a JSON value, maximum 256 KiB. |
| `kv.delete` | `(key: string) => Promise<void>` | removes a key. |
| `kv.list` | `(prefix?: string) => Promise<string[]>` | lists keys, optionally by prefix. |
| `database` | `() => Database.Database` | opens/reuses `<dataDir>/plugins/<id>/data.db` using WAL and a 5-second busy timeout. |
| `migrate` | `(db, statements: string[]) => void` | applies unapplied statements transactionally; array index is the migration id. |

Migration arrays are append-only. Released statements must never be edited, reordered, or removed. SQLite handles are host-tracked and closed on disposal.

### `bb.http`

`route(method, path, handler, opts?) => void`

- Exact route only; no parameters or wildcards.
- Mounted at `/api/v1/plugins/<id>/http/<path>`.
- Handler is `(context: Hono.Context) => Response | Promise<Response>`.
- `opts.auth` defaults to `local`.
- `local`: only a local bb app origin; non-GET requests require JSON content type.
- `token`: requires the plugin token in `x-bb-plugin-token` or `?token=`.
- `none`: no host authentication; intended only for routes that verify their own webhook signature.

### `bb.rpc`

`register(contract, handlers) => void`, where `contract` maps each method name to `{ input, output }` Standard Schema v1 validators. `defineRpcContract()` preserves exact schema types; Zod 4 implements Standard Schema directly. `PluginRpcHandlers<typeof contract>` gives each handler the parsed input type and checks its promised output against the output schema's input type. A type-only shared contract plus `useRpc<typeof contract>()` gives the frontend exact method, argument, and result inference.

Each handler is exposed at `POST /api/v1/plugins/<id>/rpc/<method>` with local auth. Processing is fixed: parse JSON, find the method, validate input, invoke the handler, validate output, then strictly serialize JSON. Success is `{ ok: true, result }`; failure is `{ ok: false, error: { code, message, issues? } }`. Stable error codes are `invalid_json`, `unknown_method`, `invalid_input`, `handler_error`, `invalid_output`, and `non_json_result`. Validation issues contain a message and optional string/number path. Cyclic values, non-finite numbers, bigint, symbols, functions, undefined object properties, and invalid array entries fail instead of being silently coerced. Backend runtime, frontend client, HTTP envelope, bundled declarations, and the fake host share these semantics.

### `bb.realtime`

`publish(channel: string, payload: unknown) => void`

Broadcasts an ephemeral `{ pluginId, channel, payload }` plugin signal to all connected clients. The public input is `unknown`, then the host normalizes it through `JSON.stringify`/`JSON.parse`: `undefined` becomes `null`, JSON coercions apply, prototypes/getters are removed, and a value that cannot produce JSON throws at the publish site. Nothing is persisted. Use the signal as invalidation and refetch durable data through RPC.

### `bb.background`

| Method | Signature | Behavior |
| --- | --- | --- |
| `service` | `(name, { start(signal) }) => void` | starts after the factory finishes; aborts on reload/disable/shutdown; crashes restart with capped exponential backoff. |
| `schedule` | `(name, cron, fn) => void` | registers a durable five-field, server-local-time cron row; jobs run only while the plugin is loaded. |

Throwing an error named `NeedsConfigurationError` from a service marks the plugin `needs-configuration` and stops restart attempts until the next load. A schedule error only updates that schedule's `last_status` and `last_error`.

### `bb.cli`

`register(registration: PluginCliRegistration) => void`

Exactly one top-level command may be registered per factory execution. A second call is a duplicate-registration error; it does not replace the first.

`PluginCliRegistration` contains:

- `name`: lowercase `[a-z0-9-]+`, excluding core/reserved command names;
- `summary`: command summary used by help and agent discovery;
- `commands?`: `{ name, summary, usage }[]` metadata for subcommands;
- `run(argv, ctx)`: returns `{ exitCode, stdout?, stderr? }` synchronously or asynchronously.

`argv` excludes the command name. `ctx` is `{ cwd?, threadId?, projectId?, signal? }`; the signal aborts if the invoking HTTP request disconnects. Plugin command metadata is injected into agents through the generated `plugin-commands` skill.

### `bb.ui.requestInput`

`requestInput(request, options?) => Promise<PluginInteractionResult>`

Request:

```ts
{
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  timeoutMs?: number; // default 10 minutes; max 1 hour
}
```

Options are `{ signal?: AbortSignal }`. Result is either `{ outcome: 'submitted', value: JsonValue }` or `{ outcome: 'cancelled', reason }`. Cancellation reasons are `user`, `request-aborted`, `thread-stopped`, `thread-deleted`, `plugin-disposed`, `server-restarted`, or `timeout`. Payloads and response values are capped at 64 KiB; submitted values go only to the waiting invocation and are not persisted.

### `bb.agents`

| Method | Signature | Behavior |
| --- | --- | --- |
| `configure` | `(provider: (context) => { tools, skills, instructions? }) => void` | conditionally selects this plugin's static tools and manifest skills and optionally adds dynamic instructions. |
| `registerTool` | zod overload or raw JSON-schema overload | registers a provider-native tool. |
| `contributeInstructions` | `(provider: ({ threadId, projectId }) => string | null) => void` | legacy synchronous dynamic instructions; excluded from side chats. |

Tool registration fields are `name`, `description`, optional `instructions`, `parameters`, and `execute(params, ctx)`. Names match `[a-zA-Z0-9_-]+`, are unique across plugins, and cannot collide with built-in dynamic tools. A duplicate within one load is rejected; across plugins the earlier plugin wins and the later collision is recorded in status.

With zod parameters, arguments are parsed and `execute` receives `z.output<Schema>`. With a plain JSON Schema object, `execute` receives unvalidated `unknown`. Tool context is `{ threadId, projectId, signal }`. Results are either a string or `{ content: ({ type: 'text', text } | { type: 'image', data, mimeType })[], isError? }`.

`configure` receives required plain-data `thread`, `project`, `environment`, `host`, and `{ id, model }` provider records plus `sideChat` and origin `{ kind, pluginId }`; absent values are explicit `null`. It may select only this plugin's registered tool names and manifest skill names. Duplicate/unknown ids, malformed output, more than 256 ids in either list, or a throw fail closed for this plugin. Tools apply when the provider session next starts/resumes, instructions on the next turn, and skills at the daemon's safe runtime-relaunch boundary. Side chats invoke `configure` with `sideChat: true` and honor its selections at those same boundaries.

Static tool instructions and both dynamic instruction channels cap at 4096 characters. `configure` and the legacy instruction provider are synchronous and may each be registered once. The legacy provider contributes nothing to side chats; a throw is logged and otherwise ignored.

### `bb.ui`

| Method | Signature | Behavior |
| --- | --- | --- |
| `requestInput` | `(request, { signal? }?) => Promise<PluginInteractionResult>` | waits for the matching frontend `pendingInteraction` renderer to submit or cancel. |
| `registerThreadAction` | `(action: PluginThreadActionRegistration) => void` | adds a server-run thread-header action. |
| `registerMentionProvider` | `(provider: PluginMentionProviderRegistration) => void` | adds composer mention search and send-time resolution. |

Thread action fields:

- `id`: unique per plugin, `[a-zA-Z0-9_-]+`;
- `title`;
- optional `icon` and confirmation string;
- `run({ threadId, projectId })`, returning void or `{ toast?: { kind: 'success' | 'error' | 'info', message } }`.

Mention provider fields:

- `id`: unique per plugin, `[a-zA-Z0-9_-]+`;
- `label`;
- optional unique non-empty `triggers`, drawn from `@ # $ ! ~`, default `@`;
- `search({ trigger, query, projectId, threadId })` returning `{ id, title, subtitle?, icon? }[]`;
- `resolve(itemId)` returning `{ context: string }`.

Search is server-side, failure-isolated, and limited to two seconds. Resolution runs once per unique selected item when the message is sent. A resolution error blocks the send.

### `bb.status`

`needsConfiguration(message: string) => void`

Marks the plugin `needs-configuration` instead of failing it. The state clears on the next successful load. The message should tell the user what to configure; saving settings automatically retries load for a plugin in this state, while an explicit reload remains available for other recovery cases.

### `bb.server`

`loopbackBaseUrl: string` is the server's loopback URL serving the SPA, `/api`, and `/ws`. It is bind-gated: reading before the host is listening throws. Prefer reading it inside handlers, services, and timers.

### `bb.hosts`

| Method | Signature | Behavior |
| --- | --- | --- |
| `ensureSharedPortTunnel` | `(hostId: string) => Promise<{ label, baseDomain }>` | ensures/reads the enrolled host's trusted public tunnel identity. |
| `declareSharedPorts` | `(hostId: string, ports: readonly number[]) => void` | replaces this plugin's desired shared-loopback-port set for the host. |

Ports must be integers from 1 through 65535. The server deduplicates and sorts the aggregate declaration and owns its generation. Declarations are load-scoped and are cleared after dispose hooks during unload. Plugins do not choose the tunnel domain or receive daemon socket/streaming primitives.

### `bb.events.on`

`events.on(event, handler) => void` observes exactly five thread lifecycle events:

| Event | Payload |
| --- | --- |
| `thread.created` | `{ thread: ThreadResponse }` |
| `thread.active` | `{ thread: ThreadResponse }` |
| `thread.idle` | `{ thread: ThreadResponse, lastAssistantText: string | null }` |
| `thread.failed` | `{ thread: ThreadResponse, error: string | null }` |
| `thread.deleted` | `{ thread: ThreadResponse }` |

Listeners are additive and run independently in registration order after the transition. `thread.active` fires when an applied lifecycle transition enters the `active` running state. Listeners cannot veto or delay transitions. Errors are caught, logged, and counted in plugin handler stats.

### `bb.onDispose`

`onDispose(hook: () => void | Promise<void>) => void`

Registers cleanup for reload, disable, or shutdown. Hooks run in last-in-first-out order and are isolated. On reload, old hooks run only after the replacement candidate succeeds.

### Registration and reload matrix

| Surface | Duplicate in one factory execution | Multiple entries/listeners | Reload behavior |
| --- | --- | --- | --- |
| settings descriptors, HTTP method+path, RPC method, service name, schedule name | rejected | distinct keys are allowed | candidate set replaces the old set atomically |
| CLI command, `agents.configure`, `agents.contributeInstructions` | a second registration is rejected | exactly one of each per load | old registration remains live if candidate factory fails |
| native agent tool name | duplicate in one plugin rejected; cross-plugin earlier owner wins and later tool is dropped with status detail | distinct tool names allowed | session tool set changes only at next start/resume |
| thread-action id, mention-provider id, frontend slot kind+id/path/extension ownership | duplicate rejected | distinct ids allowed | backend candidate or frontend app interpretation replaces that plugin's complete prior set |
| `events.on`, settings `onChange`, `onDispose` | not a keyed duplicate | additive in registration order; dispose is LIFO | all listeners/hooks belong to one load and are discarded after successful swap/disposal |
| `hosts.declareSharedPorts(hostId, ports)` | not additive for the same plugin+host | each call replaces that plugin's desired set for the host | declarations are load-scoped and cleared after old dispose hooks |

Initial load failure exposes no partial registrations. Reload factory failure keeps every old registration, handler, service, and API handle live. After a successful candidate, the host performs bounded old-load teardown and publishes the candidate wholesale; stale captured API handles then throw `PluginContextStaleError`.

## Frontend `@bb/plugin-sdk/app`

The app entry default-exports the result of `definePluginApp`. React and the SDK are host-shimmed and never bundled. UI components are not an SDK surface: external plugins vendor shadcn-style source; builtin plugins use `@bb/shared-ui`. `sonner`, selected Radix packages, `vaul`, and `@pierre/diffs` are runtime-shimmed shared dependencies.

### Runtime exports

These are the seven intended runtime exports:

| Export | Signature | Purpose |
| --- | --- | --- |
| `definePluginApp` | `(setup: PluginAppSetup) => PluginAppDefinition` | brands and returns the app definition consumed by the host. |
| `useRpc` | `<Contract>() => PluginRpcClient<Contract>` | calls this plugin's schema contract with inferred method arguments/results; rejects with `code` and optional `issues`. |
| `useRealtime` | `(channel, handler) => void` | subscribes while mounted to this plugin's signal channel. |
| `useSettings` | `() => { values, isLoading }` | reads effective non-secret settings. |
| `useBbContext` | `() => { projectId, threadId }` | reads current route selection; ids may be null. |
| `useBbNavigate` | `() => BbNavigate` | navigates to bb and plugin routes. |
| `useComposer` | `() => PluginComposerApi` | reads and arbitrarily edits the scoped shared composer draft. |

The packaged runtime module, app shim, and bundled declaration expose exactly these seven values; registration regexes are host-internal implementation details, not author-importable runtime values.

### Navigation hook

| Method | Signature |
| --- | --- |
| `toThread` | `(threadId: string) => void` |
| `toProject` | `(projectId: string) => void` |
| `toPluginPanel` | `(path: string, { subPath?, replace? }?) => void` |
| `toCompose` | `({ initialPrompt?, focusPrompt? }?) => void` |

`toPluginPanel` targets a nav panel owned by the calling plugin. `replace` replaces history instead of pushing. `toCompose` opens the root new-thread surface and may seed/focus the prompt.

### Composer hook

| Member | Contract |
| --- | --- |
| `scope` | `{ kind: 'thread', threadId }` or `{ kind: 'new-thread', projectId }` |
| `text` | current plain-text draft snapshot for the scope. |
| `setText(next)` | replaces plain text; preserves attachments and rebases unaffected inline mentions, removing only mentions overlapped by the edit. |
| `updateText(updater)` | computes a replacement from the latest committed text using the same reconciliation. |
| `clear()` | clears text and inline mentions without clearing independently attached files. |
| `addQuote(text)` | appends text as a blockquote block and focuses the composer; blank text is a no-op. |
| `insertMention({ provider, id, label })` | inserts a pill bound to one of this plugin's backend mention providers. |
| `focus()` | focuses the caret at the end of the draft. |

### Slot registrations

`app.slots` exposes exactly nine registration methods.

#### `homepageSection`

Registration: `{ id, title, component }`<br>
Component props: `{ projectId: string | null }`

Renders on the root compose surface. `id` is unique per plugin and matches `[a-zA-Z0-9_-]+`.

#### `settingsSection`

Registration: `{ id, title?, description?, component }`<br>
Component props: `{}`

Renders below the host's declarative settings form on `/settings/plugins/<pluginId>`. `description?: string` is intentionally optional and is a supported contract field; the host renders it only with that custom section's optional `title`. Secret values never appear in `useSettings()`.

#### `navPanel`

Registration: `{ id, title, icon, path, component, headerContent? }`<br>
Component and header props: `{ subPath: string }`

The panel owns `/plugins/<pluginId>/<path>/*`; `subPath` is the trailing route or `''` at the root. The host always renders the compact plugin icon and `title` in the shared app header. Optional `headerContent` renders on the header's right and has its own crash boundary. The plugin component owns the full-bleed body below with zero host padding and must add its own padding and scrolling; it should not repeat the title.

#### `threadPanelAction`

Registration: `{ id, title, icon?, component, run? }`<br>
Component props: `{ threadId: string, params: JsonValue | null }`<br>
Run context: `{ threadId, openPanel(options?) }`

The action appears in the thread panel's new-tab launcher. Without `run`, activation opens the component immediately. `openPanel({ title?, params?: JsonValue })` may open zero, one, or multiple tabs. Params round-trip through persistence; equal action+params focuses an existing tab, different params create siblings, and omitted params arrive as `null`.

#### `composerAccessory`

Registration: `{ id, component }`<br>
Component props: `{ projectId: string | null, threadId: string | null }`

Renders in the composer footer.

#### `pendingInteraction`

Registration: `{ id, component }`<br>
Component props: `{ interaction, submit, cancel }`

`id` matches the backend request's `rendererId`. `interaction` is `{ id, threadId, title, payload, createdAt, expiresAt }`. `submit(JsonValue)` and `cancel()` return promises. The component replaces the composer while its interaction is pending; sensitive form state should remain local to the component.

#### `sidebarFooterAction`

Registration: `{ id, title, icon, run }`<br>
Run context: `{ openSettings(): void }`

The host renders the button and chrome. `title` is both tooltip and accessible label. Throws are contained and logged.

#### `fileOpener`

Registration: `{ id, title, extensions: readonly string[], component }`<br>
Component props: `{ path, source }`

Extensions are lowercase without dots. Source is `{ kind: 'workspace' | 'host' | 'thread-storage', threadId, environmentId, projectId }`; ids are nullable. Workspace paths are worktree-relative, host paths absolute, and thread-storage paths storage-relative. Openers apply to live content, not git snapshots or deleted files. Disabled or missing openers fall back to the built-in preview.

#### `messageDirective`

Registration: `{ id, component }`<br>
Component props: `{ attributes, source, message, openWorkspaceFile, openThreadPanel? }`

Ids are lowercase kebab-case beginning with a letter and match `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`. An id such as `inline-vis` handles `::inline-vis{file="demo.html"}` in assistant or nested-agent Markdown.

- `attributes`: read-only untrusted string map; validate it.
- `source`: original directive text used for diagnostics/fallback.
- `message`: `{ id, threadId, turnId: string | null, projectId: string | null }`.
- `openWorkspaceFile`: nullable `(path: string) => boolean` for worktree-relative paths.
- `openThreadPanel`: optional/nullable `({ actionId, title?, params?: JsonValue }) => boolean` targeting this plugin's own thread action.

Unknown, disabled, malformed, incomplete, code-fenced, conflicting, or crashing directives render their original source. Each slot is wrapped in an error boundary; a normal slot crash collapses to a plugin crash chip, while a message directive crash falls back to source.

### Frontend validation and security boundary

Slot ids and nav paths use letters, digits, `_`, and `-`; directive ids use lowercase kebab case; file extensions are normalized lowercase names without a dot. Duplicate ids/paths and invalid registrations fail app interpretation before a partial set is installed. Registration patterns are host-internal and are intentionally absent from the seven-value runtime surface.

`@bb/plugin-sdk/app` is deliberately narrower than backend `BbPluginApi`: it exposes only this plugin's RPC client and realtime channels, non-secret settings, route context/navigation, composer editing, and registered slot callbacks. It does not expose `bb.sdk`, storage, secret settings, files, terminals, plugin administration, host control, agent registration, server URLs, HTTP tokens, or arbitrary backend capabilities. Privileged operations must be implemented in the full-trust backend and exposed through a schema-validated plugin RPC method. This is an API/capability boundary, not a claim that third-party JavaScript shares no browser process: install only trusted plugins, validate every RPC/directive/panel input, and use sandboxed iframes for untrusted HTML.

## `bb.sdk`: complete SDK reachable by plugins

`bb.sdk` is bind-gated like `bb.server.loopbackBaseUrl`. The production server binds it before plugin factories load, but portable plugins should read it from handlers/services/timers because isolated hosts may bind later. `threads.spawn` automatically defaults `origin` to `plugin` and `originPluginId` to the current plugin id.

Every SDK area exports concrete, portable, named argument and result DTO aliases from the `@bb/sdk` root, browser, and core entrypoints. Generated plugin declarations intentionally do not expose route-derived `PublicApiOutput<Path, Method>` aliases, so external consumers never depend on server-route implementation types. The descriptive tables below plus the exact signature inventory near the end are the full callable surface.

### `sdk.environments` — 16 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `archiveThreads` | `{ environmentId }` | archives threads belonging to an environment. |
| `commit` | `{ environmentId }` | runs the environment commit action. |
| `diff` | `EnvironmentDiffArgs` | gets a diff for `uncommitted`, `branch_committed`, `all`, or a commit SHA. |
| `diffBranches` | `{ environmentId, query?, limit? }` | lists/searches branches usable for comparison. |
| `diffFile` | `EnvironmentDiffFileArgs` | reads one side of a file for a selected diff target. |
| `diffFiles` | `EnvironmentDiffArgs` | lists changed files for a selected target. |
| `diffPatch` | `EnvironmentDiffPatchArgs` | creates/returns a patch for the selected environment diff. |
| `get` | `{ environmentId }` | gets an environment. |
| `pullRequest` | `{ environmentId }` | gets pull-request state. |
| `markPullRequestDraft` | `{ environmentId }` | marks its PR draft. |
| `markPullRequestReady` | `{ environmentId }` | marks its PR ready. |
| `mergePullRequest` | `{ environmentId, method }` | merges its PR with a `PullRequestMergeMethod`. |
| `paths` | `EnvironmentPathsArgs` | gets environment path metadata. |
| `squashMerge` | `{ environmentId, mergeBaseBranch }` | squash-merges into the requested base branch. |
| `status` | `{ environmentId, mergeBaseBranch? }` | gets working-copy and branch status. |
| `update` | `{ environmentId, name?, mergeBaseBranch? }` | updates name and/or merge-base branch; at least one update field is required by the union. |

Diff target shapes are discriminated: `uncommitted`; `branch_committed`/`all` with a merge base; or `commit` with `sha`. `diffFile` also includes `path` and `side`.

### `sdk.files` — 8 methods

All methods accept optional `hostId`; omission selects the primary/local host. Mutations accept optional `rootPath` confinement.

| Method | Arguments | Purpose |
| --- | --- | --- |
| `read` | `{ hostId?, path, rootPath? }` | reads content, encoding, hash, size, and metadata. |
| `write` | `{ hostId?, path, rootPath?, content, contentEncoding?, createParents?, expectedSha256?, mode? }` | writes up to 25 MiB with optional CAS. |
| `list` | `{ hostId?, path, query?, limit? }` | recursive fuzzy file listing. |
| `listPaths` | previous fields plus `includeFiles`, `includeDirectories` | recursive relative path/kind listing. |
| `mkdir` | `{ hostId?, path, rootPath?, recursive? }` | creates a directory. |
| `move` | `{ hostId?, sourcePath, destinationPath, rootPath? }` | moves without replacing an existing destination. |
| `remove` | `{ hostId?, path, rootPath?, recursive? }` | removes a file or directory; non-empty directories require recursive. |
| `createPreview` | `{ hostId?, rootPath, ttlMs? }` | creates an expiring path-shaped browser preview base URL. |

`contentEncoding` defaults to `utf8`; `createParents` defaults false. `expectedSha256` omitted means unconditional, a string means compare-and-swap, and `null` means create-only. A failed guard returns a conflict outcome instead of overwriting.

### `sdk.guide` — 1 method

| Method | Arguments | Purpose |
| --- | --- | --- |
| `render` | `{ chapter?: string }` | synchronously renders the overview or one of `threads`, `environments`, `agent-configuration`, `providers`, `projects`, `machines`, `customization`, or `plugins`. |

This is static template rendering and does not use the transport.

### `sdk.hosts` — 11 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `createJoinCode` | none | creates a machine enrollment code. |
| `delete` | `{ hostId }` | removes a host; returns `{ ok: true }`. |
| `directory` | `{ hostId, path }` | lists/browses a host directory. |
| `get` | `{ hostId }` | gets one host. |
| `cloneDefaultPath` | `{ hostId, projectId }` | resolves the default clone destination. |
| `installProviderCli` | `{ hostId, provider, actionKind }` | installs a provider CLI and returns parsed install events. |
| `list` | none | lists hosts. |
| `pathsExist` | `{ hostId, ...HostPathsExistRequest }` | checks paths on the host. |
| `pickFolder` | `{ hostId, clientHostId }` | requests the native folder picker. |
| `providerCliStatus` | `{ hostId }` | gets provider CLI installation status. |
| `update` | `{ hostId, name }` | renames/updates a host. |

### `sdk.projects` — 18 methods including `attachments` and `sources`

| Method | Arguments | Purpose |
| --- | --- | --- |
| `attachments.read` | `ProjectAttachmentReadArgs` | reads a server-managed attachment as bytes plus MIME type and size. |
| `attachments.upload` | `ProjectAttachmentUploadArgs` | uploads client-local bytes/File-like input and returns `UploadedPromptAttachment`. |
| `branches` | `ProjectBranchesArgs` | lists/searches branches. |
| `commands` | `ProjectCommandsArgs` | gets project command suggestions. |
| `create` | `CreateProjectRequest` | creates a project. |
| `defaultExecutionOptions` | `{ projectId }` | gets project-level default provider/model/reasoning options. |
| `delete` | `{ projectId }` | deletes a project. |
| `fileContent` | `ProjectFileContentArgs` | reads workspace text as UTF-8 or binary as base64 with MIME type and size. |
| `files` | `ProjectFilesArgs` | lists workspace files. |
| `get` | `{ projectId }` | gets a project. |
| `list` | `ProjectListArgs?` | lists ordinary projects by default; pass `{ includePersonal: true }` to also return the singleton personal project. |
| `paths` | `ProjectPathsArgs` | gets project path metadata. |
| `promptHistory` | `{ projectId, ...PromptHistoryQuery }` | gets prompt history. |
| `reorder` | `{ projectId, ...ReorderProjectRequest }` | reorders the project. |
| `update` | `{ projectId, name }` | updates project fields currently forwarded by the SDK. |
| `sources.add` | `{ projectId, ...CreateProjectSourceRequest }` | adds a `local_path` or clone source. |
| `sources.update` | `{ projectId, sourceId, ...UpdateProjectSourceRequest }` | updates a source. |
| `sources.delete` | `{ projectId, sourceId }` | deletes a source. |

For `commands`, `fileContent`, `files`, and `paths`, `ProjectWorkspaceRoutingArgs` permits exactly one of `environmentId` or `hostId`, or neither. An environment selects its owning host/workspace; an explicit host selects that host's project source; omission falls back to the primary host's project source. Attachment upload is client-local and therefore does not use workspace routing; image uploads cap at 10 MiB and other files at 25 MiB. There is no attachment list/remove method.

### `sdk.plugins` — plugin administration and the official catalog

| Method | Arguments | Purpose |
| --- | --- | --- |
| `callRpc` | `{ pluginId, method, input?, outputSchema }` | calls another plugin's RPC and zod-validates its successful result. |
| `applyUpdate` | `{ pluginId }` | applies the compatible update selected for one installed plugin. |
| `checkUpdates` | `{ pluginId? }?` | checks one/all installed plugins for compatible and blocked updates. |
| `disable` | `{ pluginId }` | disables a plugin. |
| `enable` | `{ pluginId }` | enables a plugin. |
| `getSettings` | `{ pluginId }` | gets plugin settings metadata/values as `JsonValue`. |
| `getSource` | `{ pluginId }` | gets normalized source/provenance detail. |
| `install` | `{ source }` | installs from a plugin source string. |
| `catalog.install` | `{ entryId }` | installs an official plugin bundled with the app. |
| `catalog.search` | `{ query }` | searches the bundled official plugins. |
| `catalog.status` | none | reads the bundled official plugin count. |
| `list` | none | lists plugin status as `JsonValue`. |
| `listUpdateResults` | none | reads the most recently persisted update-check results. |
| `reload` | `{ pluginId? }?` | reloads one plugin or all plugins. |
| `remove` | `{ pluginId }` | removes a plugin. |
| `token` | `{ pluginId, rotate? }` | gets or rotates the HTTP token. |
| `updateSettings` | `{ pluginId, values: Record<string, JsonValue> }` | writes settings. |

These administrative methods are intentionally reachable by any full-trust plugin under D1. Install/update operations still enforce source trust prompts at human/CLI entrypoints, compatibility, identity, artifact, and reserved-id rules; the in-process plugin boundary itself is not a capability sandbox.

### `sdk.providers` — 2 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `list` | `ProviderListArgs?` | lists configured providers on an environment host, explicit host, or primary-host fallback. |
| `models` | `ProviderModelsArgs?` | gets model/reasoning/service-tier options on the same host classification, optionally filtered by `providerId`. |

`ProviderHostRoutingArgs` allows `environmentId`, `hostId`, or neither, never both. Environment ownership wins only when explicitly selected; omission deliberately falls back to the primary host.

### `sdk.status` — 1 method

| Method | Arguments | Purpose |
| --- | --- | --- |
| `get` | `{ projectId?, threadId? }` | best-effort aggregate of project, summarized thread, pending todos, and child threads. |

Individual fetch failures become `null` instead of rejecting the aggregate.

### `sdk.system` — 10 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `attention` | none | gets system attention state. |
| `config` | none | gets public system configuration. |
| `executionOptions` | `SystemExecutionOptionsQuery?` | gets available execution options. |
| `reloadConfig` | none | reloads server configuration. |
| `transcribeVoice` | `{ file: Blob, prompt?: string }` | submits multipart audio transcription. |
| `updateExperiments` | `Experiments` | replaces experiment settings. |
| `updateGeneralSettings` | `AppSettings` | updates server-backed general settings. |
| `updateKeyboardSettings` | `AppKeybindingOverrides` | updates keyboard overrides. |
| `usageLimits` | `SystemUsageLimitsQuery?` | gets provider usage/limit data. |
| `version` | `{ force?: boolean }` | gets version/update information; force bypasses normal caching. |

These are also full-trust administrative APIs when reached through a plugin.

### `sdk.theme` — 3 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `get` | none | gets the active resolved app palette. |
| `catalog` | none | gets theme directory, discovered themes, and active palette. |
| `set` | `(selection: ThemeSetInput)` | writes the complete `AppThemeSelection` (`themeId` plus `faviconColor`) atomically and broadcasts the resolved appearance. This is the primary overload. |
| `set` | `(themeId: string)` | compatibility shorthand that activates a built-in or existing custom theme while preserving the active favicon color. |

### `sdk.threadFolders` — 4 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `create` | `CreateThreadFolderRequest` | creates a folder. |
| `delete` | `DeleteThreadFolderRequest` | deletes a folder. |
| `list` | none | lists folders from sidebar bootstrap. |
| `update` | `UpdateThreadFolderRequest` | updates a folder. |

### `sdk.threads` — 42 callable methods including nested areas

#### Root thread methods — 27

| Method | Arguments | Purpose |
| --- | --- | --- |
| `archive` | `{ threadId }` | archives a thread. |
| `archiveAll` | `{ threadId }` | invokes the thread archive-all route. |
| `childSummary` | `{ threadId }` | gets child-agent/thread summary data. |
| `conversationOutline` | `{ threadId }` | gets the conversation outline. |
| `defaultExecutionOptions` | `{ threadId }` | gets defaults inherited for the next turn. |
| `delete` | `{ threadId, ...DeleteThreadRequest }` | soft-deletes/stops according to the route contract. |
| `get` | `{ threadId, include? }` | gets a thread with optional include selection. |
| `list` | `ThreadListArgs?` | lists/filter threads. |
| `markRead` | `{ threadId }` | marks read. |
| `markUnread` | `{ threadId }` | marks unread. |
| `open` | `{ threadId, split?, file }` | asks the app to open/focus a thread and optional file. |
| `output` | `{ threadId }` | gets latest assembled assistant output. |
| `pin` | `{ threadId }` | pins a thread. |
| `promptHistory` | `{ threadId, ...PromptHistoryQuery }` | gets thread prompt history. |
| `reorderPinned` | `{ threadId, ...ReorderPinnedThreadRequest }` | changes pin order. |
| `search` | `ThreadSearchQuery` | searches threads. |
| `send` | `{ threadId, ...SendMessageRequest }` | starts/queues/steers a turn. |
| `spawn` | `ThreadSpawnArgs` | creates a thread and starts its first prompt. |
| `stop` | `{ threadId }` | stops current work. |
| `timeline` | `{ threadId, ...ThreadTimelineQuery }` | gets timeline data. |
| `timelineTurnSummaryDetails` | `{ threadId, ...TimelineTurnSummaryDetailsQuery }` | gets full details for a summarized turn. |
| `storageFiles` | `{ threadId, ...ThreadStorageFilesQuery }` | lists files in thread storage. |
| `storagePaths` | `{ threadId, ...ThreadStoragePathsQuery }` | lists paths in thread storage. |
| `unarchive` | `{ threadId }` | unarchives. |
| `unpin` | `{ threadId }` | unpins. |
| `update` | `{ threadId, title?, folderId?, parentThreadId?, model?, reasoningLevel? }` | updates forwarded thread fields. |
| `wait` | `ThreadWaitArgs` | polls for a target status or event with timeout/unreachable errors. |

`ThreadListArgs` supports `archived`, `excludeSideChats`, `folderId`, `hasParent`, `limit`, `offset`, `originKind`, `parentThreadId`, `projectId`, `sourceThreadId`, and `unfiled`.

`spawn` requires exactly one of `prompt: string` or structured `input`. Other fields come from `CreateThreadRequest` except the SDK restates origin/child attribution fields. Plugin wrapping defaults origin attribution automatically.

`send` accepts the public send request fields: structured `input`, `mode`, optional execution/model/permission/reasoning/service-tier choices, sender thread, and execution input sources.

`wait` is `{ threadId, status? | event?, timeoutMs?, pollIntervalMs? }`. Exactly one status or event target is required. Defaults are a 20-minute timeout and 250 ms poll interval. It throws `ThreadWaitTimeoutError` on timeout and `ThreadWaitUnreachableError` when a terminal/current status cannot reach the requested status by waiting alone.

#### `threads.events` — 2

| Method | Arguments | Purpose |
| --- | --- | --- |
| `list` | `{ threadId, afterSeq?: string, limit?: string }` | lists raw stored thread events. |
| `wait` | `{ threadId, afterSeq?, type, waitMs }` | long-polls for a matching event. |

#### `threads.interactions` — 5

| Method | Arguments | Purpose |
| --- | --- | --- |
| `cancel` | `{ threadId, interactionId }` | cancels a pending interaction. |
| `get` | `{ threadId, interactionId }` | gets one interaction. |
| `list` | `{ threadId }` | lists interactions. |
| `resolve` | `{ threadId, interactionId, resolution }` | resolves with a `PendingInteractionResolution`. |
| `respond` | `{ threadId, interactionId, value: JsonValue }` | submits a JSON response. |

#### `threads.queuedMessages` — 6

| Method | Arguments | Purpose |
| --- | --- | --- |
| `create` | `{ threadId, ...CreateQueuedMessageRequest }` | creates a queued message. |
| `delete` | `{ threadId, queuedMessageId }` | deletes one; returns `{ ok: true }`. |
| `list` | `{ threadId }` | lists queued messages. |
| `reorder` | `{ threadId, queuedMessageId, ...ReorderQueuedMessageRequest }` | reorders one. |
| `send` | `{ threadId, queuedMessageId, ...SendQueuedMessageRequest }` | sends one immediately. |
| `setGroupBoundary` | `{ threadId, ...SetQueuedMessageGroupBoundaryRequest }` | changes queue grouping. |

#### `threads.tabs` — 2

| Method | Arguments | Purpose |
| --- | --- | --- |
| `get` | `{ threadId }` | gets persisted tabs. |
| `update` | `{ threadId, ...UpdateThreadTabsRequest }` | replaces/updates persisted tabs. |

### `sdk.terminals` — 9 methods

| Method | Arguments | Purpose |
| --- | --- | --- |
| `close` | `TerminalCloseArgs` | closes only when clean or force-closes, returning the session. |
| `create` | `TerminalCreateArgs` | creates at exactly one thread/environment/host-path scope. |
| `get` | `{ terminalId }` | gets a terminal independent of scope. |
| `input` | `{ terminalId, dataBase64 }` | sends base64 input. |
| `list` | `{ scope: TerminalListScope }` | lists within exactly one scope. |
| `output` | `TerminalOutputArgs` | reads bounded chunks/bytes after an optional sequence. |
| `rename` | `{ terminalId, title }` | updates the title. |
| `restart` | `{ terminalId }` | replaces it with a shell at the same scope/size/title and returns a new id; the original command is not replayed. |
| `resize` | `{ terminalId, cols, rows }` | resizes the PTY. |

Scopes are discriminated and mutually exclusive: `{ kind: 'thread', threadId }`, `{ kind: 'environment', environmentId }`, or `{ kind: 'host_path', hostId, cwd }`. Host-path creation requires `cwd: string | null` (`null` means the host home); listing may omit `cwd` or use it as an exact filter. Target operations route by `terminalId`, whose server-owned session retains its host/scope. There is no `threads.terminals` compatibility alias.

### `sdk.subscribe` realtime — 1 method

`subscribe(args) => unsubscribe`

| Event | Optional filter | Payload |
| --- | --- | --- |
| `thread:changed` | `threadId` | read-only thread changed message |
| `project:changed` | `projectId` | read-only project changed message |
| `environment:changed` | `environmentId` | read-only environment changed message |
| `host:changed` | `hostId` | read-only host changed message |
| `system:changed` | none | system changed message |
| `system:config-changed` | none | system config changed message |
| `realtime:connection` | none | `{ state, reconnectDelayMs, reconnected }` |

Entity subscriptions open/hold the socket; connection observers do not. A connection listener added after a socket exists receives the latest connection state on the next microtask. The returned function unsubscribes.

### Exact SDK result inventory

All names below are exported portable aliases (except the generic `TOutput`, contract DTOs explicitly named as such, and synchronous guide result). Overloads do not create additional callable paths.

- `environments`: `archiveThreads → EnvironmentArchiveThreadsResult`, `commit → EnvironmentCommitResult`, `diff → EnvironmentDiffResult`, `diffBranches → EnvironmentDiffBranchesResult`, `diffFile → EnvironmentDiffFileResult`, `diffFiles → EnvironmentDiffFilesResult`, `diffPatch → EnvironmentDiffPatchResult`, `get → EnvironmentGetResult`, `pullRequest → EnvironmentPullRequestResult`, `markPullRequestDraft → EnvironmentMarkPullRequestDraftResult`, `markPullRequestReady → EnvironmentMarkPullRequestReadyResult`, `mergePullRequest → EnvironmentMergePullRequestResult`, `paths → EnvironmentPathsResult`, `squashMerge → EnvironmentSquashMergeResult`, `status → EnvironmentStatusResult`, `update → EnvironmentUpdateResult`.
- `files`: `read → FileReadResult`, `write → FileWriteResult`, `list → FileListResult`, `listPaths → PathListResult`, `mkdir → FileMkdirResult`, `move → FileMoveResult`, `remove → FileRemoveResult`, `createPreview → FilePreviewResult`.
- `guide`: `render → GuideRenderResult` synchronously.
- `hosts`: `createJoinCode → HostCreateJoinCodeResult`, `delete → HostDeleteResult`, `directory → HostDirectoryResult`, `get → HostGetResult`, `cloneDefaultPath → HostCloneDefaultPathResult`, `installProviderCli → HostProviderCliInstallResult`, `list → HostListResult`, `pathsExist → HostPathsExistResult`, `pickFolder → HostPickFolderResult`, `providerCliStatus → HostProviderCliStatusResult`, `update → HostUpdateResult`.
- `plugins`: `applyUpdate → PluginApplyUpdateResult`, `callRpc → TOutput`, `checkUpdates/listUpdateResults → PluginCheckUpdatesResult`, `disable → PluginDisableResult`, `enable → PluginEnableResult`, `getSettings → PluginGetSettingsResult`, `getSource → PluginGetSourceResult`, `install/catalog.install → PluginInstallResult`, `list → PluginListResult`, `reload → PluginReloadResult`, `remove → PluginRemoveResult`, `token → PluginTokenResult`, `updateSettings → PluginUpdateSettingsResult`; nested catalog methods return the bundled plugin count or search results.
- `projects`: `branches → ProjectBranchesResult`, `commands → ProjectCommandsResult`, `create → ProjectCreateResult`, `defaultExecutionOptions → ProjectDefaultExecutionOptionsResult`, `delete → ProjectDeleteResult`, `fileContent → ProjectFileContentResult`, `files → ProjectFilesResult`, `get → ProjectGetResult`, `list → ProjectListResult`, `paths → ProjectPathsResult`, `promptHistory → ProjectPromptHistoryResult`, `reorder → ProjectReorderResult`, `update → ProjectUpdateResult`; `attachments.read/upload → ProjectAttachmentReadResult/ProjectAttachmentUploadResult`; `sources.add/delete/update → ProjectSourceAddResult/ProjectSourceDeleteResult/ProjectSourceUpdateResult`.
- `providers`: `list → ProviderListResult`; `models → ProviderModelsResult`.
- `status`: `get → StatusResult`.
- `system`: `attention → SystemAttentionResult`, `config → SystemConfigResult`, `executionOptions → SystemExecutionOptionsResult`, `reloadConfig → SystemReloadConfigResult`, `transcribeVoice → SystemVoiceTranscriptionResult`, `updateExperiments → SystemUpdateExperimentsResult`, `updateGeneralSettings → SystemUpdateGeneralSettingsResult`, `updateKeyboardSettings → SystemUpdateKeyboardSettingsResult`, `usageLimits → SystemUsageLimitsResult`, `version → SystemVersionResult`.
- `terminals`: `close → TerminalCloseResult`, `create → TerminalCreateResult`, `get → TerminalGetResult`, `input → TerminalInputResult`, `list → TerminalListResult`, `output → TerminalOutputResult`, `rename → TerminalRenameResult`, `restart → TerminalRestartResult`, `resize → TerminalResizeResult`; every result except list/output is a `TerminalSession` alias.
- `theme`: `get → ThemeGetResult`, `catalog → ThemeCatalogResult`, both `set(ThemeSetInput)` and convenience `set(string) → ThemeSetResult`.
- `threadFolders`: `create/delete/list/update → ThreadFolderCreateResult/ThreadFolderDeleteResult/ThreadFolderListResult/ThreadFolderUpdateResult`.
- `threads` root: `archive → ThreadArchiveResult`, `archiveAll → ThreadArchiveAllResult`, `childSummary → ThreadChildSummaryResult`, `conversationOutline → ThreadConversationOutlineResult`, `defaultExecutionOptions → ThreadDefaultExecutionOptionsResult`, `delete → ThreadDeleteResult`, `get → ThreadGetResult`, `list → ThreadListResult`, `markRead/markUnread → ThreadReadStateResult`, `open → ThreadOpenResult`, `output → ThreadOutputResponse`, `pin/unpin/update → ThreadMutationResult`, `promptHistory → ThreadPromptHistoryResult`, `reorderPinned → ThreadPinOrderResult`, `search → ThreadSearchResult`, `send → ThreadSendResult`, `spawn → ThreadSpawnResult`, `stop → ThreadStopResult`, `timeline → ThreadTimelineResult`, `timelineTurnSummaryDetails → ThreadTimelineTurnSummaryDetailsResult`, `storageFiles → ThreadStorageFilesResult`, `storagePaths → ThreadStoragePathsResult`, `unarchive → ThreadUnarchiveResult`, `wait → ThreadWaitResult`.
- `threads` nested: `events.list/wait → ThreadEventsListResult/ThreadEventWaitResult`; `interactions.cancel/get/list/resolve/respond → ThreadInteractionCancelResult/ThreadInteractionGetResult/ThreadInteractionListResult/ThreadInteractionResolveResult/ThreadInteractionRespondResult`; queued-message `create/delete/list/reorder/send/setGroupBoundary → ThreadQueuedMessageCreateResult/ThreadQueuedMessageDeleteResult/ThreadQueuedMessagesResult/ThreadQueuedMessageReorderResult/ThreadQueuedMessageSendResult/ThreadQueuedMessageGroupBoundaryResult`; `tabs.get/update → ThreadTabsResult/ThreadTabsUpdateResult`.
- realtime `subscribe → BbRealtimeUnsubscribe`; payloads are selected by `BbRealtimeEventMap` through the discriminated `BbRealtimeSubscribeArgs` union.

### Multi-machine routing classifications and fallbacks

| Classification | SDK areas | Rule |
| --- | --- | --- |
| explicit host resource | `hosts.*` | `hostId` is required; there is no fallback. |
| optional host primitive | `files.*` | optional `hostId`; omission selects the primary/local host. `rootPath` confines mutations and reads where offered. |
| environment-owned | `environments.*` | `environmentId` resolves the environment and its owning host/worktree; callers do not add a competing `hostId`. |
| project workspace union | `projects.commands/files/fileContent/paths` | exactly environment, explicit host, or neither; neither means the primary host's project source. |
| project creation/source | `projects.create`, `projects.sources.*` | local-path sources carry their owning `hostId`; clone/local source DTOs preserve explicit machine ownership. |
| client-local transfer | `projects.attachments.*`, `system.transcribeVoice` | bytes originate at the SDK client and are uploaded to the server; they are not paths read by the server or execution host. |
| provider discovery union | `providers.list/models` | exactly environment host, explicit host, or primary-host fallback. |
| thread-owned execution | `threads.*` | an existing thread routes through its environment/host; `spawn` may select an existing environment or creation host through its request contract, and plugin origin attribution is filled once by the plugin wrapper. |
| terminal discriminated scope | `terminals.list/create` | exactly thread, environment, or host-path; subsequent operations route from the server-owned terminal id. |
| server-global/admin | `plugins`, `system` settings/config, `theme`, `threadFolders`, `status`, `guide` | runs against server-owned state; host selection appears only in method-specific DTOs such as usage/execution queries. |

Fallbacks are contract, not implementation accidents: primary-host fallback applies only where explicitly documented above. Disconnected/unknown explicit hosts fail; they do not silently reroute. An environment always keeps its owning machine. Browser and Node transports preserve the same DTO and routing semantics, while local-host auto-discovery is a Node convenience only.

## Standalone `@bb/sdk` entrypoints

Plugins normally use the already-bound `bb.sdk`; they do not construct another client. These are the public standalone package entrypoints used by bb clients and tooling.

### Node/root entry

| Export | Contract |
| --- | --- |
| `createNodeTransport(args?)` | creates an HTTP/realtime transport from `baseUrl?`, CLI config, fetch, explicit realtime URL, timeout, and websocket factory. |
| `createNodeBbSdk(args?)` | creates the full `BbSdk`; accepts transport args plus optional context. |
| `fetchLocalHostId(args?)` | asks the local daemon for its host id; returns `null` on any failure. |
| `createBbSdk({ transport, context? })` | constructs all SDK areas over a supplied transport. |
| `createHttpTransport(args)` | creates the shared typed HTTP transport. |
| `createRequestTimeoutFetch({ timeoutMs })` | wraps fetch so request and response-body timeout failures become `BbRequestTimeoutError`. |
| `createGuideArea()` | creates the static guide renderer. |
| `DEFAULT_BB_REQUEST_TIMEOUT_MS` | 75,000 ms. |
| `DEFAULT_THREAD_WAIT_TIMEOUT_MS` | 20 minutes. |
| `DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS` | 250 ms. |
| `BbHttpError` | non-2xx error with `status` and nullable machine-readable `code`. |
| `BbRequestTimeoutError` | normalized request/body timeout error. |
| `ThreadWaitTimeoutError` | wait timeout with thread id and target. |
| `ThreadWaitUnreachableError` | status target cannot be reached by waiting alone. |
| public type exports | every area argument/result DTO, routing union, realtime event/subscription type, transport/context type, and `BbSdk`. |

Transport arguments default to CLI-configured `BB_SERVER_URL`, the standard 75-second timeout fetch, and a Node websocket factory. `timeoutMs` must be finite and non-negative; zero is permitted.

### Browser entry

| Export | Contract |
| --- | --- |
| `createBrowserTransport(args?)` | creates browser HTTP/realtime transport from optional base URL, fetch, realtime URL, and websocket factory. |
| `createBrowserBbSdk(args?)` | creates the full `BbSdk`. |
| `bb` | default singleton created by `createBrowserBbSdk()`. |
| `createBbSdk` | core constructor. |
| `createHttpTransport` | transport constructor. |
| public type exports | the same portable area/DTO/realtime inventory as the root entry; only Node runtime helpers are omitted. |

### `@bb/sdk/core`

Exports `createBbSdk`, `BbSdk`, `CreateBbSdkArgs`, and the portable public type inventory from the transport-neutral core.

### `@bb/sdk/node-websocket`

- `wrapNodeWsWebsocket(url)` adapts the `ws` package to the SDK's minimal socket interface.
- `createNodeWebsocketFactory()` uses the global WebSocket when present and falls back to `ws`.

## Official testing SDK

The testing subpaths are official distributable entrypoints under D2. Their runtimes and portable declarations ship in the package; external plugins import them directly even though a newly generated starter does not copy their implementation into its own source tree.

### `@bb/plugin-sdk/testing`

#### Constructors and fixture

| Export | Purpose |
| --- | --- |
| `createFakePluginHost(options?)` | returns `{ bb, harness }`; `bb` satisfies `BbPluginApi`. |
| `createFakeSdk({ pluginId, overrides? })` | returns a call-recording `BbSdk` proxy and its harness. |
| `makeThreadResponse(overrides?)` | builds a complete deterministic idle `ThreadResponse`. |
| `PluginContextStaleError` | same named/shape error as the host after disposal. |

`createFakePluginHost` options: `pluginId?`, `loopbackBaseUrl?`, pre-seeded `settings?`, initial `sdk?` stubs, declared `agentSkillIds?`, and `sharedPortTunnelIdentities?`.

The fake uses real better-sqlite3 storage in a temporary directory, enforces the KV limit and registration validation, JSON-round-trips RPC/CLI/realtime values, applies plugin spawn attribution, and models disposal. It deliberately does not enforce HTTP auth, run background timers, persist secrets to files, or call a real server for unstubbed SDK methods.

#### Harness inspection members

| Member | Contents |
| --- | --- |
| `pluginId` | fake plugin id. |
| `logEntries` | ordered `{ level, message }[]`. |
| `realtimeSignals` | ordered `{ channel, payload }[]`. |
| `needsConfigurationMessages` | every reported configuration message. |
| `sdk` | fake SDK call log/stub controller. |
| `registrations` | settings descriptors, routes, RPC names, services, schedules, CLI, tools, instruction provider, actions, event counts, and mention providers. |
| `sharedPortDeclarations` | `{ hostId, ports }[]`. |
| `pendingInteractions` | active fake interaction requests with generated ids. |

The harness exposes the same members directly for compatibility and as three intent-specific views: `inspection`, `behavior`, and `lifecycle`.

#### Behavior drivers — 11

| Method | Purpose |
| --- | --- |
| `submitInteraction(id, value)` | submits a pending interaction. |
| `cancelInteraction(id)` | cancels a pending interaction as the user. |
| `setSettings(values)` | validates/saves settings and fires change listeners. `null` unsets. |
| `callRpc(method, input?)` | invokes registered RPC with host-like JSON/error behavior. |
| `runCli(argv, ctx?)` | invokes CLI and normalizes optional output/error behavior. |
| `fetchHttp(method, path, init?)` | dispatches through a real Hono context without host auth enforcement. |
| `runService(name)` | starts once and returns `{ controller, done }`. |
| `runSchedule(name)` | invokes one schedule once. |
| `emitThreadEvent(event, payload)` | runs registered observers sequentially and returns collected errors. |
| `callAgentTool(name, input, ctx?)` | parses and invokes a tool with default test context. |
| `resolveAgentConfiguration(context)` | evaluates conditional tools/skills/instructions with production fail-closed validation. |

Lifecycle is separate: `reload(factory)` builds an atomic replacement over the same persisted settings/KV/database and keeps the prior load live on failure; `dispose()` aborts started services, runs LIFO hooks, closes SQLite, and poisons the API idempotently.

#### Fake SDK harness

| Member | Purpose |
| --- | --- |
| `calls` | every `{ path, args }` in order. |
| `callsTo(path)` | returns argument lists for a dot path such as `threads.spawn`. |
| `stub(path, implementation)` | adds/replaces a method stub. |

Unstubbed methods throw with the exact path to stub. Recorded `threads.spawn` calls include the default plugin attribution applied by production.

### `@bb/plugin-sdk/testing/app`

| Export/member | Purpose |
| --- | --- |
| `installTestPluginRuntime()` | installs the fake frontend runtime globally before importing an app entry. |
| `loadPluginApp(source)` | resolves a definition/module/import thunk, validates registrations with host rules, and returns `CapturedPluginApp`. |
| `renderSlot(registration, props, options?)` | mounts a component using Testing Library and fake hook backends. |
| rendered `inspection.rpcCalls` | ordered `{ method, input }[]`. |
| rendered `behavior.emitRealtime(channel, payload)` | pushes a JSON-round-tripped signal inside React `act`. |
| rendered `inspection.navigateCalls` | discriminated call log for every navigation method. |
| rendered `inspection.composer` | `{ text, quotes, mentions, focusCount }` write log. |
| rendered `lifecycle.rerender(ui)` / `unmount()` | Testing Library mount controls separated from behavior/logs. |

`CapturedPluginApp` contains `homepageSections`, `settingsSections`, `navPanels`, `threadPanelActions`, `composerAccessories`, `pendingInteractions`, `sidebarFooterActions`, `fileOpeners`, and `messageDirectives`.

`renderSlot` options are:

- `rpc`: method-to-handler map;
- `settings`: non-secret setting values;
- `context`: nullable project/thread selection;
- `composer`: optional initial composer scope/text.

Use a dynamic import thunk with `loadPluginApp` so the runtime is installed before `app.tsx` binds its imports. Tests that use `renderSlot` need a jsdom environment.

## Exported plugin SDK type index

The root `@bb/plugin-sdk` declaration exports these public type families:

- root/backend: `BbPluginApi`, `PluginLogger`, `PluginSettings`, `PluginSettingsHandle`, `PluginSettingDescriptor`, `PluginSettingDescriptors`, `PluginSettingValue`, `PluginSettingsValues`, `PluginKvStorage`, `PluginStorage`, `PluginHttp`, `PluginHttpHandler`, `PluginHttpAuthMode`, `PluginRpc`, `PluginRealtime`, `PluginBackground`, `PluginCli`, `PluginCliRegistration`, `PluginCliCommandInfo`, `PluginCliContext`, `PluginCliResult`, `PluginInteractionRequest`, `PluginInteractionResult`, `PluginInteractionCancelReason`, `PluginAgents`, `PluginAgentConfiguration`, `PluginAgentConfigurationContext`, `PluginAgentToolRegistrationBase`, `PluginAgentToolContext`, `PluginAgentToolContentPart`, `PluginAgentToolResult`, `PluginUi`, `PluginThreadActionRegistration`, `PluginThreadActionContext`, `PluginThreadActionResult`, `PluginThreadActionToast`, `PluginMentionProviderRegistration`, `PluginMentionSearchContext`, `PluginMentionItem`, `PluginMentionTrigger`, `PluginEvents`, `PluginStatusApi`, `PluginServerApi`, `PluginHosts`, `PluginSharedPortTunnelIdentity`, `PluginThreadEventPayloads`, `PluginThreadEventName`, and `PluginThreadEventHandler`;
- RPC/JSON: `JsonValue`, `PluginRpcCallArgs`, `PluginRpcContract`, `PluginRpcError`, `PluginRpcErrorCode`, `PluginRpcHandlers`, `PluginRpcIssuePathSegment`, `PluginRpcMethodContract`, `PluginRpcResult`, `PluginRpcValidationIssue`, `StandardSchemaV1`, `StandardSchemaV1InferInput`, `StandardSchemaV1InferOutput`, `StandardSchemaV1Issue`, and `StandardSchemaV1Result`;
- app definition: `PluginSdkApp`, `PluginAppBuilder`, `PluginAppSlots`, `PluginAppSetup`, and `PluginAppDefinition`;
- slot props/registrations: homepage, settings, nav panel, thread panel action, composer accessory, pending interaction, sidebar footer action, file opener, and message directive types documented above;
- hooks: `PluginRpcClient`, `PluginSettingsState`, `BbContext`, `BbNavigate`, `PluginComposerApi`, `PluginComposerScope`, `PluginComposerMention`.

The root declaration is side-effect-free for app/backend types and also exports `defineRpcContract`. The `/app` runtime subpath exports exactly the seven hook/setup functions listed above plus app types; slot/directive validation regexes and the runtime export-name list are host-internal and are not declared author imports.

## Security and trust boundaries

- Plugins execute full-trust code in the server process and can read local server data.
- `bb.sdk` currently exposes administrative plugin, system-settings, experiment, keyboard, machine, project, thread, filesystem, and theme mutations. There is no plugin capability grant layer.
- Secret settings are protected from the plugin frontend, not from the plugin backend.
- `auth: none` HTTP routes are public to any network path reaching the server and must authenticate their own webhook protocol.
- Agent tool JSON Schema inputs are unvalidated unless the tool validates them; zod registrations validate automatically.
- RPC inputs, persisted panel params, directive attributes, interaction payloads, and file paths are trust boundaries and must be narrowed/validated.
- Filesystem operations should use `rootPath`, host routing, and compare-and-swap where appropriate.
- Message directives must not trust model-generated attributes; preview URLs are the preferred way to serve browser assets without revealing absolute roots/host ids.

## Final 1.0 audit closure

- **D1 / full trust:** `bb.sdk` is deliberately the complete `BbSdk`, including plugin administration, global settings/experiments/keybindings, hosts, projects, files, terminals, themes, and mutations. Compatibility applies to every reachable area, nested method, exported DTO/result, routing classification, and documented fallback.
- **D2 / portable distribution:** package version and `PLUGIN_SDK_VERSION` are both `0.3.0` at this snapshot. Root, `/app`, `/testing`, and `/testing/app` have distributable runtime files and bundled declarations. External scaffold tests run with `skipLibCheck: false` and read representative result fields.
- **Declaration/runtime parity:** the `/app` declaration and runtime both expose exactly seven values. Validation regexes remain internal. Root exposes the schema helper intentionally.
- **JSON boundary:** panel parameters, RPC payloads/results, interaction values, and composer/directive data use the shared static `JsonValue` boundary where they cross persistence or transport. Realtime deliberately accepts `unknown`; the host applies a `JSON.stringify`/`JSON.parse` round trip, normalizes top-level `undefined` to `null`, preserves normal JSON coercions, and throws when no JSON representation can be produced.
- **RPC contract:** Standard Schema v1 input/output schemas, `defineRpcContract`, inferred handlers/client calls, stable error codes, validation issue paths, and strict JSON serialization are the supported contract.
- **Registration semantics:** the registration/reload matrix above is normative and is enforced by production and fake hosts. Candidate reload is atomic; keyed duplicates reject; listeners accumulate; shared-port declarations replace per plugin+host.
- **Frontend chrome:** the obsolete `navPanel.chrome` switch is gone. The host always keeps the shared compact plugin icon/title header, optional `headerContent` occupies its right side, and the plugin owns a full-bleed body below it.
- **`settingsSection.description?`:** the field is present in source, bundled declarations, runtime interpretation, testing capture, and this reference. It renders with an optional custom-section title.
- **Cluster 8 / final SDK parity:** environment inspection, project creation/workspace routing/attachments, provider host routing, appearance/theme, and canonical top-level terminals are represented here with their final multi-machine classifications and fallbacks. Realtime is `subscribe`, not `on`; terminals are `sdk.terminals`, not `threads.terminals`.
- **Standalone parity:** Node/root and browser re-export the portable public type inventory; core owns transport-neutral construction. Node-only local-host discovery and websocket fallback stay environment-specific.

The source tests snapshot backend roots/types, RPC types, frontend declaration/runtime exports, bundled package exports, JSON boundaries, public SDK types, external scaffold consumption, and both testing harness entrypoints. This document is the human-readable complement to those executable inventories.

## Coverage checklist

- [x] manifest/package fields
- [x] backend factory and disposal lifecycle
- [x] every `BbPluginApi` root member
- [x] all four lifecycle events
- [x] all frontend runtime functions
- [x] all nine frontend slots and their component/callback props
- [x] all 13 `BbSdk` areas and all 144 callable paths including realtime
- [x] all 42 thread-area callable paths and all 9 canonical terminal methods
- [x] realtime subscription surface
- [x] standalone Node/browser/core/websocket constructors and public errors
- [x] backend testing constructors, drivers, and inspection APIs
- [x] frontend testing constructors, drivers, and logs
- [x] exported plugin type families
- [x] compatibility, full-trust security, D1/D2 decisions, and Cluster 8 closure
