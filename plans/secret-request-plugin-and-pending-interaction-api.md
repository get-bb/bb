# Secret request plugin and plugin pending-interaction API

Status: proposed.

## Summary

Build a first-party `secrets` plugin that lets an agent request several secret
values in one blocking command and apply them to a dotenv file without putting
the values in the prompt, command arguments, command output, thread timeline,
or database.

The intended agent flow is:

```bash
bb secret request OPENAI_API_KEY RESEND_API_KEY \
  --purpose "Configure the application credentials" \
  --describe OPENAI_API_KEY "API key used by the backend for OpenAI requests." \
  --describe RESEND_API_KEY "API key used to send transactional email." \
  --write-env .env.local
```

The command creates one pending interaction for the current thread. The bb app
replaces the composer with a plugin-provided form containing both password
fields. When the user submits, the values travel directly to the plugin backend,
the plugin reconciles both assignments into `.env.local` in one guarded write,
and the command prints only non-sensitive completion metadata.

This requires a new general plugin API:

- Backend plugins can create and await a thread-scoped pending interaction with
  `bb.interactions.request(...)`.
- Frontend plugins can register the matching composer-replacement renderer with
  `app.slots.pendingInteraction(...)`.
- bb owns the pending-interaction lifecycle, composer replacement, thread
  blocking, cancellation, timeout, reload behavior, and multi-client races.
- The plugin owns the renderer payload and submitted response.
- Plugin response values are delivered ephemerally and are never persisted.

The implementation deliberately has no model-visible lease IDs, no
`request_secrets` native tool, and no plaintext `bb secret get` command.

## Product decisions

These are settled requirements for V1:

1. **CLI first.** Agents invoke `bb secret request`; there is no native agent
   tool for the same operation.
2. **One command, one form, several secrets.** A request accepts multiple unique
   environment-variable names and submits them together.
3. **Declared use.** V1 requires `--write-env <path>`. Request-only storage,
   retrieval, and arbitrary command execution are deferred.
4. **No exposed leases.** bb still creates its normal internal `pint_*`
   interaction ID, but neither the agent nor the user manages a secret lease.
5. **No plaintext retrieval.** The plugin never implements `bb secret get` and
   never returns a secret through plugin CLI `stdout` or `stderr`.
6. **Ephemeral response.** Request descriptors may be persisted so the form can
   render, but submitted field values are held only long enough to deliver them
   to the waiting plugin invocation and perform the file write.
7. **One active interaction per thread.** Existing pending approvals,
   AskUserQuestion interactions, and plugin interactions are mutually exclusive.
8. **Plugin interactions are generic.** The core API is not secret-specific;
   other plugins may register their own pending-interaction renderer.
9. **Builtin plugin.** Ship this as `plugins/secrets` / `bb-plugin-secrets` and
   add it to the builtin plugin registry so the workflow is available without a
   separate install.
10. **Skill-backed behavior.** The plugin ships `skills/secrets/SKILL.md` to
    teach agents when and how to use the command safely. The generated
    `plugin-commands` skill remains the terse command-discovery surface.

## Goals

- Keep user-entered secret values out of model input and model-visible command
  output.
- Render the secret form in the exact composer-replacement location used by
  first-class pending interactions.
- Let a plugin invocation wait for a response without inventing its own RPC,
  realtime, or browser-reconciliation protocol.
- Support multiple fields with a short description per field and a top-level
  purpose.
- Update an existing dotenv file without discarding unrelated variables,
  comments, ordering, blank lines, or line-ending style.
- Make submission, cancellation, timeout, thread stop, plugin reload, and server
  restart deterministic.
- Work against the thread's actual connected host and workspace, including
  remote hosts.
- Make the new plugin API available in bundled declarations, scaffolds,
  authoring documentation, and test harnesses.

## Non-goals and threat boundary

- This does not protect secrets from a malicious full-trust plugin. Plugin
  backend and frontend code are trusted code in bb.
