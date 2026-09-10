# Discoverable RPC and replaceable provider usage displays

Status: prototype implemented for discoverable RPC, Account Pooler, Codex, Claude Code, and the core `/settings/usage` page. The broader Provider Usage plugin migration remains planned. The core settings page preserves its existing presentation and machine picker; only its data source changes.

## Prototype verification

- Relevant typechecks passed across the server, app, CLI, SDK, Plugin SDK, and three source plugins (13 Turbo tasks).
- Focused tests passed: 3 RPC publication tests, 10 server SDK tests, 1 SDK discovery/call test, 2 provider-source tests, 141 Account Pooler server tests, and 13 settings usage tests.
- The isolated dev server advertises all three implementations with registration/method descriptions and JSON Schemas. CLI inspection and invocation passed.
- Desktop and 390-pixel mobile browser checks passed, including refresh and no horizontal overflow. The fresh dev store has no pooled accounts; live host usage and authentication-error states were exercised.
- The prototype trusts the Standard JSON Schema exporter for semantic fidelity; exhaustive refinement/transform fidelity auditing remains a stabilization task. The existing Provider Usage sidebar plugin and `bb settings usage` remain on their previous collection paths.
- The repository verification inventory reports an existing unmapped `browser` CLI family; this prototype does not rewrite that unrelated baseline.


## Outcome

Plugins can opt into publishing their RPC methods for discovery and inspection. Developers and agents can inspect a plugin repository or use the BB CLI to obtain its published contract, then copy the relevant schemas into their own source.

Provider Usage establishes a usage method convention. Account Pooler and individual provider plugins implement it. Provider Usage and an alternative display such as Provider Usage Plus Plush discover and consume the same implementations. Disabling either display does not affect the sources.

The first implementation covers usage information. Thread routing attribution, availability decisions, and Provider Retry integration remain separate follow-up work.

## API

Keep the existing `defineRpcContract` shape, method addressing, and calls. Add optional descriptions to method definitions and an optional registration argument:

```ts
const usageContract = defineRpcContract({
  "provider-usage.v1.get": {
    experimental_description:
      "Returns a complete usage snapshot. refresh=true requests fresh collection and waits for the attempt; individual resource failures are included in the result.",
    input: usageInputSchema,
    output: usageSnapshotSchema,
  },
});

bb.rpc.register(usageContract, {
  "provider-usage.v1.get": getUsage,
}, {
  experimental_discoverable: true,
  experimental_description:
    "Usage windows for accounts managed by Account Pooler.",
});
```

The option publishes all methods in that registration. Plugins register internal methods separately. Omitting the option preserves current behavior: methods are callable by name but are not advertised. Discovery is not an authorization boundary.

Registration-level `experimental_description` explains the purpose and scope of that implementation. Method-level `experimental_description` explains how to call an individual method and interpret its result. Both are optional; descriptions alone never make a registration discoverable. Existing definitions without descriptions continue to work.

Add a proposed SDK query:

```ts
const sources = await bb.sdk.plugins.experimental_discoverRpc({
  method: "provider-usage.v1.get",
});
```

Support optional `pluginId` and exact `method` filters; omitting both lists published methods. Return one serializable descriptor per matching method:

```ts
{
  pluginId: "account-pool",
  displayName: "Account Pooler",
  method: "provider-usage.v1.get",
  registrationDescription: "Usage windows for accounts managed by Account Pooler.",
  methodDescription:
    "Returns a complete usage snapshot. refresh=true requests fresh collection and waits for the attempt; individual resource failures are included in the result.",
  inputSchema: publishedInputJsonSchema,
  outputSchema: publishedOutputJsonSchema,
}
```

Publish both descriptions separately, without merging them or using one as a fallback for the other. Normalize omitted descriptions to `null` at the server boundary. Validate supplied descriptions as nonempty, bounded strings and include them in descriptor size limits.

Field descriptions embedded in schemas must survive JSON Schema export. For example, `usedPercent` can explain its units and range. Method descriptions must explain behavior that field types cannot express, such as refresh and caching semantics, side effects, and partial failures. Registration descriptions explain implementation-specific scope. The published descriptions and schemas should provide enough information to call the method using CLI inspection alone. Source and Plugin Guide examples can add detail, but must not be the only place essential calling semantics are documented. Descriptions document behavior; they do not replace schema validation or make an otherwise unsupported schema export valid.

Consumers retain their own expected schemas and use the existing call API:

