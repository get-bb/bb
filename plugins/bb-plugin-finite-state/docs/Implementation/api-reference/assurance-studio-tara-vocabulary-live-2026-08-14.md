# Assurance Studio TARA vocabulary — connected capture 2026-08-14

Primary source: the supervisor's read-only production capture at
`~/bb-demo/captures/fs207/`, approximately 20:30Z on 2026-08-14. It contains
184 raw files for all nine entity kinds across 20 projects plus
`VOCABULARY-SUMMARY.json` (SHA-256
`f7481aa60604550fa881c1c8d265a309e4b1984305095c224c01ee73f9c11cc5`).
Raw tenant identifiers are intentionally not vendored.

The captured TARA values relevant to remote projection are:

- `asset_type`: `integrity`, `data`, `identity`, `function`, `availability`,
  `communication`, `hardware`, `software`, `service`
- Asset `criticality`: `critical`, `high`, `medium`
- `data_classification`: `restricted`, `internal`, `confidential`, `phi`,
  `pii`, plus null in 244/325 rows
- `component_type`: the 13 vendored `ComponentType` values plus
  `external_service` and `medical_device`
- Component `criticality`: `low`, `medium`, `high`, `critical`
- Zone `trust_level`: integer scores 1–10 in 102/102 rows
- Threat `stride_categories`: all six documented STRIDE values, represented
  as arrays; 356/659 rows contain multiple categories
- Threat `threat_source`: `manual`, `stride_analysis`
- Threat `severity`: absent; the distinct `risk_level` field is not
  substituted

Each observed set is a compatibility floor, not a closed tenant-wide ceiling.
Page 1 was captured at 50 rows per page where paginated; bounded-open
projection makes additional pages or tenants additive rather than breaking.

The May 2026 vendored OpenAPI still describes Zone `trust_level` as a string
enum and omits `external_service` and `medical_device` from `ComponentType`.
The live wire therefore supersedes those two closed dispositions at the remote
boundary. `medical_device` is now a current authoring choice; only legacy
`ecu`, `hsm`, and `tee` remain retired.

The snapshot describes `LinkedAsset.asset_type` as an open string and does not
document Asset `criticality`, Asset `data_classification`, or Threat
`severity`. Those fields stay bounded-open. The documented Component
`Criticality`, STRIDE category, and Threat `threat_source` enums agree with the
capture and remain genuinely closed.

None of these vocabulary fields participates in the lane's stable identity.
Components, zones, assets, and threats continue to key by their resolved
stable slug, so retaining a new wire vocabulary value or integer trust score
does not change `id_map` bindings or accepted entity keys.
