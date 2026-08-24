# @bb/agent-runtime

Manages provider bridge processes and exposes a clean session interface. Handles process spawning, stdio framing, JSON-RPC dispatch, event assembly, tool call routing, crash detection, and shutdown.

Consumers say "start a thread, run a turn, give me events" — they never touch processes, adapters, or wire formats.

## Public API

```typescript
import { createAgentRuntime } from "@bb/agent-runtime";

// There is no provider discovery here: providers are declared server-side by
// plugins, and every command that reaches a bridge carries its `bridgeLaunch`
// (which bridge binary to run, plus the declared capabilities to run it with).

// Runtime — supports multiple providers and threads simultaneously
const runtime = createAgentRuntime({
  workspacePath: "/path/to/workspace",
  env: { OPENAI_API_KEY: "..." },       // passed to all provider processes
  bridgeBundleDir: "/path/to/bundled-bridges", // optional; used when bridges are packaged outside src/dist
  onEvent: (event) => {
    // Every event has event.threadId (bb ID) and event.providerThreadId (provider's internal ID)
    // See ProviderThreadEvent in @bb/domain for the full type
  },
  onToolCall: async (req) => { /* ToolCallRequest → ToolCallResponse */ },
  onStderr: (line) => { /* provider stderr */ },
  onProcessExit: (info) => { /* crash detection */ },
});

// Start a thread, run turns, get events via callbacks. `bridgeLaunch` is the
// plugin-delivered bridge the host daemon resolved for this provider (a
// verified artifact path, the plugin's declared capabilities, its static
// provider options); the runtime infers nothing from the provider id.
const { providerThreadId } = await runtime.startThread({
  environmentId: "env-1",
  threadId: "t1",
  projectId: "p1",
  providerId: "my-provider",
  bridgeLaunch,
  options: { permissionMode: "full", instructions: "Be concise." },
  dynamicTools: [{ name: "my_tool", description: "...", inputSchema: { ... } }],
});

await runtime.runTurn({
  threadId: "t1",
  input: [{ type: "text", text: "Hello" }],
});

// Multiple threads on the same runtime, even across providers
await runtime.startThread({
  environmentId: "env-1",
  threadId: "t2",
  projectId: "p1",
  providerId: "another-provider",
  bridgeLaunch: anotherBridgeLaunch,
});

// Resume across process lifetimes
await runtime.resumeThread({
  environmentId: "env-1",
  threadId: "t3",
  providerThreadId, // from previous session
  providerId: "my-provider",
  bridgeLaunch,
});

await runtime.shutdown();
```

### Event types

