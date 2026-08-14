# Assurance Studio TARA vocabulary — connected capture 2026-08-14

Source: FS-206 UX sweep #9 against the production `fs-alpha` Assurance
Studio tenant. The connected I4700A corpus returned these wire values:

- `asset_type`: `function`, `integrity`, `identity`, `software`, `data`,
  `availability`, `hardware`, `communication`
- `component_type`: the vendored OpenAPI `ComponentType` values plus
  `external_service`

The observed eight-value `asset_type` set is a compatibility floor, not a
closed tenant-wide ceiling. Other projects or tenants may return additional
non-empty values.

The May 2026 vendored OpenAPI describes `LinkedAsset.asset_type` as an open
string and does not include `external_service` in `ComponentType`. Remote
projection therefore accepts any non-empty bounded string for these two
fields while authored UI choices present the captured known set.

Neither field participates in the lane's stable identity. Components and
assets continue to key by their resolved stable slug, so retaining a new wire
vocabulary value does not change `id_map` bindings or accepted entity keys.
