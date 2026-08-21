# Scripted echo provider (test harness)

The scripted echo bridge is the provider bb's runtime and integration suites
drive. It is the echo example bridge (`examples/plugins/echo-provider`) plus
the scripted directives a test needs, and it runs through the real
bridge-protocol adapter and delta assembler — there is no test-only adapter
path in the runtime.

Prompt directives:

- `delay:<ms>` holds the turn open before it settles.
- `approve:<command|file_change|permission_grant|plan>` raises an approval
  on `interaction/request`; a denied approval answers `Denied`.
- `ask_user` raises a user question and echoes the answer.
- `call_tool:<name>` / `call_tool_unresolved:<name>` calls a dynamic tool
  with a resolved or an unresolved turn id and answers `Tool called: <name>`.
- Otherwise the turn answers `Response to: <prompt text>`.

Session- and process-level behaviour (archived sessions, failing commands,
crashes, slow starts) is scripted through `ScriptedEchoOptions`: set
`options.providerOptions.scripted` on a bridge launch, or the
`SCRIPTED_ECHO_OPTIONS` env JSON for behaviour that must apply before any
session exists. `SCRIPTED_ECHO_RECORD_PATH` appends every handled request to
a JSONL file for assertions on what reached the provider.

The integration harness builds `host.ts` into an artifact exactly as the
plugin runtime builds a real provider plugin; the runtime unit suites import
the TypeScript source as the artifact (the bridge bootstrap runs under tsx
from source). `provider-bridge.conformance.test.ts` pins the bridge against
the canonical protocol suite.
