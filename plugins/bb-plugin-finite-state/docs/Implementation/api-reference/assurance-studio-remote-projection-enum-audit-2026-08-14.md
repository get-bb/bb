# Assurance Studio remote-projection enum audit — 2026-08-14

FS-207 audited every closed enum reached by the registered Assurance Studio
remote projection and by its canvas authoring/materialization consumers. This
is the grep-level inventory: a new remote vocabulary read or downstream enum
must add a row here before review.

## Authorities and capture citations

Live wire evidence is primary. The supervisor's read-only capture at
`~/bb-demo/captures/fs207/` contains 184 responses covering all nine entity
kinds across 20 tenant projects, captured 2026-08-14 at approximately 20:30Z.
Each raw citation below refers to the corresponding
`<projectId>--<segment>.json` files in that directory. Page 1 was captured at
50 rows per page where the route paginates.

The aggregate authority is
`~/bb-demo/captures/fs207/VOCABULARY-SUMMARY.json` (SHA-256
`f7481aa60604550fa881c1c8d265a309e4b1984305095c224c01ee73f9c11cc5`).
Raw citations used for envelope and scalar-shape checks are
`*--assets.json`, `*--components.json`, `*--zones.json`,
`*--data-flows.json`, `*--threats.json`, `*--risks.json`,
`*--mitigations.json`, `*--requirements.json`, and `*--attack-paths.json`.
Tenant identifiers and unrelated payload fields are not vendored. The
sanitized aggregate values and envelope shapes are represented by the
deterministic mock fixture instead.

The secondary authority is the vendored API snapshot
`assurance-studio-openapi-2026-05-12.json`. A live contradiction opens the
remote projection even when this older snapshot declares an enum. Observed
sets are compatibility floors, never tenant-wide ceilings.

## Reproduce the inventory

From `plugins/bb-plugin-finite-state`:

```sh
rg -n 'z\.enum|\.options|component_type|criticality|trust_level|asset_type|data_classification|category|threat_source|severity' \
  lanes/product-security/canvas/editing \
  lib/remote/assurance-studio lib/remote/types.ts

jq -r 'paths as $p | (getpath($p)) as $v |
  select(($v|type) == "object" and ($v|has("enum"))) |
  [($p | map(tostring) | join(".")), ($v.enum | tojson)] | @tsv' \
  docs/Implementation/api-reference/assurance-studio-openapi-2026-05-12.json
```

The executable field-read trace is pinned in
`lanes/product-security/canvas/editing/adapters.test.ts` under “pins and
adversarially exercises the field reads emitted by production projection.”

## Vocabulary dispositions and live reconciliation

| Remote projection field     | Vendored authority                                                                                                                                    | Live capture reconciliation                                                                                                                                                                                                                                                                               | Disposition and downstream handling                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component.component_type`  | `#/components/schemas/Component/properties/component_type` references the 13-value `ComponentType` enum.                                              | `*--components.json`: 519 rows, no nulls, 15 values: `firmware`, `software`, `hardware`, `network`, `cloud_service`, `external_service`, `sensor`, `database`, `communication`, `actuator`, `other`, `api`, `mobile_app`, `medical_device`, `web_app`. Live adds `external_service` and `medical_device`. | **Bounded-open string.** The live wire contradicts the older enum. The form offers all 15 live values; future strings remain readable and receive a typed, row-isolated advisory at strict authoring/materialization. `medical_device` is therefore current, not retired. Only unobserved legacy `ecu`, `hsm`, and `tee` retain the retired typed-isolation path. |
| `component.criticality`     | `#/components/schemas/Component/properties/criticality` references `#/components/schemas/Criticality`: `low`, `medium`, `high`, `critical`.           | `*--components.json`: 519 rows, no nulls, all four documented values and no delta.                                                                                                                                                                                                                        | **Genuinely closed.** Remote projection enforces the documented enum. The same four-value authoring pick-list and typed validator remain authoritative.                                                                                                                                                                                                           |
| `zone.trust_level`          | `#/components/schemas/Zone/properties/trust_level` references the string `TrustLevel` enum: `untrusted`, `semi_trusted`, `trusted`, `highly_trusted`. | `*--zones.json`: 102/102 rows are integers, covering every score 1–10; no row uses the documented strings. This is a direct live contradiction, not absence.                                                                                                                                              | **Bounded-open scalar.** Remote projection preserves a non-empty 1–200 character string or safe integer. The form offers the four documented legacy names plus observed integer scores 1–10. Known integers author as integers; future strings or safe integers stay readable and are typed/row-isolated at the strict authored parse.                            |
| `asset.asset_type`          | `#/components/schemas/LinkedAsset/properties/asset_type` is an open string; a full Asset response schema is absent.                                   | `*--assets.json`: 325 rows, no nulls, nine values: `integrity`, `data`, `identity`, `function`, `availability`, `communication`, `hardware`, `software`, `service`.                                                                                                                                       | **Bounded-open string.** All nine live values are the UI floor. Future values render read-only and are isolated from strict YAML materialization with a typed advisory.                                                                                                                                                                                           |
| `asset.criticality`         | No Asset response enum is documented. The generic `Criticality` enum is referenced by Component, not Asset.                                           | `*--assets.json`: 325 rows, no nulls, `critical`, `high`, `medium`; `low` was not present on these first pages.                                                                                                                                                                                           | **Bounded-open string.** The four generic criticality choices remain an authoring floor, not a claimed Asset wire ceiling. Future values are typed/row-isolated downstream.                                                                                                                                                                                       |
| `asset.data_classification` | No Asset response field or enumeration appears in the vendored snapshot.                                                                              | `*--assets.json`: 325 rows; null in 244. Non-null values are `restricted` (33), `internal` (21), `confidential` (17), `phi` (5), and `pii` (5). `public` is a prior authored choice but was not observed in this capture.                                                                                 | **Nullable, bounded-open string.** A wire null is explicitly accepted as semantic absence; a non-null value is a trimmed 1–200 character string. The UI floor is `public`, `internal`, `confidential`, `restricted`, `phi`, `pii`. Future strings remain readable and are typed/row-isolated at strict authoring/materialization.                                 |
| `threat.category`           | `#/components/schemas/Threat/properties/stride_categories/items` references the six-value `StrideCategory` enum.                                      | `*--threats.json`: 659 rows; arrays contain only the six documented values. Counts across array members are spoofing 176, tampering 293, repudiation 92, information disclosure 189, denial of service 145, elevation of privilege 215.                                                                   | **Genuinely closed values.** Remote projection enforces the six documented members and the UI presents all six. Cardinality is a separate structural residual: 303 rows have one category and 356 have 2–4; the authored model is singular and currently rejects multi-value rows. FS-207 does not claim that non-enum residual fixed.                            |
| `threat.threat_source`      | `#/components/schemas/Threat/properties/threat_source` declares `imported`, `library`, `manual`, `stride_analysis`.                                   | `*--threats.json`: 659 rows, no nulls; `stride_analysis` 559 and `manual` 100. No live delta.                                                                                                                                                                                                             | **Genuinely closed.** Remote projection and authored pick-list enforce the documented four values. The observed two-value subset is only a floor.                                                                                                                                                                                                                 |
| `threat.severity`           | Threat has no `severity` response field. `risk_level` is documented but semantically different.                                                       | `*--threats.json`: `severity` is absent from all 659 rows. `risk_level` is null in 76 and otherwise `critical`, `high`, `medium`, or `low`; it is deliberately not substituted.                                                                                                                           | **Bounded-open string when present.** Projection does not invent severity. The four known severity choices are an authoring floor; a future wire field remains readable and is typed/row-isolated downstream.                                                                                                                                                     |

