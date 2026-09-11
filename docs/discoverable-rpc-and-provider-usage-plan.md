# Discoverable RPC and replaceable provider usage displays

The former core usage page is removed; `/settings/usage` remains a temporary redirect to `/settings/plugins/provider-usage`. Provider Usage is enabled by default and owns the usage settings page, plus a `showFooterCard` setting (default true). Both surfaces reuse its private aggregation RPC and measurement cache.

Status: prototype implemented for discoverable RPC, Account Pooler, the Codex, Claude Code, and ACP provider plugins, and Provider Usage’s settings page and footer card. Provider Usage defines the canonical contract in `plugins/provider-usage/usage-source-contract.ts` and consumes discovered sources through it. The plugin settings page preserves its existing provider cards and extends the machine picker to select shared sources such as Account Pooler. Shared sources are selected by default.

## Prototype verification

- Relevant app, server, SDK and plugin typechecks pass. Current migration checks pass: 21 Provider Usage tests, 8 footer-host tests, 52 SDK app-harness tests, 74 Plugin Guide tests and 31 builtin-plugin tests. Earlier source implementation checks also covered Account Pooler, Codex, Claude Code and ACP.
- Source tests prove that listing does not collect quota and fetching addresses one resource, including cached reads, forced reads, offline hosts, and removed resource IDs.
- Display tests prove inventory-only discovery, selected provider/account fetching, cached failure preservation, empty groups, resource removal, and tab/source changes. Settings waits for default shared-source discovery before fetching a fallback host.
- Live CLI discovery advertises both methods from all three sources. Browser request traces show only pool Codex on first open, Claude on tab selection, and four selected pool resources on settings. Existing configured accounts were retained.
- `pnpm start:worktree` serves the review instance. Provider Usage background reconciliation lists metadata only; its open card refreshes only the active provider’s resources.
- JSON Schema exporter fidelity remains an experimental stabilization audit. The unrelated verification inventory still reports an unmapped `browser` CLI family.

## Outcome

Plugins can opt into publishing their RPC methods for discovery and inspection. Developers and agents can inspect a plugin repository or use the BB CLI to obtain its published contract, then copy the relevant schemas into their own source.

Provider Usage establishes a usage method convention. Account Pooler and individual provider plugins implement it. Provider Usage and an alternative display such as Provider Usage Plus Plush discover and consume the same implementations. Disabling either display does not affect the sources.

The first implementation covers usage information. Thread routing attribution, availability decisions, and Provider Retry integration remain separate follow-up work.

## API

Keep the existing `defineRpcContract` shape, method addressing, and calls. Add optional descriptions to method definitions and an optional registration argument:

```ts
const usageContract = defineRpcContract({
  "provider-usage.v1.listResources": {
    experimental_description:
      "Cheap ordered resource inventory; reads local metadata only and never collects quota.",
    input: usageListInputSchema,
    output: usageResourceListSchema,
  },
  "provider-usage.v1.getResource": {
    input: usageFetchInputSchema,
    output: usageMeasurementSchema,
    experimental_description:
      "Fetch one resource’s actual usage; refresh=false permits cache, refresh=true requests a fresh attempt for this resource only.",
  },
});

bb.rpc.register(
  usageContract,
  {
    "provider-usage.v1.listResources": listResources,
    "provider-usage.v1.getResource": getResource,
  },
  {
    experimental_discoverable: true,
    experimental_description:
      "Usage windows for accounts managed by Account Pooler.",
  },
);
```

The option publishes all methods in that registration. Plugins register internal methods separately. Omitting the option preserves current behavior: methods are callable by name but are not advertised. Discovery is not an authorization boundary.

Registration-level `experimental_description` explains the purpose and scope of that implementation. Method-level `experimental_description` explains how to call an individual method and interpret its result. Both are optional; descriptions alone never make a registration discoverable. Existing definitions without descriptions continue to work.

Add a proposed SDK query:

```ts
const sources = await bb.sdk.plugins.experimental_discoverRpc({
  method: "provider-usage.v1.listResources",
});
```

Support optional `pluginId` and exact `method` filters; omitting both lists published methods. Return one serializable descriptor per matching method:

```ts
{
  pluginId: "account-pool",
  displayName: "Account Pooler",
  method: "provider-usage.v1.listResources",
  registrationDescription: "Usage windows for accounts managed by Account Pooler.",
  methodDescription:
    "Cheap ordered resource inventory; reads local metadata only and never collects quota.",
  inputSchema: publishedInputJsonSchema,
  outputSchema: publishedOutputJsonSchema,
}
```