- This does not make a secret permanently unreadable to the agent after it is
  written into an agent-readable workspace file. The bundled skill must tell the
  agent not to inspect the completed file, but that is guidance rather than a
  hard sandbox boundary.
- V1 does not provide a durable vault, OS keychain integration, cross-thread
  sharing, project-scoped values, or remembered secrets.
- V1 does not support `bb secret exec`, arbitrary shell commands, stdin
  injection, or process-environment injection.
- V1 does not support multiline dotenv values. Secret inputs used with
  `--write-env` must be non-empty, single-line UTF-8 strings without NUL.
- V1 does not attempt to discover whether the destination is gitignored.
- V1 does not add arbitrary plugin-controlled composer replacement outside an
  active plugin pending interaction.

## Current-state constraints

The design must account for the following existing behavior:

- `composerAccessory` renders only in the normal prompt-box footer. It cannot
  replace the prompt box, and it disappears when a core pending interaction
  replaces the composer.
- Current pending interactions are provider-originated. Their rows require a
  turn ID and provider request identity, and resolution queues an
  `interactive.resolve` command back to the provider.
- Current user-question resolutions are serialized into the database and
  timeline, so ordinary free text cannot be reused for secrets.
- Plugin CLI handlers receive `cwd`, `threadId`, and `projectId`, but no abort
  signal. A blocking CLI request can therefore become orphaned today.
- Plugin CLI output is JSON `stdout`/`stderr` and is line-oriented at the local
  proxy. It is not a sensitive byte channel.
- `bb.sdk.files` already supports connected-host reads, writes, root
  confinement, and compare-and-swap, but file creation has no permission-mode
  option.
- Plugin skills are already auto-imported from `skills/`, and registered plugin
  CLI commands already appear in the server-generated `plugin-commands` skill.

## Proposed plugin API

### Backend: `bb.interactions.request`

Add `interactions` to `BbPluginApi` in
`packages/plugin-sdk/src/backend-contract.ts`:

```ts
export interface PluginInteractionRequest {
  threadId: string;
  rendererId: string;
  title: string;
  payload: unknown;
  timeoutMs?: number;
}

export type PluginInteractionCancellationReason =
  | "user"
  | "request-aborted"
  | "thread-stopped"
  | "thread-deleted"
  | "plugin-disposed"
  | "server-restarted"
  | "timeout";

export type PluginInteractionResult =
  | { outcome: "submitted"; value: unknown }
  | {
      outcome: "cancelled";
      reason: PluginInteractionCancellationReason;
    };

export interface PluginInteractions {
  request(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<PluginInteractionResult>;
}
```

Contract rules:

- `rendererId` uses the existing plugin slot ID pattern.
- `title` is non-empty and capped at 160 characters.
- `payload` must survive a JSON round-trip and is capped at 64 KiB after
  serialization.
- `timeoutMs` defaults to 10 minutes and is capped at 60 minutes.
- The owning plugin ID is injected by the host; callers cannot impersonate
  another plugin.
- The server rejects requests for an unknown/deleted thread or a thread that
  already has a pending/resolving interaction.
- `request` registers the interaction before its promise becomes awaitable, so
  a fast frontend response cannot race registration.
- Submitted `value` is untrusted `unknown`; the plugin must parse it immediately
  at this boundary.
- Cancellation resolves the union rather than throwing. API misuse and server
  failures still throw.
- Aborting `options.signal` interrupts the pending interaction if it is still
  active and settles the promise with `request-aborted`.
- Reload/disable invalidates every request owned by that plugin before the
  plugin service drains in-flight invocations.

### CLI cancellation

Extend `PluginCliContext` with a required host-provided signal:

```ts
export interface PluginCliContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
  signal: AbortSignal;
}
```

The plugin CLI route supplies `context.req.raw.signal`; the fake plugin host
supplies a controllable signal. When the invoking `bb` process exits and the
HTTP request closes, the interaction is cancelled rather than remaining stuck
until its TTL.

