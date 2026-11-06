# Operations Kernel

The server's public actions are operations in one registry, the operations
kernel (`packages/operations`, held by the server in `apps/server/src/kernel`).
An operation has a name, a kind (`read` | `write`), a hook policy, an input
parser, an output check and doors (`http`, `cli`). One owner implements it,
anyone calls it, and every call runs as a caller.

This is the foundation: core routes and core `bb` commands run through it, and
nothing about plugins changes. Plugin rpc methods, `message.dispatch` and every
plugin API keep their existing paths. Plugin hooks, a plugin operations API,
stability levels, an audit log and a contract lock build on it later.

## Where operations come from

- **Names.** Every route in `publicApiRoutes` (`packages/server-contract`) is an
  operation built by `publicOperations()` in `public-operations.ts`. Its name
  comes from the frozen table in `operation-names.ts`, which maps each route
  key to a name (`threads.send`, `threadSections.create`). The compiler rejects
  a route without an entry and an entry without a route, and loading rejects
  two routes with one name, so renaming a route key keeps the operation's
  name.
- **Kinds.** `operation-kinds.ts` declares every operation's kind in a table
  the compiler checks against the names (POST reads such as
  `threads.ancestors` are reads). Reads get hook policy `rewrite`, writes
  `answer`.
- **Inputs.** An operation's input is one flat object: path params plus body
  or query fields (`{ id, input, mode }` for `threads.send`). A body that is not
  an object sits under a named field (`system.keyboardSettings` takes
  `{ overrides }`). The door merges the request into that object and clients
  split it back (`routeInputFromRequest`, `routeRequestFromInput`). Fields are
  parsed with the route's schema; a parse failure is 400 `invalid_request`. A
  route whose body or query declares a field with a path parameter's name
  fails to load, so the flat input is never ambiguous.
- **Outputs.** Every operation has an output schema in `output-schemas/`
  (`null` for binary and text routes), checked by the compiler against the
  route's response type. The kernel validates a result a hook produced; a
  result straight from core's implementation is not re-validated.
- **Coverage.** `createApp` fails to start if any operation has no
  implementation (`assertEveryOperationImplemented`).
- **Not operations.** `/internal/*` daemon routes, WebSockets, plugin wire
  routes (`/plugins/:id/rpc/:method`, `/plugins/:id/cli`,
  `/plugins/:id/http/*`), and asset serving.

## Registering implementations

Route files receive `OperationRoutes` (`kernel/http-door.ts`) and register
every handler with `implement(route, (input, { caller, signal, request }) =>
value | OperationBody)`. There is no HTTP-only registration.

- **Inputs.** JSON bodies and queries arrive as flat fields. A multipart route
  gets its form fields in the flat input, files as web `File`s. `request` is
  the web `Request` (conditional GETs, forwarded host, `Prefer`).
- **Outputs.** A plain value is serialized as JSON with the route's success
  status and the operation's door headers (`Cache-Control: no-store` for the
  desktop-browser credential routes and mobile releases, from
  `RESPONSE_HEADERS`). Bytes, streams and statuses the route does not declare
  are an `OperationBody` (`packages/operations/src/body.ts`): a plain object
  `{ body: "bytes" | "stream", status, contentType, headers, bytes | stream }`
  built with `bytesBody`, `streamBody`, `emptyBody` and `jsonBody`. Byte routes
  must return one; a JSON route may return one for an undeclared status
  (`threads.eventWait`'s 204, the 202 install and update jobs). The route
  serializes it with `operationBodyResponse`, and the CLI decodes a byte route
  back into a stream body with `operationBodyFromResponse`. Detection is
  structural (`isOperationBody`), not `instanceof`.

## Callers

`OperationCaller` is `{ user, door, thread, via }` (`kernel/caller.ts`), held
in an `AsyncLocalStorage` so nested calls inherit it. `user` is `machine` for
a gate machine credential and `owner` otherwise; routes that machines may not
use check it. `door` and `thread` come from request headers, and `via` is
empty until plugins call operations.

## Hooks

The kernel runs hooks outermost first by tier, then registration order:
`observe` ignores what a hook passes and returns, `rewrite` must call `next`,
`answer` may return without `next` or `deny(reason)`, and `vote` collects one
vote per hook for the implementation. A hook that throws or passes its 10 s
budget is skipped unless it is fail-closed. Only the kernel's tests register
hooks today; the server exposes no way to add one.

## CLI doors

Every core `bb` command is a door on an operation (`apps/cli/src/operation-doors.ts`):

- `publicCommand(name, door)` mounts a command for a public operation and
  sends it through the operation's own route (`apps/cli/src/operation-call.ts`,
  the CLI's transport plus the contract's route table).
- `clientCommand` declares a command whose `run` composes several operations,
  waits, polls, streams, or works locally (starting the server, the guide).

A door (`CliDoor`) names a path, aliases, help text (`summary`, `description`,
`usage`, `helpAfter`), `isDefault`, positionals, flags, a `--self` context
fill, `confirm` (adds `--yes`), `declined`, `interrupt`, `prepare(values,
client)` to build the input, an optional `run`, `print`, `json` (or `noJson`),
`failure` and `exitCode`. Flags are one line each:
`flag("--name <name>", "Set the project name")`, with `-s, ` for a short
name, `--no-` for a negatable flag, and `{ type, field, required, default,
hidden }` for the rest. `--json` and `--yes` are appended unless a door
declares them. `cliCommandFromDoor` (`packages/operations/src/cli-door.ts`) is
the one generator; the mount builds the commander command from it.

`client.confirm` returns at once under `--yes`; otherwise it asks, and a "no"
prints the door's `declined` message and exits with its code. A door that
declares `interrupt` gets a `client.signal` that SIGINT aborts, and a `run`
that fails after the abort exits 130 with the `interrupt` text.

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