“Bounded-open string” means a non-empty trimmed string no longer than 200
characters. The zone scalar exception additionally accepts only a finite safe
integer. Neither disposition accepts arbitrary JSON, blank strings, or an
unbounded payload.

The page-1 corpus was sufficient to reproduce every reviewer delta and to set
the compatibility floors. Deeper pages were not requested because these
floors remain open by construction.

## Live page-envelope fixture disposition

The raw captures show two page-envelope families, not a uniform `data.items`
shape. `test/mock-remote/fixtures/assurance-studio/entities-page-1.json` and
the mock list handler now preserve these per-kind shapes while retaining
synthetic IDs and stable-key-compatible wire rows:

| Kind        | Raw capture citation   | Fixture envelope                                                                        |
| ----------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Asset       | `*--assets.json`       | `data.assets` plus `data.components` and `data.pagination`                              |
| Component   | `*--components.json`   | top-level `data[]` plus `pagination`                                                    |
| Zone        | `*--zones.json`        | top-level `data[]` plus `pagination`                                                    |
| Data flow   | `*--data-flows.json`   | top-level `data[]` plus `pagination`                                                    |
| Threat      | `*--threats.json`      | `data.threats` plus `data.pagination`                                                   |
| Risk        | `*--risks.json`        | `data.risks` plus `data.pagination`                                                     |
| Mitigation  | `*--mitigations.json`  | `data.mitigations` plus `data.pagination`                                               |
| Requirement | `*--requirements.json` | `data.requirements` and aggregate fields; no pagination object in the captured response |
| Attack path | `*--attack-paths.json` | `data.attack_paths`, `data.pagination`, and `data.summary`                              |

The client reads pagination metadata from either the nested or top-level
location and accepts both snake-case and the captured attack-path camel-case
totals. The captured 200-shaped error bodies on a subset of threat and
requirement routes are deliberately excluded; their mapping belongs to the
separate error-path task.

## Other AS client enums inspected

- `AsReviewStatus` is transport metadata, not an authored remote vocabulary
  projection. It matches `#/components/schemas/ReviewStatus` exactly and lives
  in frozen `lib/remote/types.ts`; FS-207 does not modify it.
- `AsEntityKind` is selected by the registered route and injected by the
  client rather than parsed from a tenant vocabulary field.
- Deletion `cascade | detach` is a handler-backed command/impact contract, not
  remote entity vocabulary.
- Requirement, verification-check, project-SBOM, and project-link adapters
  preserve remote record vocabulary as bounded strings/JSON and do not apply a
  closed enum in their remote projection. Their local workflow/evidence enums
  are not parses of a remote vocabulary field.
- Interface `direction` is authored-only; the AS Component response exposes
  interface labels, so it is not read by remote projection. Data-flow protocol
  and data types are already bounded-open strings.

No enum in `shared/contract.ts` is a remote vocabulary parse in this audit, and
FS-207 leaves every frozen artifact unchanged.

## Row isolation and identity

The remote boundary preserves every bounded-open value in the accepted row,
except nullable data classification, whose null is normalized to authored
absence. Canvas reads use permissive accepted-row schemas and can render a
future value without a closed parse. Editing and automatic YAML
materialization call `validateArchitecturePayload`; vocabulary-only failures
are typed and skip only that accepted row, while malformed structure and
stable-key mismatches still fail closed. Stable keys remain resolved slugs, so
none of the vocabulary or envelope changes alters accepted identity or
`id_map` ownership.