This addition is required for the secret plugin but useful for any long-running
plugin CLI command.

### Frontend: `app.slots.pendingInteraction`

Add an interaction-specific slot rather than a general always-on composer
swizzle:

```ts
export interface PluginPendingInteractionView {
  id: string;
  threadId: string;
  title: string;
  status: "pending" | "resolving";
  payload: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface PluginPendingInteractionProps {
  interaction: PluginPendingInteractionView;
  submit(value: unknown): Promise<void>;
  cancel(): Promise<void>;
}

export interface PluginPendingInteractionRegistration {
  id: string;
  component: ComponentType<PluginPendingInteractionProps>;
}

export interface PluginAppSlots {
  // Existing slots...
  pendingInteraction(registration: PluginPendingInteractionRegistration): void;
}
```

The host selects a renderer only when all three match:

- interaction origin is `plugin`;
- origin plugin ID matches the frontend plugin ID;
- origin renderer ID matches the registration ID.

The host, not the plugin component, owns the outer chrome. It renders the
plugin logo/display name, interaction title, pending/resolving state, and a
contained error boundary. The plugin component owns only the form body.

If the frontend bundle or renderer is missing, incompatible, or crashed, keep
the composer blocked and show a host-rendered fallback with an explanation and
a Cancel button. Never silently restore the normal composer while the backend
is still waiting.

`submit` and `cancel` are host callbacks, not plugin RPC methods. They call core
thread-interaction routes and inherit bb's normal local-app authentication.

## Pending-interaction domain and persistence

### Generalize interaction origin

Refactor `packages/domain/src/pending-interactions.ts` so interaction identity is
an explicit discriminated union:

```ts
type PendingInteractionOrigin =
  | {
      kind: "provider";
      providerId: string;
      providerThreadId: string;
      providerRequestId: string;
    }
  | {
      kind: "plugin";
      pluginId: string;
      rendererId: string;
    };

interface PendingInteractionBase {
  id: string;
  threadId: string;
  turnId: string | null;
  origin: PendingInteractionOrigin;
  status: PendingInteractionStatus;
  payload: PendingInteractionPayload;
  resolution: PendingInteractionResolution | null;
  statusReason: string | null;
  createdAt: number;
  expiresAt: number | null;
  resolvedAt: number | null;
}
```

Provider interactions retain a non-null `turnId`. Plugin interactions capture
the active turn when one exists but may use `null`, which allows future plugins
to request thread UI outside a provider turn without faking provider identity.

Add a payload and persisted resolution metadata:

```ts
type PluginPendingInteractionPayload = {
  kind: "plugin";
  title: string;
  data: JsonValue;
};

type PluginPendingInteractionResolution = {
  kind: "plugin_submitted";
};
```

Enforce source/payload compatibility at the domain boundary:

- provider origin accepts only approval or user-question payloads;
- plugin origin accepts only plugin payloads;
- `plugin_submitted` resolves only a plugin interaction.

The actual submitted value is explicitly not part of
`PendingInteractionResolution`.

### Database migration

Update `packages/db/src/schema.ts` and generate the migration with:

```bash
pnpm --filter @bb/db db:generate
```

Do not edit Drizzle snapshots manually.

The generated table rebuild should:

- add `origin_kind` with existing rows backfilled to `provider`;
- make `turn_id`, `provider_id`, `provider_thread_id`, and
  `provider_request_id` nullable for plugin rows;
- add nullable `plugin_id` and `renderer_id` columns;
- add nullable `expires_at`;
- retain the provider-request unique index for provider rows;
- add an index on `(plugin_id, status, created_at)` for reload/dispose cleanup;
- retain the thread/status indexes used by composer and sidebar queries.

Data access functions must accept and return the domain union rather than
accepted-but-ignored nullable fields. Add targeted queries for active plugin
interactions by plugin ID; do not load all interaction rows and filter in
JavaScript.

### Ephemeral response broker

Add a narrow server service, for example
`apps/server/src/services/interactions/plugin-interaction-broker.ts`, containing
an in-memory map:

