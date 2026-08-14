# Platform components — sweep #6 read capture

## Provenance

- Source: FS-192 connected-mode UX sweep #6, thread `thr_au4euua3y2`,
  `ux-testing/UX-FINDINGS-2026-08-13-sweep6.md`, finding S6-F3.
- Environment: production Finite State customer API, read-only GET requests.
- Capture date: 2026-08-13.
- Sanitization: tenant names and complete identifiers are omitted. The shape,
  path/purl relationship, sample size, and cross-scope observation are retained.

## Observed component corpus

Eighteen of twenty sampled `ComponentV0` rows used file paths as `name`. A
representative row had the following identity shape:

```json
{
  "id": "<component-uuid>",
  "name": "/apps/M9205ACFNAAMZA1234.elf",
  "purl": "pkg:generic/%2Fapps%2FM9205ACFNAAMZA1234.elf",
  "project": { "id": "<platform-project-id>" },
  "projectVersion": { "id": "<platform-project-version-id>" }
}
```

Two pulls issued for different project/version scopes encountered the same
component UUID before failing. This demonstrated that the unfiltered
`GET /public/v0/components` response was tenant-global, not implicitly scoped
by the selected sync version.

## Contract interpretation

The vendored `finite-state-api-v0.3.0.openapi.yaml` documents `project` and
`projectVersion` as supported RSQL `filter` attributes on
`GET /public/v0/components`. It also shows the nested `project.id` and
`projectVersion.id` response fields above. SBOM pulls therefore use the server
filter `project==<id>;projectVersion==<id>` for both included and excluded
pages. File-path names are canonicalized from the wire row itself; no global
component-index lookup participates in identity.
