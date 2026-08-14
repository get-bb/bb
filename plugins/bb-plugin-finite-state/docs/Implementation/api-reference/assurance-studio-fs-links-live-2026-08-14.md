# Assurance Studio project-link live capture

Sanitized, read-only production capture for FS-198. The tenant API key was
supplied through `X-API-Key`; its value and all tenant identifiers, names, and
timestamps were withheld. No POST, PATCH, or DELETE request was issued.

## 1. Read-only project-link routes

- `GET /api/projects` returned HTTP 200 with `{ success, data: { items, total, page, pageSize, hasMore } }`. All 20 projects were drained with `page=1&limit=200`.
- `GET /api/projects/{projectId}/fs-links` returned HTTP 200 for every enumerated project with `{ success, data }`, where `data` is the link array.

The populated link rows exposed:

```text
created_at, created_by, critical_vuln_count, fs_product_id,
fs_product_name, fs_version_id, fs_version_name, id, is_primary,
last_synced_at, organization_id, project_id, sbom_component_count,
source_type, summary, sync_error, sync_status, updated_at,
version_strategy, vulnerability_count
```

Mapping fields had these observed types:

```text
project_id: string
fs_product_id: string
fs_version_id: string
is_primary: boolean
sync_status: string
last_synced_at: string | null
version_strategy: string
```

The 15 links represented 14 AS projects and 11 Platform projects. One
Platform project/version had four distinct AS projects and another had two.
Every row in both ambiguous groups had `is_primary=true`, and each group shared
one `fs_version_id`; therefore neither field is a valid automatic tie-break.

## 2. Timestamp validator confirmation

A second sanitized read-only pass on 2026-08-14 drained the same 20 project
routes and 15 link rows solely to classify `last_synced_at` format. Fourteen
rows had a non-null timestamp; all 14 ended in `Z` or an explicit numeric UTC
offset, zero lacked an offset, and zero had a non-string value. The capture
therefore supports the boundary contract used by
`z.string().datetime({ offset: true })`. Timestamp values and project
identifiers remain withheld.