```ts
Map<
  interactionId,
  {
    pluginId: string;
    settle(result: PluginInteractionResult): void;
    timeout: NodeJS.Timeout;
  }
>;
```

The broker owns only delivery and cancellation. The existing
`PendingInteractionLifecycle` remains the source of truth for row status,
thread notifications, and one-active-interaction policy.

Required broker behavior:

- Insert the broker entry and database row as one ordered registration path;
  if row creation fails, leave no broker entry.
- Delete the broker entry before invoking its resolver, preventing reentrant or
  duplicate delivery.
- First submit/cancel wins across multiple connected browser clients.
- Never log or inspect submitted values.
- Cancel timers on every terminal path.
- On server startup, mark active plugin-origin rows interrupted with
  `server-restarted`; their in-memory resolver no longer exists.
- On plugin unload/reload, interrupt all active rows for that plugin with
  `plugin-disposed` before draining plugin invocations.
- Existing thread stop/delete paths interrupt the row and settle the broker
  with the corresponding reason.

### Routes

Keep provider resolution and plugin response on separate endpoints so a plugin
value cannot accidentally enter the persisted provider-resolution path.

Add:

```text
POST /api/v1/threads/:id/interactions/:interactionId/respond
POST /api/v1/threads/:id/interactions/:interactionId/cancel
```

`respond` accepts `{ value: JsonValue }`, with a 64 KiB serialized cap, and only
for a pending plugin-origin interaction. Its sequence is:

1. Validate thread, interaction, origin, status, and response size.
2. Atomically claim `pending -> resolving`; a second client receives 409.
3. Remove the broker entry and deliver the value to the waiting plugin promise.
4. Persist only `{ kind: "plugin_submitted" }` and mark the row resolved.
5. Emit interaction-change notifications so the composer returns.
6. Return the resolved interaction metadata without echoing the response.

`cancel` accepts no response body, claims the pending interaction, interrupts
it with reason `user`, settles the broker, and returns metadata. Cancelling a
plugin interaction does not stop the whole thread; the waiting CLI command
returns a cancellation exit status and the agent may continue.

The existing `/resolve` route continues to handle provider interactions only.

### Timeline

Add `system/pluginInteraction/lifecycle` so the thread retains useful history
without persisting plugin response values. Event data contains only:

- interaction ID;
- plugin ID and renderer ID;
- title;
- status and status reason;
- created/resolved timestamps.

Do not copy the opaque renderer payload or submitted response into timeline
events. The completed row should read like “Secrets provided to `.env.local`,”
not list values.

Update thread-view projection and suppression only as necessary to render a
compact lifecycle row. Provider approval and AskUserQuestion projections must
remain unchanged.

## Secrets plugin

### Package layout

Create:

```text
plugins/secrets/
  package.json
  tsconfig.json
  vitest.config.ts
  app.tsx
  src/
    server.ts
    cli.ts
    contract.ts
    dotenv.ts
    paths.ts
  skills/
    secrets/
      SKILL.md
  test/
    cli.test.ts
    dotenv.test.ts
    app.test.tsx
    secret-confinement.test.ts
```

Use package name `bb-plugin-secrets`, plugin ID `secrets`, and top-level CLI
command name `secret`. Register the package in the workspace and add `secrets`
to `BUILTIN_PLUGIN_NAMES` so packaging copies it alongside the other builtin
plugins.

The plugin does not need sqlite, kv storage, settings, RPC, realtime, a
background service, or a native agent tool.

### CLI grammar

V1 syntax:

```text
bb secret request <NAME...> --write-env <path>
  [--purpose <sentence>]
  [--describe <NAME> <sentence>]...
  [--timeout <duration>]
  [--json]
```

Rules:

- Require `request` and at least one name.
- Require `--write-env` in V1.
- Accept 1–10 unique names matching `^[A-Z_][A-Z0-9_]*$`.
- Each `--describe` name must appear in the requested name list and may appear
  once. Descriptions are optional, one line, and capped at 240 characters.
