# Exercise: how far does the dispatch plugin API stretch?

The shipped API is deliberately minimal — every member has a consumer. This
doc pressure-tests that minimalism: for each future use case, what works
today, and what is the smallest addition when a real consumer arrives. All
pseudo-code.

## The API as shipped

Two namespaces, split by who is asking: **hooks are questions core asks and
acts on the answer to; events are announcements core makes, whose return
value is ignored.**

One hook — one checkpoint, three verdicts:

```ts
bb.experimental_hooks.on("message.dispatch", async (ctx) => {
  // ctx: thread, project, input {blocks, text},
  //      requestedExecution + executionSources,
  //      attempt: "start-turn" | "join-turn", queuedMessage | null,
  //      origin / originPluginId / parentThreadId / startedOnBehalfOf
  return { action: "proceed" };
  // or { action: "wait", reason: "why", sendAt?: epochMs }
  // or { action: "reject", message: "why not" }
});
```

A post-failure announcement, and one call that asks for another attempt:

```ts
bb.events.on("turn.failed", async (event) => {   // whatever it returns is ignored
  // event: threadId, requestId (the failed turn), turnId,
  //        errorInfo {category, providerCode, httpStatus},
  //        rateLimits (latest window), attemptNumber
  await bb.sdk.threads.retry({
    threadId: event.threadId,
    turnRequestId: event.requestId,
    sendAt: event.rateLimits.resetsAt,
    reason: "Rate limited",
  });
});
```

The retry is a by-reference row routed through the ordinary dispatch attempt:
a future `sendAt` makes it a `time` wait, an omitted one attempts it now, and
either way it runs the `message.dispatch` hook like any other send. Core
allows one live retry per original turn and computes `attemptNumber` from the
retry chain.

Facts and signals:

```ts
await bb.sdk.threads.listRunning();      // [{id, hostId}] — EXACT inside a hook
                                          // (evaluation lock + flip-before-unlock),
                                          // snapshot anywhere else
bb.events.on("message.queued",     ({entry}) => …);  // a message queued with a wait
bb.events.on("message.dispatched", ({entry}) => …);  // a queued message went
```

Scheduling is data, not API: `sendAt` on any send/create (`--send-at`,
`composer.experimental_submit({ sendAt })`); core's due sweep re-attempts.

The three shipped consumers, whole:

```ts
// concurrency-limit: the entire policy
hooks.on("message.dispatch", async (ctx) => {
  if (ctx.attempt === "join-turn") return proceed;      // already holds its slot
  const running = await sdk.threads.listRunning();
  if (running.length >= max) return wait(`${max} of ${max} running`);
  return proceed;
});

// provider-retry: the entire policy
events.on("turn.failed", (e) => {
  if (!isRateLimit(e.errorInfo) || !e.rateLimits?.resetsAt) return;
  sdk.threads.retry({ threadId: e.threadId, turnRequestId: e.requestId,
    reason: "Rate limited", sendAt: e.rateLimits.resetsAt + jitter() });
});

// scheduled-send: no hook at all — a dialog that submits with sendAt
```

How a queued message wakes (all core-driven): `sendAt` due · any thread
leaves the running set · workspace ready · interaction settled · user
Send-now · orphan sweep (owning plugin gone).

## Future use cases

### Works today, zero additions

**Quiet hours / org pause / maintenance window** — a wait with a known end:

```ts
hooks.on("message.dispatch", () =>
  inQuietHours() ? wait("Quiet hours until 8:00", quietHoursEnd()) : proceed);
```

**Budget caps on provider windows** — own accounting + wait until window end:

```ts
bb.events.on("message.dispatched", track);
hooks.on("message.dispatch", () =>
  spentThisWindow() > cap ? wait("Budget cap hit", windowEnd()) : proceed);
```

**Dependency ordering ("run after thread X") / CI-aware dispatch** — works
today by polling: wait with a short `sendAt`, and the re-attempted hook
re-checks the condition:

```ts
hooks.on("message.dispatch", async (ctx) => {
  const blocker = blockerFor(ctx.thread);
  if (blocker && !(await isDone(blocker)))
    return wait(`After ${blocker.title}`, now() + 30_000);   // poll via sendAt
  return proceed;
});
```

Polling through the hook is the *designed* degraded mode for any
external-event wait. Latency = poll interval. Good enough until a consumer
proves it isn't.

### Needs addition #1: amendments (`proceed` gains `amend`)

For **modifying dispatch parameters** — org model policy, DLP/prompt
rewriting, auto model selection:

```ts
hooks.on("message.dispatch", (ctx) => {
  if (ctx.executionSources.model !== "explicit")
    return proceed({ amend: { model: orgDefaultModel } });
  return proceed;
});

// DLP: input amendment is legal even on join-turn (steers) — the one
// amendment that never conflicts with a running turn
hooks.on("message.dispatch", (ctx) =>
  proceed({ amend: { input: redact(ctx.input.blocks) } }));
```

This exact machinery shipped and was cut when its consumer (auto routing)
died: verdict schema, per-field validation windows (`join-turn` → input
only; provider only before the first session), provenance
(never-remembered-as-defaults), and the original-vs-effective audit. It
returns from git history as a unit. The one open design each revival must
re-decide: whether amendments compose across the handlers in a pass (they did
— last writer per field, which forces per-handler context rebuilds and
ordering questions).

### Needs addition #2: plugin-initiated wake (`clearWait`) — external events

For **custom environment provisioning** (the sandbox), human-approval
waits, webhook-driven dispatch — waits whose end only the plugin observes:

```ts
hooks.on("message.dispatch", (ctx) => {
  if (!wantsSandbox(ctx)) return proceed;
  startProvisioning(ctx.queuedMessage?.id ?? "inline", ctx);   // background
  return wait("Provisioning sandbox…");                        // no sendAt
});

// background service, minutes later:
const host = await createVm().then(enrollViaJoinCode);         // existing SDK
await bb.experimental_hooks.clearWait(rowId, {                 // hypothetical
  amend: { environment: { type: "host", hostId: host.id, workspace } },
});
// clearWait re-runs the FULL pass (limiter still applies), and a refused
// amendment leaves the row queued — both properties were shipped and tested
```

`clearWait` shipped and was cut (consumers absorbed by core drains /
deleted). Its design is the best-preserved of the cuts: ownership as the
authorization model, re-ask-not-send, refuse-before-settle. The sandbox
also wants **`report()`** back (progress steps + ETA on the queue row) —
same story, same commit history. Note the sandbox needs BOTH additions:
`clearWait` to wake, `amend.environment` to land the thread on the new host.

### Needs addition #3: new wait kinds / wake sources (core-side, additive)

Some futures are core facts, not plugin powers: warm worktree pools
(`environment.destroy` interception), a `host-offline`-style wait for a new
condition, new drain triggers. Each is an added arm on `waitingOn` plus a
drain hook — the schema and drain structure were built to take new arms
without touching existing ones.

## The pattern

The API scales on exactly three axes, and every use case above lands on one:

| Axis | Mechanism | Cost when needed |
|---|---|---|
| New *policies* | compose `wait`/`proceed`/`reject` + sdk facts + `sendAt` polling | zero — write a plugin |
| New *powers* | `amend` on proceed; `clearWait`/`report` for external wakes | revive from history against the real consumer |
| New *conditions* | `waitingOn` arms + drain triggers in core | additive core change |

The bet, stated plainly: everything cut was cut *because* it re-adds
cleanly. The verdict union extends without breaking handlers; queue rows
carry new wait kinds without schema surgery; and the degraded mode
(sendAt polling) means no use case is ever *impossible* before its
addition lands — only slower.