```ts
const results = await Promise.allSettled(
  sources.map((source) => bb.sdk.plugins.callRpc({
    pluginId: source.pluginId,
    method: "provider-usage.v1.get",
    input: { refresh: false },
    outputSchema: usageSnapshotSchema,
  })),
);
```

Discovery does not replace the consumer's expected schema with the producer's schema. It advertises implementations; normal server and caller validation still applies.

## Publishing schemas

Current RPC contracts accept Standard Schema validators. Validation support alone does not guarantee JSON Schema export. Resolve this before exposing the discovery flag:

1. Add a publication adapter for the installed Zod version and support a validator-neutral JSON Schema export capability where available.
2. Publish portable input and output JSON Schemas with a declared dialect and locally resolvable references. Do not publish executable validators or fetch remote references during inspection.
3. Describe wire values: request JSON before handler-side parsing and response JSON after server-side output parsing. Do not silently treat transformed handler types as wire schemas.
4. Fail discoverable registration with a method-specific error when export is unsupported or lossy. Preserve anonymous registration for all currently supported validators.
5. If supporting another validator requires explicit publication schemas, design that escape hatch separately rather than guessing schemas or advertising an unrestricted object.

JSON Schema does not encode every semantic restriction. Custom refinements and transformations need deliberate handling; unsupported cases must not silently disappear from the published contract. The initial usage contract should use schemas that can be exported faithfully.

Runtime descriptors have size limits and are generated at registration, not on every discovery request. Schema inspection never invokes plugin handlers. No schema hashes, shared schema packages, dynamic schema imports, or version negotiation are required.

## Lifecycle and compatibility

- Publish methods only after successful plugin load. A failed registration or failed load publishes nothing from that candidate load.
- Remove descriptors on unload and replace them consistently with handlers on reload. Avoid mixing descriptors and handlers from different generations.
- Discover only currently callable implementations. Return deterministic ordering by plugin ID and method. No matches returns an empty list.
- Keep duplicate method rejection within a plugin. Different plugins may publish the same method name.
- Preserve existing authentication for inspection and calls. Never include credentials, settings values, or handler results in descriptors.
- Discovery is a snapshot. A source may unload before invocation; callers handle individual failures. Do not retry arbitrary RPC calls automatically.
- Preserve plugin-and-method addressing. Optional versioning uses names such as `provider-usage.v1.get` and `provider-usage.v2.get`. Both can coexist.
- A method-name match does not prove compatibility. Breaking schema or behavioral changes require a new method name by convention; compatible changes retain the name.
- No runtime dependency on the plugin that originally authored the convention is introduced.

## CLI and sharing workflow

Add discoverable CLI surfaces backed by the same SDK query:

```sh
bb plugin rpc list --json
bb plugin rpc list --method provider-usage.v1.get --json
bb plugin rpc inspect account-pool --json
bb plugin rpc inspect account-pool --method provider-usage.v1.get --json
```

Listing presents identities and method names; inspection includes registration descriptions, method descriptions, and published schemas with field descriptions preserved. JSON output is sufficient for copying or generating local schema definitions. TypeScript generation is outside the initial scope because JSON Schema cannot reconstruct arbitrary validator source.

A consumer author inspects a producer's source or CLI output, copies the relevant contract into their plugin, and calls the known method. Updates remain explicit source changes reviewed and tested by that consumer. The contract author's plugin package does not become a dependency.

## Usage pilot

Use `provider-usage.v1.get` as the shared method. Provider Usage documents the canonical convention in its source; each producer and alternative consumer owns a local definition. Producers publish its calling semantics in the method description and describe their own resource scope in the registration description.

Request: `{ refresh: boolean }`.

Response: a complete snapshot of the resources owned by that implementation. Each resource includes a stable source-local ID, provider ID, display label, host or shared scope, observation timestamp, and a discriminated collection result. Successful results contain individually identified windows with utilization, reset time, optional cost information, and model applicability. Authentication failures, collection failures, and unobserved data must be explicit states rather than zero usage. Finalize and copy one concrete schema before implementing adapters.

Use the same milliseconds-based timestamp convention throughout. An observation timestamp describes the underlying measurement, not the time the RPC was called. If stale values are retained after a collection failure, preserve their original timestamp and expose the failed refresh separately.

`refresh: false` permits the source's cached measurements. `refresh: true` requests fresh collection and waits for the attempt; collection failures must remain visible. Coalesce overlapping refreshes in sources. The display owns its own fetch cache, but does not relabel cached measurements as freshly observed.