- `--purpose` is optional, one line, and capped at 240 characters.
- Resolve relative destination paths against `ctx.cwd`.
- Require `ctx.threadId` and `ctx.cwd`; outside a thread, return a clear error
  explaining that the command must run from a bb thread environment.
- Do not accept secret values in argv, stdin, environment variables, or flags.
- `--json` returns names, destination, outcome, and added/updated/unchanged
  counts only.
- User cancellation exits non-zero with `Secret request cancelled by user.`
- Timeout, plugin disposal, thread stop, and request abort get distinct,
  non-sensitive errors.

Populate `bb.cli.register().summary` and `commands[].usage` so the generated
`plugin-commands` skill exposes the command accurately.

### Request payload and response

Share a browser-safe zod contract between `app.tsx` and the backend:

```ts
type SecretRequestPayload = {
  purpose: string | null;
  destination: { kind: "dotenv"; path: string };
  fields: Array<{
    name: string;
    description: string | null;
  }>;
};

type SecretRequestResponse = {
  values: Record<string, string>;
};
```

The backend parses `PluginInteractionResult.value` with this schema and rejects
missing, extra, blank, multiline, NUL-containing, or oversized values. Cap each
value at 16 KiB and the total response at the core 64 KiB limit.

### Frontend form

Register:

```ts
app.slots.pendingInteraction({
  id: "secret-request",
  component: SecretRequestInteraction,
});
```

The component must:

- parse `interaction.payload` before rendering;
- show purpose and exact dotenv destination;
- show every variable name as read-only text with its optional description;
- render one password input per field with paste support, reveal controls, and
  suitable autocomplete behavior;
- keep values only in component state;
- require every field before enabling Submit;
- clear local state after successful submission and on unmount;
- disable inputs/buttons while resolving;
- show submission errors without interpolating input values;
- call the host `cancel` callback rather than stopping the thread;
- use shared UI components because this is a builtin plugin;
- remain usable on compact/mobile layouts and with keyboard-only navigation.

The host wrapper clearly identifies `Secrets` as the requesting plugin. The
plugin title should be `Add secrets to <relative path>`.

### Workspace and host resolution

Before showing the form:

1. Fetch the thread with `bb.sdk.threads.get({ include: "environment,host" })`.
2. Require a live environment, host, and workspace path.
3. Resolve `--write-env` relative to the CLI `cwd`.
4. Require both `cwd` and destination to be inside the thread environment root.
5. Pass the environment root as `rootPath` and the resolved host ID to every
   `bb.sdk.files` operation.

This prevents a relative-path request from accidentally writing on the server's
primary host or escaping the active workspace.

### Dotenv reconciliation

Preflight the destination before requesting secrets:

- Read the existing file and retain its hash; treat not-found as a new file.
- Detect dominant line ending (`\n` or `\r\n`) and whether the file ends with a
  newline.
- Parse assignment locations without reserializing the entire file.
- Recognize optional `export`, surrounding whitespace, comments, and quoted
  values sufficiently to locate exact key assignments.
- If any requested key has more than one active assignment, fail before showing
  the form. V1 does not guess which duplicate wins.

After submission:

- Replace exactly one existing assignment for a requested key while preserving
  its `export` prefix and surrounding file structure.
- Append missing assignments together at the end, inserting only the minimum
  required newline separation.
- Preserve all unrelated bytes and the detected line-ending style.
- Encode values deterministically so parsing the written line with the selected
  dotenv compatibility parser produces the original single-line value.
- Apply every requested update in memory and perform one CAS write.
- On CAS conflict, re-read, re-validate duplicates, reapply once, and retry. A
  second conflict fails without exposing or partially writing values.
- Preserve existing file permissions. Create new files with mode `0600`.
- Return only names, path, and added/updated/unchanged counts.

Add `mode?: number` to the host file-write contract and `bb.sdk.files.write`.
Validate it as an integer permission mask and pass it to the daemon's
`fs.writeFile` create path. Document that mode affects creation and does not
chmod an existing file.

