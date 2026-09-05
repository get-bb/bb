# Developer tools, fixtures, and scope boundaries

Status: **source-documented; platform execution pending**.

## Setup and entry points

These are repository development/support surfaces, not extra end-user apps.
Use disposable stores and inspect the owning script before running it. Builds,
typechecks and package tests use Turbo with the applicable package filter.

## Source

- `apps/demo-server/package.json`
- `scripts/bb-dev-app`
- `scripts/bb-cloud-dev.mjs`
- `packages/plugin-api-map/src/surfaces.ts`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Dev launcher and status | Run the main skill’s preflight, launch, doctor and cleanup; inspect failure logs. | Checkout-derived ports/store and owned processes agree; failed attempts clean up only their own resources. |
| Demo and performance fixtures | Inspect apps/demo-server and performance seed inputs, start only an isolated fixture and open its intended view. | Fixture content is recognizable and reproducible; mocked/seeded data is labeled and never counted as actual provider execution. |
| Plugin development tools | Run extensions.md scaffold/build/types/dev checks and open the Guide/tester/theme-preview surfaces. | Developer output is usable in the actual test app and public symbol links match source. |
| CLI help and guides | Reconcile new commands/config with their guide/skill documentation and run the discoverability recipe. | Agent/user instructions expose the current contract with correct flags and target selection. |
| External extensions | List non-repository plugins installed in the test instance and compare their manifests with this map. | Each untracked extension is explicitly listed for a separate map; no claim is made to enumerate third-party code absent from this checkout. |

## Evidence and cleanup

Record each row and platform separately with the actual entry point, observed
state, persisted side effect, and evidence. Missing hardware/service access is
a prerequisite gap, not a pass. Stop only owned sessions/processes, restore
preferences, and remove only synthetic resources after evidence is preserved.
