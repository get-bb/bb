# RAPP provider

The bundled RAPP provider runs bb threads over the frozen `rapp/1` protocol. It
supports both production Grails:

- **Consumer:** [`kody-w/rapp-installer`](https://github.com/kody-w/rapp-installer),
  using `POST /chat`.
- **Business:** [`microsoft/aibast-agents-library`](https://github.com/microsoft/aibast-agents-library),
  using `POST /api/businessinsightbot_function`.

The bridge sends `user_input`, optional `session_id`, `idempotency_key`, and
`conversation_history`, adapts both Grails' response envelopes, and stores the
bb transcript as a canonical RAPP/1 `session` egg so a host-daemon restart can
resume the same conversation.

## Consumer Grail

The default points to `http://127.0.0.1:7071/chat`. bb reuses a healthy shared
Brainstem or starts the installed `~/.brainstem` runtime with the same bounded
launcher pattern as RAPP Brainstem Frontier. It stops only a process it started
itself. `bb provider models rapp` reads Brainstem's verified GitHub Copilot
catalog. Select one of those model ids, or use the selected-only `brainstem`
alias to follow Brainstem's current default.

Set a different base URL or full `/chat` URL with either:

```bash
bb plugin config provider-rapp set endpoint https://brainstem.example.com/chat
```

or the host-daemon environment variable `RAPP_BRAINSTEM_URL`. Deployments that
require `X-Brainstem-Secret` read it from `RAPP_BRAINSTEM_SECRET`. Endpoint
URLs may not contain credentials, query parameters, or fragments; header
credentials require HTTPS outside loopback. Automatic startup is limited to
plain HTTP `localhost` or `127.0.0.1` `/chat` endpoints.

Brainstem's current `/models/set` endpoint changes a process-global selection,
so bb serializes each concrete model selection with its complete `/chat`
request per endpoint. Brainstem remains the owner of Copilot authentication,
catalog filtering, fallback, soul, agents, and execution.

## Durable turn safety

bb persists the complete transcript in canonical RAPP/1 session eggs and
journals a successful response before delivering it to the thread. A bridge
restart can recover a response committed before delivery.

RAPP/1 caps each canonical session egg at 1 MiB. Responses are capped at
64 KiB, and bb reserves enough space for a maximum-size response before calling
`/chat`. When a thread no longer has that capacity, the turn fails locally and
must continue in a new thread.

Some installed Brainstem versions accept but do not enforce
`idempotency_key`. If a `/chat` attempt may have completed but bb did not
receive a valid response, bb retains the pending request for audit and refuses
to replay it automatically. Start a new thread to continue without risking a
duplicate agent action.

## Business Grail

Select the Business Grail and configure the Azure Function App URL:

```bash
bb plugin config provider-rapp set grail business
bb plugin config provider-rapp set endpoint \
  https://YOUR_APP.azurewebsites.net/api/businessinsightbot_function
```

The endpoint can instead come from `RAPP_BUSINESS_URL`. Put the Function key in
the host-daemon environment as `RAPP_FUNCTION_KEY`; the bridge sends it through
`x-functions-key` and never stores it in bb settings, provider options, thread
events, or the endpoint URL. Business endpoint URLs also may not contain query
parameters or fragments. `RAPP_USER_GUID` optionally selects the Business
Grail's persistent user memory.

## CLI

```bash
bb provider models rapp
bb thread spawn --project <project-id> --provider rapp \
  --model <brainstem-copilot-model-id> --prompt "Use my RAPP agents."
```

The same generic SDK surfaces work without a RAPP-specific client:

```ts
const models = await sdk.providers.models({ providerId: "rapp" });
const model = models.models.find((candidate) => candidate.isDefault)?.model;
if (!model) throw new Error("RAPP Brainstem returned no default model");
const thread = await sdk.threads.spawn({
  projectId,
  environment: { type: "project-default" },
  providerId: "rapp",
  model,
  prompt: "Use my RAPP agents.",
});
```