## Bundled skill

Create `plugins/secrets/skills/secrets/SKILL.md` with frontmatter that triggers
when an agent needs an API key, access token, password, webhook secret, or other
credential to configure a workspace.

The skill must teach agents to:

- use `bb secret request` instead of asking the user to paste values into chat;
- batch all currently known variables into one request;
- include one short, plain description per variable and a concise purpose;
- declare the exact `--write-env` destination;
- inspect documentation or `.env.example` to learn variable names, without
  reading or printing an existing secret-bearing env file;
- never put values in argv, prompts, comments, logs, or follow-up messages;
- never run `cat`, `sed`, `env`, or similar inspection against the completed
  secret file merely to verify it;
- treat a successful command exit and metadata counts as verification;
- handle duplicate-key or CAS-conflict errors structurally and rerun the
  request rather than asking the user to paste the value again;
- explain that plugin CLI commands require workspace-write/full mode when a
  readonly sandbox blocks loopback access.

Include the canonical multi-secret example and concise recovery examples. Keep
the skill narrowly focused; the generated `plugin-commands` skill already
covers basic command discovery.

Add an injection test proving the builtin plugin's skill reaches new thread
runtime configuration and disappears when the builtin is explicitly disabled.

## Implementation phases

### Phase 1: domain and database generalization

1. Add provider/plugin origin schemas, plugin payload, metadata-only plugin
   resolution, nullable turn scope, and expiry to `@bb/domain`.
2. Update all provider adapter/runtime call sites to construct provider origin
   explicitly.
3. Change the Drizzle schema and generate the migration/snapshot.
4. Update `@bb/db` interaction data access with source-aware targeted queries.
5. Update serialization, validation, and equality helpers.
6. Preserve existing provider interaction API behavior and fixtures.

Exit criterion: all existing approval and AskUserQuestion tests pass against the
new origin model, and plugin-origin rows round-trip without fake provider data.

### Phase 2: server broker and routes

1. Implement the ephemeral plugin response broker.
2. Add plugin registration, response, cancellation, timeout, restart, thread
   stop/delete, and plugin-disposal lifecycle paths.
3. Add `/respond` and `/cancel` typed routes and SDK methods.
4. Add metadata-only timeline events and thread-view projection.
5. Confirm any pending interaction still blocks sends and drives existing
   sidebar/realtime state.

Exit criterion: a server test can create a plugin interaction, observe the
thread become pending, submit an arbitrary sentinel value, receive it through
the broker exactly once, and prove the sentinel occurs nowhere in SQLite,
timeline events, HTTP responses, or captured logs.

### Phase 3: backend plugin SDK

1. Add `PluginInteractions` and `bb.interactions` to the backend contract and
   real plugin API implementation.
2. Add `signal` to `PluginCliContext` and propagate request aborts.
3. Connect plugin disposal ordering to broker cancellation before invocation
   drain.
4. Extend `createFakePluginHost` with pending interaction inspection,
   submit/cancel helpers, timeouts, and CLI abort support.
5. Regenerate committed plugin SDK declarations.

Exit criterion: a fake-host test starts a blocking CLI invocation, inspects the
registered interaction, submits a value, and observes the CLI complete; abort,
timeout, and dispose cases settle deterministically.

### Phase 4: frontend plugin SDK and composer replacement

1. Add the `pendingInteraction` registration and props to the app contract.
2. Extend registration validation, slot store, runtime shim, bundled types, and
   frontend test harness.
3. Add a `PluginPendingInteraction` host mount in
   `ThreadDetailPromptArea.tsx` before the built-in pending-interaction fallback.
4. Implement matching, trusted chrome, submit/cancel callbacks, resolving
   state, missing-renderer fallback, and crash containment.
5. Add reload behavior so replacing or removing a plugin frontend rematches the
   active interaction without losing the ability to cancel.

