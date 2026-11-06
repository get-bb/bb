# Operations Kernel

Every public server route is an operation in one registry, the operations
kernel (`packages/operations`, held by the server in `apps/server/src/kernel`).
An operation is a name, an HTTP door and an input parser, all derived from its
route; core implements it once, and the route, the SDK and the CLI all reach
it by name.

This is the foundation: nothing about plugins changes. Plugin rpc methods,
`message.dispatch` and every plugin API keep their existing paths. What builds
on it later is listed at the end.

## Where operations come from

Every route in `publicApiRoutes` (`packages/server-contract`) is an operation,
built by `publicOperations()` in `public-operations.ts`. There are no side
tables: everything comes from the route definition.

- **Name.** The route key: `threads.send`, `threadSections.create`.
- **HTTP door.** The route's method, path and success status, plus any
  `headers` the route declares (`Cache-Control: no-store` on the
  desktop-browser credential routes and mobile releases).
- **Request types.** Written once: path params come from the path literal
  (`/threads/:id/files/:filePath{.+}` gives `{ id, filePath }`), and
  `jsonRequest(schema)`, `queryRequest(schema)` and the other helpers take
  the client's type from `z.input` and the server's from `z.output` of the
  same schema. Only form routes name their field types.
- **Input.** One flat object: path params plus body or query fields
  (`{ id, input, mode }` for `threads.send`). A body that is not an object
  sits under a named field (`system.keyboardSettings` takes `{ overrides }`).
  The door merges the request into that object and clients split it back
  (`routeInputFromRequest`, `routeRequestFromInput`). Fields are parsed with
  the route's schema; a parse failure is 400 `invalid_request`. A route whose
  body or query declares a field with a path parameter's name fails to load,
  so the flat input is never ambiguous.
- **Coverage.** `createApp` fails to start if any operation has no
  implementation (`assertEveryOperationImplemented`).
- **Not operations.** `/internal/*` daemon routes, WebSockets, plugin wire
  routes (`/plugins/:id/rpc/:method`, `/plugins/:id/cli`,
  `/plugins/:id/http/*`), and asset serving. The daemon routes and the
  daemon's own local API are still declared with `defineRoute`
  (`hostDaemonInternalRoutes`, `hostDaemonLocalRoutes`) and mounted with
  `mountRoute` from `@bb/hono-typed-routes`, which parses the body or query
  with the route's schema and checks a JSON result against its response type;
  their hono client types are derived from those definitions.

## Registering implementations

Route files receive `OperationRoutes` (`kernel/http-door.ts`) and register
every handler with `implement(route, (input, { caller, signal, request }) =>
value | OperationBody)`. There is no HTTP-only registration.

- **Caller.** `caller.user` is `machine` for a gate machine credential and
  `owner` otherwise; routes that machines may not use check it.
- **Inputs.** JSON bodies and queries arrive as flat fields. A multipart route
  gets its form fields in the flat input, files as web `File`s. `request` is
  the web `Request` (conditional GETs, forwarded host, `Prefer`).