Publish both descriptions separately, without merging them or using one as a fallback for the other. Normalize omitted descriptions to `null` at the server boundary. Validate supplied descriptions as nonempty, bounded strings and include them in descriptor size limits.

Field descriptions embedded in schemas must survive JSON Schema export. For example, `usedPercent` can explain its units and range. Method descriptions must explain behavior that field types cannot express, such as refresh and caching semantics, side effects, and partial failures. Registration descriptions explain implementation-specific scope. The published descriptions and schemas should provide enough information to call the method using CLI inspection alone. Source and Plugin Guide examples can add detail, but must not be the only place essential calling semantics are documented. Descriptions document behavior; they do not replace schema validation or make an otherwise unsupported schema export valid.

Consumers retain their own expected schemas and use the existing call API:

```ts
const results = await Promise.allSettled(
  sources.map((source) =>
    bb.sdk.plugins.callRpc({
      pluginId: source.pluginId,
      method: "provider-usage.v1.listResources",
      input: {},
      outputSchema: usageResourceListSchema,
    }),
  ),
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
- Preserve plugin-and-method addressing. Optional versioning uses names such as `provider-usage.v1.listResources` and `provider-usage.v2.listResources`. Both can coexist.
- A method-name match does not prove compatibility. Breaking schema or behavioral changes require a new method name by convention; compatible changes retain the name.
- No runtime dependency on the plugin that originally authored the convention is introduced.

## CLI and sharing workflow

Add discoverable CLI surfaces backed by the same SDK query:

```sh
bb plugin rpc list --json
bb plugin rpc list --method provider-usage.v1.listResources --json
bb plugin rpc inspect account-pool --json
bb plugin rpc inspect account-pool --method provider-usage.v1.listResources --json
```

Listing presents identities and method names; inspection includes registration descriptions, method descriptions, and published schemas with field descriptions preserved. JSON output is sufficient for copying or generating local schema definitions. TypeScript generation is outside the initial scope because JSON Schema cannot reconstruct arbitrary validator source.

A consumer author inspects a producer's source or CLI output, copies the relevant contract into their plugin, and calls the known method. Updates remain explicit source changes reviewed and tested by that consumer. The contract author's plugin package does not become a dependency.

## Usage pilot

Use two methods defined canonically by Provider Usage and copied locally by each producer and independent consumer:

- `provider-usage.v1.listResources({})` returns `{ label?, resources: [{ id, providerId, accountKey, label, scope }] }`. This is cheap local inventory; it never refreshes usage or contacts providers. The optional label declares an empty shared group. Host-only sources omit it. List order is display order.
- `provider-usage.v1.getResource({ resourceId, refresh })` returns `{ accountKey, observedAt, usage }` for exactly one listed resource. False permits cached measurements but still returns actual usage. True requests a fresh collection attempt for that resource only. A removed resource fails explicitly, and consumers relist.

The sidebar lists all sources to construct its source picker and provider tabs, then fetches only accounts belonging to the selected provider and source/machine. Background reconciliation lists metadata only. Unopened tabs have unknown usage rather than a fabricated healthy badge; retained measurements may still supply badges. Settings fetches the resources in its selected pool or machine. Both reuse Provider Usage’s per-resource cache, bounded collection concurrency, stale-data notices, and graceful failures.

Account Pooler lists account metadata without refreshing, then calls its existing account-specific collection for fetch. Local provider sources list hosts without collecting quota and fetch only the requested host/provider pair. No display plugin is required for source registration or collection.

### Source implementations

- Account Pooler exposes its accounts and existing quota state with shared scope. Refresh delegates to its existing collection logic; it does not alter routing.
- Codex, Claude Code, and ACP explicitly implement the contract for their own usage-capable providers, using the existing SDK maintenance API. A disconnected host or failed account collection becomes an individual resource outcome and does not discard other results.
- All source plugins register the discoverable methods regardless of whether Provider Usage is installed or enabled.

### Display implementation

Provider Usage discovers sources whenever it loads or refreshes data, invokes them with bounded concurrency and bounded wait, and renders successful results even if another source fails. The plugin settings page groups accounts beneath one provider heading and icon, using the same email/plan/usage layout for shared pools and machines. It preserves the refresh control. Its source picker defaults to a shared source when available, or the primary machine otherwise; explicit selections win. Shared-source selections show only that source’s shared accounts, and machine selections show only that machine’s host-local observations. Account headings use email without repeating it as a subtitle. Source-group headings and observation timestamps are not added to this page. Other display plugins can choose their own presentation using the same metadata.

Namespace resource keys by reporting plugin ID. Do not deduplicate by email or sum unrelated quota percentages. A shared pool appears once in the source picker; local and pooled observations remain separate choices even when their account emails match. Source removal evicts its current display entries on the next reconciliation.

An alternative display uses the same discovery query and its own copied response schema. It may render richer UI without changing any producer. Both displays can run at once; producer refresh coalescing limits duplicate work.

### Existing SDK and CLI usage surfaces

Preserve `bb.sdk.system.usageLimits()` and `bb settings usage --json` as existing host-provider maintenance views during the first rollout. Do not silently change their response shape or use them as the unified view.

Provider Usage exposes its display snapshot through `bb plugin rpc call provider-usage getUsage --input-file <request.json> --json`. The private display request includes `force`, nullable `machineIds`, nullable `providerId`, and `maxAgeMs`; null providerId lists metadata without collecting usage. Source fetch requests use a JSON file containing `resourceId` and `refresh`. Consumers needing replacement-independent data can discover and call the source methods directly. Provider Usage must stop collecting the same host usage independently once its provider plugin supplies it through discovery.

## Delivery sequence

1. **Schema publication:** implement export support and registration validation. Verify portable wire schemas for real usage types and unchanged anonymous RPC behavior.
2. **Registry and inspection:** add opt-in publication, lifecycle-safe descriptors, targeted discovery route, SDK query, and CLI listing/inspection.
3. **Contracts and documentation:** publish copyable examples, method naming guidance, schema limitations, and lifecycle semantics in Plugin Guide. Add SDK surfaces to `packages/plugin-api-map/src/surfaces.ts` and audit entries to `docs/api_to_audit.md`; update CLI guide templates and skills.
4. **Usage sources:** implement the convention in Account Pooler and the provider plugins using existing collection primitives.
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

Usage-state review: both consumers distinguish loading, empty shared groups, unavailable sources, uninstalled providers, per-account authentication/collection failures, plans without reported limits, and offline machines. Shared-account sign-in guidance refers to the source plugin’s settings. Failed source refreshes preserve successful cached observations with a visible notice; disabled sources disappear on discovery reconciliation. Browser fixtures exercise source selection, removal, and retry recovery without changing configured accounts. Unfiltered CLI discovery omits undefined filters instead of serializing them into literal query values.

## Explicit provider implementations and normalization

Provider Usage owns the canonical contract. Codex, Claude Code, and ACP copy it
into their own source and explicitly register the two methods. Each implementation
filters inventory and fetches by its own plugin ownership; ACP includes its dynamically
configured usage-capable agents. Collection uses the existing targeted maintenance
SDK API. Account Pooler implements the same contract for its shared accounts.

There is no extra adapter plugin. Declaring `maintenance.usage` alone does not
publish this contract; other provider authors must implement it explicitly. The
small amount of source duplication is intentional while the broader provider-contract
design develops. The provider kit and core runtime do not import this contract.
A replacement display can consume these sources without enabling Provider Usage.

Resource IDs are opaque source-local addresses. `accountKey` is a nullable,
provider-issued quota identity, namespaced by issuer and account/organization
scope. Labels and email are presentation only. Known matching identities within a
selected location collapse to one observation in stable source order; quota
percentages are never summed. Unknown identities remain distinct. Location
selection happens first: shared sources are the default, and an explicit machine
selection shows that machine, even when it observes the same account as a pool.

Inventory may return an unknown key until the first measurement. The measurement's
identity is authoritative. Each source remembers it for later cheap inventory;
it never reads credentials merely to list resources. Codex and Claude Code add
provider-owned identity and normalization metadata to their existing passthrough
maintenance responses. Core transports those extensions without interpreting them.
Implementations without optional normalization metadata remain compatible and report unknown identity/custom labels.

Known windows carry `kind` (`five-hour`, `daily`, `weekly`, or `custom`) alongside
an optional model family. Known plans carry `{id, multiplier}` alongside their
fallback label. Consumers consistently render Weekly limit and Max (20x), while
retaining unfamiliar provider labels. These additions default to unknown/custom
when consuming older source contracts. Breaking semantics still require a new
method namespace; discovery introduces no independent version negotiation.