Exit criterion: a test plugin renderer replaces the composer only for its own
active interaction; missing, wrong-plugin, wrong-renderer, crashed, and reloaded
renderers all fail safely.

### Phase 5: host file creation mode

1. Add `mode` to server contract, SDK, host-daemon contract, and file handler.
2. Validate and forward it only for file creation; preserve existing-file mode.
3. Add daemon and SDK tests for `0600` creation, existing mode preservation,
   root confinement, and CAS behavior.

Exit criterion: a remote-host SDK write can create a new file as `0600` without
changing permissions on an existing file.

### Phase 6: builtin secrets plugin and skill

1. Scaffold `plugins/secrets` as a backend + frontend workspace plugin.
2. Implement CLI parsing and preflight.
3. Implement pending-interaction request/response parsing.
4. Implement dotenv reconciliation and guarded write.
5. Implement the multi-field secret form.
6. Add the bundled `secrets` skill and complete CLI contribution metadata.
7. Register and package the builtin plugin.

Exit criterion: one `bb secret request` command requests two values, renders one
form, updates an existing dotenv file without disturbing unrelated content, and
returns no secret-bearing output.

### Phase 7: documentation, generated surfaces, and QA

1. Update `plans/plugin-system-design.md` with the new backend interaction API
   and frontend slot.
2. Update the builtin plugin-authoring skill under
   `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/`.
3. Update the CLI guide template and builtin bb-cli skill for `bb secret` as
   required by `docs/cli-guide-and-skill.md`.
4. Regenerate plugin SDK bundled declarations and generated templates.
5. Add a secrets section to `plans/plugin-system-qa-catalog.md`.
6. Run focused tests/typechecks, then the live manual matrix below.

Exit criterion: all discoverable surfaces describe the shipped behavior and no
generated file is stale.

## Automated test plan

### Domain and database

- Provider and plugin origin schemas accept only their matching payloads.
- Existing provider rows migrate with identical identities and resolutions.
- Plugin rows allow null provider identity and optional turn ID.
- Exactly one active interaction per thread remains enforced.
- Plugin queries use plugin/status indexes and do not filter all rows in JS.
- Submitted sentinel values never appear in persisted rows or lifecycle events.

### Server lifecycle

- Register -> pending -> responding -> resolved happy path.
- User cancel, timeout, request abort, thread stop, thread delete, plugin
  disable, plugin reload, and server restart.
- Two clients submitting concurrently: first wins, second receives 409.
- Submit after cancel and cancel after submit are idempotent conflicts.
- Missing broker entry interrupts safely and never accepts a value.
- Provider `/resolve` rejects plugin interactions; plugin `/respond` rejects
  provider interactions.
- Send/queue behavior remains blocked while any interaction is pending.

### Plugin SDK

- Backend registration validation, JSON round-trip, size cap, default/max TTL,
  signal behavior, and stale handle behavior.
- Frontend registration validation, unique IDs, component validation, slot
  replacement/removal, and runtime export-name checks.
- Fake backend and frontend harnesses model host semantics.
- Bundled `.d.ts` and scaffold-generated types contain the new API.

### App UI

- Matching plugin renderer replaces the composer.
- Host chrome displays plugin identity and title.
- Submit/cancel states and errors are accessible.
- Missing/crashed renderer preserves a host cancel path.
- Plugin reload remounts with a fresh boundary.
- Two browser clients converge after one submits.
- Built-in approvals and AskUserQuestion forms are unchanged.

### Secrets plugin

- CLI parses multiple names, repeated descriptions, purpose, timeout, JSON,
  and destination.
- Invalid/duplicate names, orphan descriptions, missing context, and missing
  destination fail before interaction creation.
- Form handles multiple password inputs, reveal controls, keyboard submit,
  compact layouts, cancellation, and malformed payload fallback.
- Dotenv tests cover add, update, unchanged, comments, blank lines, `export`,
  quoted values, CRLF, missing final newline, new file, duplicates, CAS retry,
  and a second CAS failure.