- **Outputs.** A plain value is serialized as JSON with the route's success
  status and the route's headers. Bytes, streams and statuses the route does not declare
  are an `OperationBody` (`packages/operations/src/body.ts`): a plain object
  `{ body: "bytes" | "stream", status, contentType, headers, bytes | stream }`
  built with `bytesBody`, `streamBody`, `emptyBody` and `jsonBody`. Byte routes
  must return one; a JSON route may return one for an undeclared status
  (`threads.eventWait`'s 204, the 202 install and update jobs). The route
  serializes it with `operationBodyResponse`, and the CLI decodes a byte route
  back into a stream body with `operationBodyFromResponse`. Detection is
  structural (`isOperationBody`), not `instanceof`.

## The SDK's operation caller

`packages/sdk/src/operation-call.ts` (`@bb/sdk/operation-call`, internal)
calls a public operation by name with its flat input: it finds the route in
the contract, splits the input into path params, query, JSON or form body
with `routeRequestFromInput`, escapes path params (each segment of a
`:filePath{.+}` param), and sends it through the transport's typed client.
Options carry the signal, extra headers (`prefer: respond-async` for plugin
installs and updates) and `keepalive`. `call` returns the JSON, `null` for a
204 or an `OperationBody` for a byte route (attachment and file reads, the
export stream, the provider-CLI install log); `send` ignores the body. Every
SDK area receives it as `operations`, so an area method is the argument
renames and transforms its public signature promises, then one `call`. The
CLI uses the same caller. Only `plugins.callRpc` keeps its own fetch, since
the plugin rpc wire route is not an operation; polling helpers such as
`threads.wait` loop over calls.

## CLI doors

Every core `bb` command is declared as a door (`apps/cli/src/cli-door.ts`,
mounted by `apps/cli/src/operation-doors.ts`):

- `publicCommand(name, door)` is one call of a public operation, sent through
  the operation's own route by the SDK's operation caller.
- `clientCommand(door)` is a command whose `run(values, client)` chains
  operations, waits, polls, streams, or works locally (starting the server,
  the guide).

Flags and arguments are records, and their values are typed from the spec:

```ts
publicCommand("projects.branches", {
  path: ["project", "branches"],
  summary: "List branches available for a project source",
  positionals: { id: arg("<id>") },
  options: {
    hostId: flag("--host <id>", "Source machine ID", { required: true }),
    query: flag("--query <query>", "Branch-name filter"),
    limit: flag("--limit <count>", "Maximum branches"),
  },
});
```

`flag("--x", …)` is a boolean, `--no-x` a negatable boolean, `--x <v>` a
string (`{ type: "integer" | "number" | "strings" }` for the rest, `required`
or `default` to drop `undefined`). `arg("<x>")` is a string, `[x]` optional,
`<x...>` a list. Code reads `values.options.hostId`; a misspelt key does not
compile. Record order is help order.

A `publicCommand` without `prepare` builds its input by key: each argument
and flag becomes the input field of the same name (or its `field`), with
`undefined`, `false`, `""` and `[]` left out and `fixed` merged in. A flag with
`context: { field, from }` fills that field from the CLI context
(`--self` and `BB_THREAD_ID`). Registration fails if a key is not one of the
operation's input fields (`routeInputFields`), so a command that needs any
other mapping declares `prepare(values, client)`.

The rest of a door: aliases, help text (`summary`, `description`, `usage`,
`helpAfter`), `isDefault`, `confirm` (adds `--yes`), `declined`, `interrupt`,
`print`, `json` (or `noJson`), `failure` and `exitCode`. `--json` and `--yes`
are appended unless a door declares them. `client.confirm` returns at once
under `--yes`; otherwise it asks, and a "no" prints the door's `declined`
message and exits with its code. A door that declares `interrupt` gets a
`client.signal` that SIGINT aborts, and a `run` that fails after the abort
exits 130 with the `interrupt` text.

Not mounted from doors: the hidden `bb environment status|branches|diff`
redirects to `bb git`, and the `bb <plugin> …` proxy.

## Behaviour changes

Differences from main that a user, a script or an HTTP client can observe:

| Command or route | Before | After | Why |
| --- | --- | --- | --- |
| `bb settings keyboard set\|reset --platform <bad>` | The schema error's message on stderr from the top-level handler, exit 1 | `Error: ` and the same message (and the `--json` error envelope), exit 1 | Validation moved into `prepare` |
| `bb theme favicon set <bad color>` | Read the theme, then failed | Fails before any server read; same output | Validation in `prepare` |
| `bb voice transcribe` | SDK fetch, client-side schema check | The operation's route with form encoding; the server's output schema checks it | One dispatch path |
| `bb marketplace refresh` with a failed catalog; declining `bb plugin install\|update\|migrate` or running them without a terminal | `process.exit(1)` | `process.exitCode = 1`; same output and status | Doors set the exit code |
| Plugin management routes with a malformed body or query (catalog install, marketplace add/refresh, safe mode, settings, update check, rpc discovery) | Handler-specific body, sometimes 422 | 400 `{ code: "invalid_request", message }`; invalid or empty JSON is 400 "Invalid JSON request body"; semantic errors keep their bodies | Input validation belongs to the operation's schema |
| `POST /plugins/:id/token` with no body | 200 | 400 (CLI and SDK always send `{}`) | It is a JSON-body operation |
| `searchMentions`, `POST /plugins/install` | Browser guard before input parsing | After input parsing | The guard reads `request` inside the operation |

## What builds on this later

Kept in `bb/operations-kernel-full` for the plugin PR, each arriving with its
first user:

- Hooks (observe, rewrite, answer, vote), `deny`, serialized calls, plugin
  scopes, and the caller's door, thread and plugin path carried through
  nested calls.
- Kinds (`read` / `write`) and output checks, declared on the route
  (`kind: "read"` for the POST reads, `jsonResponse(schema)`), since both only
  matter to hooks.
- `bb.experimental_operations`, stability levels, plugin rpc methods as
  operations, `message.dispatch` on the kernel, the audit log, and a
  generated, test-checked list of frozen names.