### Source implementations

- Account Pooler exposes its accounts and existing quota state with shared scope. Refresh delegates to its existing collection logic; it does not alter routing.
- Provider plugins expose host-local resources by calling their existing host usage maintenance capability. A disconnected host or failed account collection becomes an individual resource outcome and does not discard other results.
- Both register the discoverable method regardless of whether Provider Usage is installed or enabled.

### Display implementation

Provider Usage discovers sources whenever it loads or refreshes data, invokes them with bounded concurrency and bounded wait, and renders successful results even if another source fails. The core settings prototype preserves the existing provider-card presentation, refresh control, and machine picker. Host-local observations follow the selected machine; shared accounts use the same cards. Source-group headings and observation timestamps are not added to this page. Other display plugins can choose their own presentation using the same metadata.

Namespace resource keys by reporting plugin ID. Do not deduplicate by email or sum unrelated quota percentages. A shared pool appears once; a local account and a pool account may both appear even when their labels match. Source removal evicts its current display entries on the next reconciliation.

An alternative display uses the same discovery query and its own copied response schema. It may render richer UI without changing any producer. Both displays can run at once; producer refresh coalescing limits duplicate work.

### Existing SDK and CLI usage surfaces

Preserve `bb.sdk.system.usageLimits()` and `bb settings usage --json` as existing host-provider maintenance views during the first rollout. Do not silently change their response shape or use them as the unified view.

Expose Provider Usage's unified display snapshot through its RPC and a plugin-owned CLI command, proposed as `bb provider-usage status [--refresh] [--json]`. Document the distinction. Consumers needing replacement-independent data can discover and call the source methods directly. Provider Usage must stop collecting the same host usage independently once provider plugins supply it through discovery.

## Delivery sequence

1. **Schema publication:** implement export support and registration validation. Verify portable wire schemas for real usage types and unchanged anonymous RPC behavior.
2. **Registry and inspection:** add opt-in publication, lifecycle-safe descriptors, targeted discovery route, SDK query, and CLI listing/inspection.
3. **Contracts and documentation:** publish copyable examples, method naming guidance, schema limitations, and lifecycle semantics in Plugin Guide. Add SDK surfaces to `packages/plugin-api-map/src/surfaces.ts` and audit entries to `docs/api_to_audit.md`; update CLI guide templates and skills.
4. **Usage sources:** implement the convention in Account Pooler and provider plugins using existing collection primitives.
5. **Usage display:** migrate Provider Usage to discovery, expose the unified snapshot through its RPC/CLI, and verify a second display consumer against the same sources.

Keep the work server-side unless inspection proves host wire changes are necessary. Existing host usage maintenance remains a primitive. If any server/daemon wire fields change, increment `HOST_DAEMON_PROTOCOL_VERSION` unless previous-daemon compatibility is deliberately preserved and tested.

## Verification and completion criteria

Use Turbo for relevant package typechecks and tests. Extend the plugin test harness to inspect published descriptors and exercise discovery across plugins.

- Existing unnamed registrations and calls behave unchanged.
- Unadvertised methods remain callable but absent from discovery and inspection.
- Unsupported schema export fails clearly and publishes no partial registration.
- Exported schemas accurately describe representative input/output wire values.
- Registration, method, and field descriptions survive publication and CLI inspection independently; omitted descriptions are explicit `null` values in descriptors.
- Descriptions alone do not advertise methods. Existing contracts without descriptions remain valid, and invalid or oversized descriptions fail clearly.
- Usage inspection explains refresh behavior, resource scope, and partial failures without requiring repository access.
- Duplicate methods, failed load, unload, and reload preserve registry consistency.
- Two implementations of one method and v1/v2 methods coexist without new routing rules.
- A consumer with a copied incompatible schema gets a validation failure rather than trusted data.
- CLI and SDK inspection agree and do not execute handlers.
- An externally built fixture with copied schemas works without a shared contract package or a display plugin dependency.
- Account Pooler and local providers appear together with correct scope, errors, and observation times.
- One source failing, disconnecting, or unloading does not hide successful sources.
- Refresh reaches sources and overlapping refreshes coalesce.
- Disabling Provider Usage leaves source discovery and calls functional. A replacement display produces the same underlying observations.
- Relevant Provider Usage UI journeys and plugin CLI flows pass the repository's verification workflow.

The result is complete when discovery and inspection are generally usable, usage producers implement the public convention, and either display can consume them independently. Provider Retry and thread-specific quota attribution are not prerequisites.
