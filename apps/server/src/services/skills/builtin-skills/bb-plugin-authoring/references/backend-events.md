# Events, HTTP, RPC, realtime, and background work

### bb.events.on — thread lifecycle events

```ts
bb.events.on("thread.created", ({ thread }) => { ... });
bb.events.on("thread.active", ({ thread }) => { ... });
bb.events.on("thread.idle", ({ thread, lastAssistantText }) => { ... });   // lastAssistantText: string | null
bb.events.on("thread.failed", ({ thread, error }) => { ... });             // error: string | null
bb.events.on("thread.archived", ({ thread }) => { ... });
bb.events.on("thread.deleted", ({ thread }) => { ... });
```

Exactly six events. `thread.active` fires when an applied lifecycle
transition enters the running `active` state. `thread.archived` fires after a
thread is archived, including cascade archives (archiving a parent archives
its children too, each with its own event). Observe-only handlers run
fire-and-forget after the transition and can never block or veto it. `thread`
is the same DTO `GET /api/v1/threads/:id` serves. Errors are caught, logged,
and counted in the plugin's handler stats (`bb plugin list`).

Lifecycle events are broadcast to all loaded plugins regardless of sidebar
visibility.

`thread.created` fires on row creation, so the first user message is not
always in the timeline yet. To react to a thread's content, listen on
`thread.active` or `thread.idle`, then read the messages with
`bb.sdk.threads.timeline`. Because handlers are fire-and-forget, work you do
in a handler — including `bb.sdk.threads.update({ threadId, title })` —
cannot delay or interrupt the thread's turn.

### bb.http — HTTP routes

`bb.http.route(method, path, handler, { auth? })` mounts an exact-match route
at `/api/v1/plugins/<id>/http/<path>`. The allowed methods are `GET`, `POST`,
`PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. The path must start with `/`.
The router treats `:` and `*` as literal characters, not parameters or
wildcards. The handler is a Hono handler:
`(context) => Response | Promise<Response>`.
Auth modes:

- `"local"` (default) — accepts no `Origin` header or a trusted BB app origin.
  A non-GET mutation must use `application/json`. Use this mode for the BB
  frontend.
- `"token"` — requires the per-plugin token (`bb plugin token <id>`;
  `--rotate` generates a new one, invalidating the old) via the
  `x-bb-plugin-token` header or `?token=`. Right for external scripts
  and machines you control.
- `"none"` — no checks. ONLY for webhooks that verify their own signature
  (e.g. Slack's `x-slack-signature` HMAC) inside the handler.

### bb.rpc — the frontend data plane

Define method names plus runtime input/output schemas once, then register
handlers against that contract. Schemas use validator-neutral Standard Schema
v1, which Zod 4 implements directly. The server RPC boundary validates input
before it invokes the handler. It validates output before serialization.
Handler parameters and return values are inferred from the schemas.

```ts
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  listIssues: {
    input: z.object({ filter: z.string().optional() }).strict(),
    output: z.object({ issues: z.array(z.object({ id: z.string() })) }),
  },
  status: {
    input: z.null(), // null input lets the frontend omit the argument
    output: z.object({ ready: z.boolean() }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    listIssues({ filter }) {
      return { issues: listCachedIssues(filter) };
    },
    status() {
      return { ready: true };
    },
  });
}
```

In `app.tsx`, import only the backend contract's type. The backend module and
its dependencies are erased from the frontend bundle:

```tsx
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function IssuesButton() {
  const rpc = useRpc<typeof rpcContract>();

  async function loadIssues() {
    const { issues } = await rpc.call("listIssues", { filter: "open" });
    return issues;
  }

  return <button onClick={() => void loadIssues()}>Load issues</button>;
}
```

The wire envelope is `{ ok: true, result }` or `{ ok: false, error }`.
Failures use stable codes: `invalid_json`, `invalid_input`, `handler_error`,
`invalid_output`, `non_json_result`, and `unknown_method`; validation failures
also carry normalized `{ message, path? }[]` issues. Unknown methods return
404, invalid JSON/input returns 400, and handler/output/serialization failures
return 500. Results must be strict JSON values: cyclic objects, bigint,
undefined/functions, class instances, symbol keys, and non-finite numbers are
rejected rather than coerced or silently dropped.

### bb.realtime

`bb.realtime.publish(channel, payload)` broadcasts an ephemeral
`{ type: "plugin-signal", pluginId, channel, payload }` message to every
connected client. The channel must be non-empty. V1 has no server-side channel
subscriptions. The frontend hook `useRealtime(channel, handler)` filters the
messages. The payload must be JSON-serializable; `undefined` becomes `null`.
Nothing is persisted. Publish state-change signals and let the frontend
refetch through RPC.

### bb.background — services and schedules

```ts
bb.background.service("worker", {
  async start(signal) {
    while (!signal.aborted) {
      await doWork();
      await sleep(60_000, signal);
    }
  },
});
bb.background.schedule("sync", "*/5 * * * *", async () => {
  await syncNow();
});
```

- A **service** starts after the factory completes and must resolve when
  `signal` aborts (reload/disable/shutdown). A crash restarts it with
  capped exponential backoff.
- A **schedule** is a 5-field cron (server-local time) backed by a durable
  row keyed (pluginId, name) — it survives server restarts, and the sweep
  claims due rows with a compare-and-swap, but it only fires while the
  plugin is loaded.
- Semantics differ on throw: a service throwing `NeedsConfigurationError`
  transitions the whole plugin to `needs-configuration` and stops
  restarting until the next load; a schedule throw (any error) only lands
  in the schedule's `last_status`/`last_error` shown by `bb plugin list`.
- `NeedsConfigurationError` is matched **by name**, so no runtime import is
  needed: `throw Object.assign(new Error(msg), { name:
"NeedsConfigurationError" })`. Pair it with `bb.status.needsConfiguration`
  in the factory so an unconfigured plugin reports itself instead of
  crash-looping:

```ts
const initial = await settings.get();
if (!initial.apiKey)
  bb.status.needsConfiguration(
    "Set apiKey with `bb plugin config <id>`, then reload.",
  );
```