- New files are `0600`; existing mode is preserved.
- A recognizable sentinel secret is absent from stdout, stderr, plugin logs,
  server logs, database rows, timeline responses, and test snapshots.
- The bundled skill has valid frontmatter and is injected with the plugin tier.

## Validation commands

Generate migrations and committed SDK/template artifacts first:

```bash
pnpm --filter @bb/db db:generate
pnpm exec turbo run build --filter=@bb/plugin-sdk
node packages/templates/scripts/generate-templates.mjs
```

Use Turbo for focused validation:

```bash
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db \
  --filter=@bb/server --filter=@bb/server-contract --filter=@bb/sdk \
  --filter=@bb/plugin-sdk --filter=@bb/app --filter=@bb/host-daemon \
  --filter=@bb/cli --filter=bb-plugin-secrets

pnpm exec turbo run test --filter=@bb/domain --filter=@bb/db \
  --filter=@bb/server --filter=@bb/sdk --filter=@bb/plugin-sdk \
  --filter=@bb/app --filter=@bb/host-daemon --filter=@bb/cli \
  --filter=bb-plugin-secrets --force > /tmp/bb-secret-request-tests.txt 2>&1
```

Read `/tmp/bb-secret-request-tests.txt` and resolve every failure. Finish with
the repo's relevant build graph:

```bash
pnpm exec turbo run build --filter=@bb/server --filter=@bb/app \
  --filter=@bb/host-daemon --filter=@bb/cli --filter=bb-app
```

## Manual QA matrix

Use an isolated dev instance via `scripts/bb-dev-app current` and test:

1. An agent in workspace-write mode invokes the canonical two-secret command.
2. The composer is replaced immediately with one two-field form.
3. A second connected browser sees the same request; submitting in one closes
   both, and the second cannot submit stale values.
4. Existing comments, unrelated variables, ordering, CRLF, and file permissions
   survive the update.
5. The terminal/tool output contains names and counts but no values.
6. Cancel returns control to the agent without stopping the thread.
7. Stopping the thread dismisses the form and terminates the command.
8. Reloading/disabling the plugin dismisses the form with a safe explanation
   and does not leave a hung CLI request.
9. Restarting the server marks the orphaned interaction interrupted.
10. A remote connected host writes to its own workspace, not the server host.
11. A duplicate dotenv key fails before the user enters secrets.
12. A forced CAS conflict retries once; a repeated conflict fails without a
    partial write or a secret-bearing error.
13. A readonly agent gets the documented loopback/sandbox limitation and the
    skill does not tell it to fall back to pasting the secret into chat.
14. Disabling the builtin plugin removes both `bb secret` and its bundled skill
    from the next agent turn.

## Rollout and compatibility

- Ship the core API and builtin plugin in the same release; the plugin declares
  an `engines.bb` range requiring that API version.
- The app treats unknown plugin-origin interaction data leniently enough to
  offer Cancel, while never attempting to render it with another plugin.
- Existing provider pending-interaction rows and public behavior remain
  compatible after migration.
- The new slot and backend property are additive within the plugin SDK major.
- Plugin interactions created by a newer plugin against an older server fail at
  engine compatibility/load time rather than hanging at runtime.
- Do not add telemetry fields containing renderer payloads or responses. Counts,
  duration, outcome, plugin ID, and renderer ID are sufficient.

## Follow-up opportunities

After V1 is proven, consider:

- `bb secret exec` with host-daemon environment/stdin injection and output
  redaction;
- a host-rendered declarative secret form that keeps values out of plugin
  frontend JavaScript as well;
- durable OS-keychain-backed values with explicit user opt-in;
- optional fields and additional secret destinations;
- project/thread-parent sharing policies;
- a generic plugin submit-validation callback that can keep the composer form
  open when post-submit application fails;
- making plugin CLI loopback calls work in readonly sandboxes through a narrow
  daemon-mediated path.

These are intentionally not prerequisites for the first complete, useful
workflow.