Events from provider processes are `ProviderThreadEvent` — they carry both `threadId` (bb ID) and `providerThreadId` (provider's internal ID). Events from the server/system layer are `SystemThreadEvent` — they only have `threadId`. Both are part of the `ThreadEvent` union from `@bb/domain`.

### Fail-fast behavior

The runtime fails fast when providers crash or are unavailable:

- **Binary not found** → `ensureProvider` rejects immediately
- **Crash during initialize** → `ensureProvider` rejects with stderr output
- **Crash during a turn** → pending `runTurn` promise rejects with "exited unexpectedly"
- **Crash between turns** → next `runTurn` call rejects immediately
- **`thread/start`, `thread/resume` or `thread/fork` result without `providerThreadId`** → the construction rejects immediately with `Invalid JSON-RPC result for thread/start: providerThreadId: …` (naming the method), tells the bridge to release the thread (`thread/stop { intent: "release" }`, best effort) and forgets it; a `thread/identity` notification never stands in for the result
- **`thread/resume` rejected or timed out** → `resumeThread` rejects with the bridge's error; the thread is released on the bridge (best effort) and forgotten exactly as after a failed `thread/start`, so the next command resumes it again rather than running a turn on a session the bridge never opened

### Multi-thread / multi-provider

A single runtime can manage multiple threads across multiple providers simultaneously. Each provider process is spawned once and shared across threads. The runtime stamps every event with the correct bb `threadId` and `providerThreadId` regardless of how the provider internally identifies threads.

## Running Tests

```bash
# Unit tests (no credentials needed, uses fake provider process)
pnpm --filter @bb/agent-runtime test:unit

# Integration tests (requires real provider credentials)
pnpm --filter @bb/agent-runtime test:integration

# All tests
pnpm --filter @bb/agent-runtime test
```

### Integration test requirements

All providers must be authenticated in the current environment before running integration tests. Each provider manages its own credentials (auth files, env vars, etc.).

### Working with integration tests

Integration tests hit real provider APIs and take 30-60 seconds. Some lessons learned:

**Don't assume provider behavior — test it directly.** Each provider has different concurrency, turn lifecycle, and session resume semantics. When a test fails or hangs, write a small standalone test that probes the provider directly (e.g., "does codex handle two concurrent turns on different threads?") instead of guessing and tweaking timeouts. The `vitest.config.ts` unit test config is handy for running quick one-off investigations since it includes `src/**/*.test.ts`.

**Save output to a file, then read it.** Tests are slow — if you pipe output through `grep` and it doesn't match, you've wasted a full test run. Instead:

```bash
pnpm --filter @bb/agent-runtime test:integration -- --reporter=verbose > /tmp/integ-out.txt 2>&1
# Then inspect:
grep -E "(✓|×|Test Files|Tests )" /tmp/integ-out.txt
```

**Tests run concurrently within each scenario file.** All 3 provider variants in a file run in parallel via `describe.concurrent`. Scenario files run serially because Pi and other real providers share local auth state and external provider limits; running every scenario file at once has caused real-provider flakes where a turn completes without the expected tool execution.

The root `test:integration --force` run also schedules `@bb/integration-tests#test:integration` after `@bb/agent-runtime#test:integration`. Those two package-level suites both exercise real providers and can share local subscription auth/session state, so only the cross-package real-provider suites are ordered. Concurrency inside each suite remains covered, including multi-provider runtime tests and `real/provider-concurrency.test.ts`.

**When a test hangs**, the provider is likely not responding to a JSON-RPC request. Common causes:

- Bridge Zod schema rejects the request silently (check that `buildCommand` output matches what the bridge expects)
- Provider needs credentials that aren't in the environment
- Bridge process crashed on startup (check stderr — the runtime captures it in `proc.stderrChunks`)

### Building

`@bb/agent-runtime` is source-only inside this workspace and builds no bridges.
A bridge is a provider plugin's build artifact; the host daemon resolves it to a
verified local path and names it in every command's `bridgeLaunch`.

## Architecture

```
Consumer (host-daemon)
  │
  └─ createAgentRuntime(options)
       │
       ├─ AgentRuntime                 Process lifecycle, JSON-RPC framing,
       │   ├─ ensureProvider()         event routing, tool call dispatch
       │   ├─ startThread()           Deduplicates concurrent provider starts.
       │   ├─ runTurn()               Fails fast if provider has crashed.
       │   └─ shutdown()
       │
       ├─ BridgeProtocolAdapter        The one adapter: builds canonical
       │   ├─ buildCommandPlan()       Provider Bridge Protocol requests,
       │   ├─ translateEvent()         assembles `thread/delta` notifications
       │   └─ decodeToolCallRequest()  into ThreadEvents, decodes tool calls
       │                               and interactive requests
       │
       └─ Bridge Process               The plugin-delivered bridge artifact,
                                       run under the bridge worker bootstrap;
                                       one process per provider artifact in
                                       the environment
```

Every provider — first-party plugin bridges, third-party plugin bridges, the
test harness's scripted echo bridge — speaks the Provider Bridge Protocol
(`@bb/provider-bridge-protocol`), so there is one adapter and no
provider-specific implementation behind an interface. The runtime never
interprets provider-specific wire content: each bridge owns its provider's
quirks and emits parsed semantic deltas that the shared assembler turns into
canonical timeline events. Which binary runs comes from the `bridgeLaunch` on
every command (the host daemon resolves the plugin's artifact to a verified
local path); the provider id is an opaque label here.

## Dependencies

- `@bb/domain` — shared types (ThreadEvent, ProviderThreadEvent, PromptInput, ToolCallRequest, etc.)
- `@bb/provider-bridge-protocol` — the bridge wire contract, the `thread/delta` assembler, and the bridge kit
- `@bb/process-utils` — child-process helpers
- `zod` — schema validation at provider boundaries
