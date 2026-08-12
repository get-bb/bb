# Finite State REST API Reference

API version: v0.3.0 (Customer API) — updated 2026-06-17

> **Source of truth:** The full OpenAPI 3.0.3 spec for v0.3.0 (166 operations)
> is vendored alongside this doc at `openapi.yaml`. When this reference and the
> spec disagree, the spec wins — grep/read it for exact params, enums, and
> response shapes.

## Authentication

- **Base URL**: `https://{domain}/api` (e.g., `https://customer.finitestate.io/api`)
- **Auth header**: `X-Authorization: <token>` — note: NOT `Bearer`, just the raw token
- **Environment variable**: `FINITE_STATE_AUTH_TOKEN`
- **Content-Type**: `application/json`
- **Accept**: `application/json`

```bash
# Example: list projects
curl -s "https://customer.finitestate.io/api/public/v0/projects?limit=10" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" \
  -H "Content-Type: application/json"
```

> **Multi-API support:** This skill documents the legacy Finite State API, which
> is the default for all environments. A **HELIX Differences** appendix at the
> end of this document covers the next-generation API. **Only consult or apply
> the HELIX appendix when `api_version: helix` is explicitly set in the active
> environment configuration.** Never apply HELIX behaviors to legacy environments.

## Platform Hierarchy

```
Organization
 └─ Folders (organizational grouping, nestable via parentFolderId)
     └─ Projects (a firmware image, device, or product)
         └─ Versions (a specific build/upload of a project)
             ├─ Components (software packages in the SBOM)
             │   └─ Component Dependencies (dependency tree)
             └─ Findings (CVE, SAST, license, quality issues)
```

- **Folders** group projects; support nesting via `parentFolderId`; have user/group role assignments
- **Projects** represent a firmware image, device, or product; have branches and merge priorities
- **Versions** represent individual uploads/scans; can have project-level dependencies (cross-project relationships)
- **Components** are software packages found in the SBOM; have status (excluded, included) and license info
- **Findings** are vulnerabilities or issues; have VEX triage status, reachability scores, and exploit intelligence

---

## Endpoint Quick Reference

### Read Endpoints (GET)

| Resource | Path | Description |
|----------|------|-------------|
| **Projects** | `/public/v0/projects` | List projects |
| | `/public/v0/projects/{id}` | Get project by ID |
| | `/public/v0/projects/{id}/versions` | List versions for project |
| | `/public/v0/projects/{id}/branches` | List branches for project |
| | `/public/v0/projects/{id}/users` | List users with roles |
| | `/public/v0/projects/{id}/groups` | List groups with roles |
| | `/public/v0/projects/roles` | List available project roles |
| | `/public/v0/projects/priorities` | Get merge priority options |
| **Versions** | `/public/v0/versions` | List versions (cross-project) |
| | `/public/v0/versions/{pvId}` | Get version details |
| | `/public/v0/versions/{pvId}/components` | List components for version |
| | `/public/v0/versions/{pvId}/findings` | List findings for version |
| | `/public/v0/versions/{pvId}/findings/export` | Stream findings as CSV (keyset-paginated; verify footer) |
| **Findings** | `/public/v0/findings` | List findings (RSQL filtering) |
| | `/public/v0/findings/{pvId}/{fId}/exploits` | Get exploit info for finding |
| | `/public/v0/findings/{pvId}/{fId}/cves` | Get CVE metadata for finding |
| | `/public/v0/findings/{cweId}/cwes` | Get CWE metadata |
| | `/public/v0/projects/{id}/findings/activity` | Finding activity log |
| **Products** | `/public/v0/versions/{pvId}/product-findings` | Findings across transitive dependency tree |
| | `/public/v0/versions/{pvId}/product-components` | Components across dependency tree (mixed component+project rows) |
| | `/public/v0/versions/{pvId}/used-by` | Which Products depend on this version |
| **SIP Config** | `/public/v0/config/updates` | Org-level SIP updates configuration |
| | `/public/v0/projects/{id}/updates` | Project-level SIP updates configuration |
| **Scoring Config** | `/public/v0/config/scoring` | Org-level EPSS-weighted scoring toggle |
| **CVEs** | `/public/v0/cves` | Portfolio-wide CVE aggregation |
| | `/public/v0/cves/{cveId}/exploits` | Get exploit info for CVE |
| | `/public/v0/cves/{cveId}/metadata` | Get CVE metadata |
| | `/public/v0/cves/updates` | CVE changes since scan (added, retracted, severity/exploit updates) |
| **Components** | `/public/v0/components` | List components |
| | `/public/v0/components/search` | Search components by name |
| **Comp Deps** | `/public/v0/component-dependencies/{pvId}/{profCompId}` | Navigate dependency tree |
| | `/public/v0/component-dependencies/{pvId}/node-summaries` | Vuln summaries for tree nodes |
| | `/public/v0/component-dependencies/{pvId}/search` | Search dependency trees |
| | `/public/v0/component-dependencies/{pvId}/lookup` | Look up ProfileComponent ID |
| **Proj Deps** | `/public/v0/project-versions/{pvId}/dependencies` | List project dependencies |
| **Scans** | `/public/v0/scans` | List scan records |
| | `/public/v0/scans/{scanId}/files` | Download file from SCA scan (by SHA-256 hash via `filter`) |
| | `/public/v0/scans/{scanId}/unpack-evaluation` | AI-generated scan quality report |
| | `/public/v0/scans/{scanId}/multipart/{s3UploadId}/{partNumber}/url` | Presigned S3 URL for one multipart part (direct-upload flow) |
| **fsscan** | `/public/v0/fsscan/update-check` | Scanner (fs-scan/fs-cli) self-update check |
| **SBOMs** | `/public/v0/sboms/cyclonedx/{pvId}` | Download CycloneDX SBOM |
| | `/public/v0/sboms/spdx/{pvId}` | Download SPDX SBOM |
| **Filesystem** | `/public/v0/projects/versions/{pvId}/filesystem/tree` | Navigate unpacked firmware tree (findings-read) |
| | `/public/v0/projects/versions/{pvId}/filesystem/overview` | Per-file metadata by hash (findings-read) |
| | `/public/v0/projects/versions/{pvId}/filesystem/content` | Ranged read of file bytes (admin VIEW_ANY_PROJECT_FILE) |
| | `/public/v0/projects/versions/{pvId}/filesystem/file` | Full file download by hash (admin VIEW_ANY_PROJECT_FILE) |
| **Sec Assessment** | `…/security-assessment/architecture` | CPU-arch profile across binaries |
| | `…/security-assessment/architecture-breakdown` | Per-arch decoder/ISA detail |
| | `…/security-assessment/binaries/imports` | Imported symbols for binaries (by `hash`) |
| | `…/security-assessment/binaries/exports` | Exported symbols for binaries (by `hash`) |
| | `…/security-assessment/binaries/info` | Binary hardening (NX/PIE/RELRO/canary) by `hash` |
| | `…/security-assessment/binaries/file-details` | Per-binary drilldown (imports/exports/symbols/deps/SAST fns) |
| | `…/security-assessment/binaries/has-imports` | Search binaries that import symbol(s) |
| | `…/security-assessment/binaries/has-exports` | Search binaries that export symbol(s) |
| | `…/security-assessment/callgraph/callers` | Callers of function(s) (cross-binary reachability) |
| | `…/security-assessment/callgraph/callees` | Callees of function(s) |
| | `…/security-assessment/dependencies/loads` | Forward ELF load graph (libs a binary loads) |
| | `…/security-assessment/dependencies/loaded-by` | Reverse ELF load graph (who loads a lib) |
| | `…/security-assessment/kernel/config` | Kernel `CONFIG_*` map |
| | `…/security-assessment/configs/list` | List parsed config files (metadata) |
| | `…/security-assessment/configs/details` | Full parsed config trees (by `hash`) |
| | `…/security-assessment/crypto/list` | Crypto summaries (no key bytes) |
| | `…/security-assessment/crypto/details` | **ADMIN-ONLY** full crypto material (key/PEM bytes) |
| | `…/security-assessment/services/list` | Detected services (systemd/init) |
| | `…/security-assessment/services/details` | One service by `configPath` |
| | `…/security-assessment/services/systemd-units` | Systemd units + hardening scoring |
| | `…/security-assessment/boot/cmdline` | Bootloader kernel command line(s) |
| | `…/security-assessment/boot/signing-chains` | Boot signing artifacts (summary) |
| | `…/security-assessment/boot/signing-chains/details` | Full signing chains (by `hash`) |
| | `…/security-assessment/docker-image/config` | OCI/Docker config (env NAMES, no values) |
| | `…/security-assessment/docker-image/config/raw` | **ADMIN-ONLY** raw config (env values/secrets) |
| | `…/security-assessment/processing-errors` | Files that failed to unpack/analyze |
| | `…/security-assessment/users` | **ADMIN-ONLY** /etc/passwd+/etc/shadow accounts |
| **Folders** | `/public/v0/folders` | List folders |
| | `/public/v0/folders/{id}` | Get folder details |
| | `/public/v0/folders/{id}/projects` | List projects in folder |
| | `/public/v0/folders/{id}/users` | List users with folder roles |
| | `/public/v0/folders/{id}/groups` | List groups with folder roles |
| | `/public/v0/folders/roles` | List available folder roles |
| **Audit** | `/public/v0/audit` | Audit trail / activity log |
| **Users** | `/public/v0/users/` | List users |
| | `/public/v0/users/{id}` | Get user by ID |
| | `/public/v0/users/{uId}/projects/{pId}/roles` | Get user's project roles |
| **Groups** | `/public/v0/groups` | List groups |
| | `/public/v0/groups/{id}` | Get group by ID |
| | `/public/v0/groups/{id}/members` | List group members |
| | `/public/v0/groups/{gId}/projects/{pId}/roles` | Get group's project roles |
| **Auth** | `/public/v0/authUser` | Get authenticated user info |
| | `/public/v0/authUser/projects/{id}/actions` | User's allowed actions for project |
| | `/public/v0/authUser/folders/{id}/actions` | User's allowed actions for folder |
| | `/public/v0/authUser/folders/actions` | User's allowed actions across folders |
| | `/public/v0/org/roles` | Organization roles |
| **API Tokens** | `/public/v0/api-tokens` | List API tokens |
| | `/public/v0/api-tokens/{id}` | Get API token by ID |
| **Counts** | `/public/v0/project/version/{pvId}/findings/exploit/counts` | Exploit intelligence counts |
| | `/public/v0/project/version/{pvId}/findings/status/counts` | Finding status counts |
| | `/public/v0/project/version/{pvId}/findings/category/counts` | Finding category counts |
| | `/public/v0/project/version/{pvId}/findings/severities/counts` | Severity counts |
| **Product** | `/public/v0/product-activation` | List product activations (admin; `offset`/`limit`) |
| | `/public/v0/product-activation/{id}` | Get activation (admin) |
| | `/public/v0/product-activation/{id}/entitlements` | Get entitlements (any logged-in user) |
| | `/public/v0/product-activation/{id}/condition` | Get activation condition (any logged-in user) |

### Write Endpoints (POST, PUT, DELETE)

| Method | Path | Description |
|--------|------|-------------|
| **Projects** | | |
| `POST` | `/public/v0/projects` | Create project |
| `POST` | `/public/v0/projects/sample` | Create sample project with demo data |
| `PUT` | `/public/v0/projects/{id}` | Update project metadata |
| `PUT` | `/public/v0/projects/{id}/archive` | Archive project |
| `PUT` | `/public/v0/projects/{id}/restore` | Restore archived project |
| `PUT` | `/public/v0/projects/archive` | Bulk archive projects |
| `PUT` | `/public/v0/projects/restore` | Bulk restore projects |
| `POST` | `/public/v0/projects/{id}/versions` | Create new version |
| **Versions** | | |
| `PUT` | `/public/v0/versions/{pvId}` | Update version name |
| `DELETE` | `/public/v0/versions/{pvId}` | Delete version (409 if active deps) |
| **Findings** | | |
| `PUT` | `/public/v0/findings/{pvId}/{fId}/status` | Set VEX status |
| `PUT` | `/public/v0/findings/{pvId}/{fId}/status/clear` | Clear VEX status |
| `PUT` | `/public/v0/findings/{pvId}/status/set/bulk` | Bulk set VEX statuses (heterogeneous; maxItems 5000; 1 rate-limit token) |
| `PUT` | `/public/v0/findings/{pvId}/status/clear/bulk` | Bulk clear VEX statuses |
| **Components** | | |
| `PUT` | `/public/v0/components/{pvId}/{cId}/status` | Update component status |
| **Scans** | | |
| `POST` | `/public/v0/scans` | Upload and scan binary (SCA/SAST/config) — direct octet-stream |
| `POST` | `/public/v0/scans/upload` | Begin presigned-S3 direct-upload (returns scanId + uploadUrl/s3UploadId) |
| `POST` | `/public/v0/scans/{scanId}/start` | Begin processing after upload (single-part or multipart) |
| `POST` | `/public/v0/scans/{scanId}/multipart/{s3UploadId}/complete` | Complete a multipart upload (part→ETag map) |
| `POST` | `/public/v0/scans/third-party` | Upload third-party scan results |
| `POST` | `/public/v0/scans/sbom` | Upload CycloneDX/SPDX SBOM (testing only) |
| **Proj Deps** | | |
| `POST` | `/public/v0/project-versions/{pvId}/dependencies` | Create project dependency |
| `PUT` | `/public/v0/project-dependencies/{depId}` | Update project dependency (no forge tool — use raw_api) |
| `DELETE` | `/public/v0/project-dependencies/{depId}` | Delete project dependency |
| **Folders** | | |
| `POST` | `/public/v0/folders` | Create folder |
| `PUT` | `/public/v0/folders/{id}` | Update folder (name + description + re-parent) |
| `DELETE` | `/public/v0/folders/{id}` | Delete folder (projects reassigned to root — no need to empty) |
| `PUT` | `/public/v0/folders/{id}/projects` | Add projects to folder (→ BulkOperationResult) |
| `DELETE` | `/public/v0/folders/{id}/projects` | Remove projects from folder (→ BulkOperationResult) |
| `PUT` | `/public/v0/folders/{fId}/users/{uId}/roles` | Set user folder roles |
| `PUT` | `/public/v0/folders/{fId}/groups/{gId}/roles` | Set group folder roles |
| **Users** | | |
| `POST` | `/public/v0/users/` | Create user |
| `PUT` | `/public/v0/users/{id}` | Update user |
| `DELETE` | `/public/v0/users/{id}` | Delete user |
| `GET` | `/public/v0/users/{id}/password-reset` | Send password reset email |
| `POST` | `/public/v0/users/accept-eula` | Accept EULA |
| `PUT` | `/public/v0/users/{uId}/projects/{pId}/roles` | Set user project roles |
| **Groups** | | |
| `POST` | `/public/v0/groups` | Create group (returns 200 + full GroupV0; 409 on dup name) |
| `PUT` | `/public/v0/groups/{id}` | Update group |
| `DELETE` | `/public/v0/groups/{id}` | Delete group (409 if has members, use force) |
| `POST` | `/public/v0/groups/bulk` | Create multiple groups |
| `POST` | `/public/v0/groups/bulk-delete` | Delete multiple groups |
| `POST` | `/public/v0/groups/{id}/members` | Add members to group |
| `DELETE` | `/public/v0/groups/{id}/members` | Remove members from group |
| `PUT` | `/public/v0/groups/{gId}/projects/{pId}/roles` | Set group project roles |
| **API Tokens** | | |
| `POST` | `/public/v0/api-tokens` | Create API token |
| `PUT` | `/public/v0/api-tokens/{id}` | Update API token |
| `DELETE` | `/public/v0/api-tokens/{id}` | Delete API token |
| `POST` | `/public/v0/api-tokens/bulk-delete` | Bulk delete API tokens |
| **Tracker** | | |
| `POST` | `/public/v0/tracker/{pvId}/tickets/findings` | Create tickets for findings |
| `POST` | `/public/v0/tracker/{pvId}/tickets/components` | Create tickets for components |
| `POST` | `/public/v0/tracker/tickets/ping` | Test tracker connectivity |
| `POST` | `/public/v0/tracker/{pvId}/tickets/preview` | Preview ticket before creating |
| `PUT` | `/public/v0/tracker/{pvId}/tickets/delink` | Delink tracker tickets |
| **Compliance** | | |
| `POST` | `/public/v0/compliance/workflows/status` | Update compliance workflow status |
| **SIP Config** | | |
| `PUT` | `/public/v0/config/updates` | Set org-level SIP updates config |
| `PUT` | `/public/v0/projects/{id}/updates` | Set project-level SIP updates config |
| **Scoring Config** | | |
| `PUT` | `/public/v0/config/scoring` | Set org-level EPSS-weighted scoring toggle |
| **Admin** | | |
| `POST` | `/public/v0/admin/products/{projectId}/recompute-rollups` | Recompute rollups for one project (admin) |
| `POST` | `/public/v0/admin/products/recompute-all-rollups` | Recompute rollups for all projects (admin) |
| **Product** | | |
| `PUT` | `/public/v0/product-activation/{id}` | Upsert activation (admin) |
| `DELETE` | `/public/v0/product-activation/{id}` | Remove activation (admin) |

---

## Endpoint Details

### Projects

```bash
# List all non-archived projects
GET /public/v0/projects?limit=1000&archived=false

# Get a specific project
GET /public/v0/projects/12345

# List project versions
GET /public/v0/projects/12345/versions
```

> **Note:** `GET /projects` does NOT accept an `excluded` param (that param is
> valid only for components/findings). Its params are `filter`, `sort`,
> `archived`, `offset`, `limit`.

**Filter attributes**: `created`, `createdBy`, `name`, `type`, `components`, `findings`, `violations`, `warnings`, `lastScanCreated`, `lastScanCompleted`

**Sort options**: `created`, `createdBy`, `name`, `type`, `components`, `findings`, `policy`, `lastScan`, `dependencyCount` (each `:asc` or `:desc`)

**Response** (`ProjectV0`):
- `id` — numeric project ID
- `name` — project name
- `description` — project description
- `type` — project type
- `archived` — boolean
- `folder` → `{ id, name }` — folder grouping
- `version_count` — number of versions
- `created` — ISO8601 timestamp
- `createdBy` — creator username
- `softwareIdentifiers` — software identifiers (CPE, SWID)
- `priorities` — merge priority settings
- `flagConflicts` — boolean

**Create project** (`POST /public/v0/projects`):

`name`, `description`, AND `type` are all **required** in v0.3.0. `type` is
**lowercase**, one of exactly: `application`, `framework`, `library`,
`container`, `platform`, `operating-system`, `device`, `device-driver`,
`firmware`, `file`, `machine-learning-model`, `data` (per the spec's
`CreateProjectV0Request.type` description). There is **no** `software`/`SOFTWARE`
value. `priorities` is an **array of `MergePriority` enum strings** (`USER`,
`FS`, `THIRD_PARTY`, `SBOM`), NOT an object.

```json
{
  "name": "My Firmware",
  "description": "Main product firmware",
  "type": "firmware",
  "branch": "main",
  "folderId": "folder-uuid",
  "priorities": ["USER", "FS"],
  "flagConflicts": false
}
```

**Update project** (`PUT /public/v0/projects/{id}`):

`UpdateProjectV0Request` requires **`name` + `description`**. Additional
fields: `folderId` (nullable — pass `null` to remove the project from its
folder), `isProduct` (bool), `includeFilesInSbom` (bool — file components in
SBOM exports by default), `softwareIdentifiers` (CPE/SWID).

```json
{
  "name": "My Firmware",
  "description": "Main product firmware",
  "folderId": null,
  "isProduct": false,
  "includeFilesInSbom": false,
  "softwareIdentifiers": []
}
```

**Create version** (`POST /public/v0/projects/{id}/versions`):
```json
{
  "version": "v2.1.0",
  "releaseType": "RELEASE"  // valid: RELEASE, PRE-RELEASE
}
```

### Versions

The versions endpoint provides a cross-project view of all versions, plus per-version detail endpoints.

```bash
# List all versions (cross-project, filterable)
GET /public/v0/versions?limit=100&sort=created:desc

# Get specific version details
GET /public/v0/versions/67890

# List components for a version
GET /public/v0/versions/67890/components?limit=10000

# List components with search and exclusion filters
GET /public/v0/versions/67890/components?search=openssl&excluded=false&limit=10000

# List findings for a version
GET /public/v0/versions/67890/findings?type=cve&limit=10000
```

**Filter attributes** (on `/public/v0/versions`): `project`, `id`, `name`, `created`, `releaseType`, `componentCount`, `findingCount`, `violations`, `warnings`

**Sort options**: `id`, `project`, `name`, `created`, `updated`, `releaseType`, `componentCount`, `findingCount`, `violations`, `warnings`, `policy`

**Response** (`VersionListEntryV0` / `VersionDetailsV0`):
- `id` — project version ID (this is the `projectVersionId` used elsewhere)
- `name` — version name
- `project` → `{ id, name }`
- `created`, `updated`, `updatedAt` — timestamps
- `releaseType` — release type
- `componentCount`, `findingCount` — counts
- `violations`, `warnings` — policy counts
- `relativeRiskScore` — numeric double risk score
- `testStatuses` — array of test status strings
- `uniqueTestTypes` — array of `{ id, name }` test type objects
- `createdBy` → `{ id, email }` — creator info
- `riskThresholds` → `{ critical, high, medium }` — numeric doubles
- `findingsSummary` → `{ total, bySeverity{}, byCategory{}, byStatus{}, byCVE{ <CVE-ID>: { count, severity, epssScore, exploitAvailable } }, exploitIntelligence{ weaponized, exploitedInWild, proofOfConcept } }`
- `componentsSummary` → `{ total, byType{}, highRiskComponents, componentsWithLicenses, licenseCompliance{ compliant, nonCompliant, unknown, highRiskLicenses, licenseConflicts }, byLicense{} }`
- `testSummary` → `{ totalTests, completedTests, failedTests, testTypes[{ id, name, status, lastRun, duration }] }`
- `timeline` → `{ firstScan, lastScan, totalScans }`

**Update version** (`PUT /public/v0/versions/{pvId}`):
```json
{ "name": "v2.1.0-hotfix" }
```

**Delete version** (`DELETE /public/v0/versions/{pvId}`):
Returns 204. Returns 409 if the version has active project dependencies.

**Export findings as CSV** (`GET /public/v0/versions/{pvId}/findings/export`):
Streams `text/csv`, one row per CVE finding, keyset-paginated server-side
(bounded memory for huge versions). The body ends with a footer line
`# rows_written=N rows_skipped=M\r\n` — **callers MUST verify the footer is
present** before trusting the file (a truncated stream lacks it). Returns
**503** when the export queue is full (retry later).

### Findings

The primary vulnerability data endpoint.

```bash
# All CVE findings (preserves reachabilityScore)
GET /public/v0/findings?filter=category==CVE&limit=10000&archived=false&excluded=false

# Findings detected in a date range
GET /public/v0/findings?filter=detected>=2025-01-01T00:00:00;detected<=2025-01-31T23:59:59

# Open issues only (use `=out=`, not `=notin=` — the platform RSQL
# parser rejects `=notin=` with HTTP 400 UnknownOperatorException)
GET /public/v0/findings?filter=status=out=(RESOLVED,RESOLVED_WITH_PEDIGREE,NOT_AFFECTED,FALSE_POSITIVE)

# CRITICAL + exploitable
GET /public/v0/findings?filter=severity==CRITICAL;exploit==true

# Latest-occurrence only, with comments and additional details
GET /public/v0/findings?latestOnly=true&includeComments=true&includeAdditionalDetails=true
```

**Query params** (non-RSQL):
- `includeAdditionalDetails` (bool) — when `true`, populates `description` field on each finding (CVE/SAST descriptions)
- `includeComments` (bool) — when `true`, populates `comments` array `[{text, author, date}]` on each finding
- `latestOnly` (bool) — when `true`, restricts to the latest occurrence of each finding
- `archived` (bool) — formal query param (also accepted in the URL example form)
- `excluded` (bool) — formal query param (also accepted in the URL example form)

**Filter attributes**: `attackVector`, `component`, `component.name`, `cwes`, `detected`, `findingId`, `inKev`, `inVcKev`, `location`, `risk`, `score`, `severity`, `policy`, `affected`, `vulnInDataset`, `reachabilityScore`, `status`, `exploit`, `category`, `project`, `projectVersion`, `title`, `dependencyPath`, `epssWeightedRisk`, `epssWeightedSeverity`

- `component` — artifact ID only (e.g., `component==struts-core`), supports `=like=`, `=ilike=`
- `component.name` — case-insensitive full name (`groupId/artifactId`), e.g., `component.name=ilike=*spring*`
- `cwes` — exact CWE ID integer match (e.g., `cwes==79`); accepts only positive integers, no wildcards
- `location` — case-insensitive text match on component artifact ID / file path (e.g., `location=ilike=*log4j*`)
- `score` — alias for `risk`; also supports token syntax: `>>50` (greater than), `<e60` (less-equal), `ee75` (equal)
- `epssWeightedRisk` — EPSS-weighted risk on a **0–10 scale**, range comparisons (e.g. `epssWeightedRisk>=7.0`). Gated by the org's EPSS-weighted scoring config (see § Scoring Config)
- `epssWeightedSeverity` — band derived from `epssWeightedRisk`: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN` (e.g. `epssWeightedSeverity=ge=HIGH`)

**`status` values**: `EXPLOITABLE`, `IN_TRIAGE`, `NOT_AFFECTED`, `FALSE_POSITIVE`, `RESOLVED`, `RESOLVED_WITH_PEDIGREE`, `NO_STATUS` (unset/untriaged)

**`category` values**: `CVE`, `CREDENTIALS`, `CONFIG_ISSUES`, `CRYPTO_MATERIAL`, `SAST_ANALYSIS`

**Type parameter**: `cve`, `sast`, `thirdparty`, `all` (but prefer `filter=category==CVE` — see quirks)

**Sort options**: `detected`, `severity`, `cveId`, `policy`, `risk`, `componentId`, `created`, `status`, `reachabilityScore`, `epssWeightedRisk`, `epssWeightedSeverity` (each `:asc` or `:desc`)

**Response** (`FindingV0`):
- `id` — internal finding ID (used for VEX PUT — this is a numeric int64)
- `findingId` — string finding identifier (e.g., `CVE-2024-1234`)
- `severity` — `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `NONE`, `INFO`
- `risk` — **0–100 scale** (divide by 10.0 for CVSS)
- `status` — VEX status (nullable — null means untriaged)
- `justification` — VEX justification (if status set)
- `response` — VEX response (if status set)
- `reason` — free-text reason (if status set)
- `detected`, `created` — timestamps
- `description` — vulnerability description (only populated when `includeAdditionalDetails=true`; sourced from CycloneDX details or stored description)
- `title` — finding title (e.g., `CVE-2022-22950 - org.springframework/spring-expression@4.1.6.RELEASE`)
- `location` — short identifier / artifact ID for the affected component
- `type` — finding type (CVE, SAST, etc.)
- `cwes` — array of CWE ID strings (e.g., `["CWE-770"]`)
- `epssScore`, `epssPercentile` — EPSS data (nullable)
- `epssWeightedRisk`, `epssWeightedSeverity` — EPSS-weighted score/band (populated when the org's EPSS-weighted scoring config is enabled — see § Scoring Config)
- `reachabilityScore` — numeric (positive=higher priority, negative=lower priority, 0=neutral)
- `attackVector` — `NETWORK`, `ADJACENT`, `LOCAL`, `PHYSICAL`
- `factors` — reachability factors array: `[{ entity_type, entity_name, summary, details{}, score_change }]`
- `exploitMaturity` — exploit maturity level (e.g., `"poc"`, `"weaponized"`)
- `exploitInfo` — array of exploit attribute strings
- `inKev`, `inVcKev` — CISA KEV catalog membership
- `vulnInDataset` — vulnerability in threat dataset
- `component` → `{ appId, id, name, vcId, version }`
- `project` → `{ id, name }`
- `projectVersion` → `{ id, name }`
- `dataSources` — array showing finding origin path (e.g., `["BLACKDUCK_API", "PROPAGATED"]`)
- `originalDataSource` — first element of dataSources
- `propagated` — whether finding was copied from a previous version
- `cveReferences` — array of reference URIs (advisories, exploits, etc.)
- `comments` — `[{ text, author, date }]` (only populated when `includeComments=true`)
- `remediation` — remediation guidance string from BDCR (nullable)
- `mitigation` — workaround/mitigation info from BDCR (nullable)
- `advisories` — `[{ title, url }]` — BDSA and external advisory references (nullable)
- `tracker` → `TrackerInfo` `{ enabled, relative_url, all_tickets[{ key, status, name }], first_ticket{ name, type, status, assignee, priority, project_name, project_key } }` (nullable, only when tracker workspace enabled)
- `violations`, `warnings` — policy counts

**Finding activity** (`GET /public/v0/projects/{id}/findings/activity`):
- Query: `cve` (required), `eventType` (enum: `observation`, `status`, `comment`), `user`, `projectVersionId`, `offset`, `limit`
- Returns unified view of observations, status updates, and comments for a CVE across versions

### CVEs (Portfolio-Wide)

Portfolio-wide view of CVEs across all projects. Use this to find everywhere a CVE appears.

```bash
# List all CVEs, sorted by risk
GET /public/v0/cves?sort=risk:desc&limit=100

# Find a specific CVE across the portfolio
GET /public/v0/cves?filter=cveId==CVE-2024-1234

# High-risk CVEs with exploits
GET /public/v0/cves?filter=severity==CRITICAL;exploit==true&sort=risk:desc

# Include archived projects in the aggregation
GET /public/v0/cves?filter=cveId==CVE-2024-1234&archived=true

# Get exploit details for a CVE
GET /public/v0/cves/CVE-2024-1234/exploits

# Get CVE metadata
GET /public/v0/cves/CVE-2024-1234/metadata
```

**Filter attributes**: `cveId`, `component`, `project`, `severity`, `risk`, `detectionDate`, `exploit`

**Query params**: `archived` (bool) — include archived projects in the aggregation

**Sort options**: `cveId`, `severity`, `detectionDate`, `risk`

**Response headers**: `X-Total-Count`, `X-Offset`, `X-Limit`

**Response** (`AggregatedCveV0`):
- `cveId` — CVE identifier (e.g., `CVE-2024-1234`)
- `severity` — severity level
- `cvssSeverity` → `{ v2, v3, v4 }` — CVSS scores by version
- `risk` — 0–100 scale (divide by 10.0 for CVSS)
- `cwes` — associated CWE identifiers
- `exploitMaturity` — exploit maturity
- `exploitInfo` — exploit intelligence
- `epssScore`, `epssPercentile` — EPSS data
- `inKev`, `inVcKev` — CISA KEV membership
- `firstDetected`, `lastDetected` — detection timestamps
- `affectedComponents` — array of `AffectedComponentRef` (all components affected by this CVE)
- `affectedProjects` — array of `ProjectLatestVersionV0` (all projects affected)

### Components

```bash
# List all components
GET /public/v0/components?limit=10000

# Search for a component by name across all projects
GET /public/v0/components/search?name=openssl&limit=100

# Filter by project version
GET /public/v0/components?filter=projectVersion==67890
```

**Filter attributes**: `project`, `projectVersion`, `created`, `type`, `warnings`, `violations`, `name`, `version`, `status`, `severity`, `source`, `license`, `componentPolicy`, `licensePolicy`, `ntia`, `isEol`, `edited`

- `severity` — vuln severity from highest risk score: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` (e.g., `severity=in=(CRITICAL,HIGH)`)
- `source` — component origin source (e.g., `source==cyclonedx`)
- `license` — license expression or `NO_LICENSE` (e.g., `license==MIT`, `license==NO_LICENSE`)
- `componentPolicy` — component age policy: `WARNING`, `VIOLATION`
- `licensePolicy` — license policy state: `WARNING`, `VIOLATION`
- `ntia` — NTIA compliance (boolean, e.g., `ntia==true`)
- `isEol` — end-of-life status based on global component EOL date (e.g., `isEol==true`)
- `edited` — user overrides; `edited==true` returns edited, `edited==false` returns unedited

**Query params**:
- `editStatus` — filter by manual override state: `edited`, `unedited`, or omit for any
- `excluded` (bool, default `false`) — `true` returns excluded components only

**Sort options**: `name`, `version`, `date`, `releaseDate`, `created`, `type`, `warnings`, `violations`, `status`, `vulnCount`, `policy`, `supplier`, `license`, `source`

**Response** (`ComponentV0`):
- `id` — component ID
- `gcId` — global component ID
- `name`, `version`, `type`
- `purl` — Package URL (e.g., `pkg:npm/lodash@4.17.21`)
- `supplier` — component vendor
- `releaseDate` — release date
- `created` — first seen date
- `project` → `{ id, name }`
- `projectVersion` → `{ id, name }`
- `declaredLicenses`, `concludedLicenses` — license info
- `findings` — finding count
- `warnings`, `violations` — policy counts
- `severityCounts` — breakdown by severity
- `source` — detection source: `source_sca`, `binary_sca`, `sbom_import`
- `confidence` — detection confidence
- `status` — component status
- `statusComment` — status explanation
- `excluded` — boolean
- `edited` — boolean (manually modified)
- `lastModifiedAt` — timestamp of last user override (nullable)
- `lastModifiedBy` — username who last modified (nullable)
- `includeInFutureVersions` — boolean, whether component auto-carries to new versions
- `bomRef` — CycloneDX bom-ref
- `origin` — component origin
- `replaced` → `ReplacedComponent` (nullable, present when component has `replacementStatus` of REPLACING)
- `tracker` → `TrackerInfo` `{ enabled, relative_url, all_tickets[{ key, status, name }], first_ticket{ name, type, status, assignee, priority, project_name, project_key } }` (nullable, only when tracker workspace enabled)

**Update component status** (`PUT /public/v0/components/{pvId}/{cId}/status`):
```json
{
  "status": "EXCLUDED",
  "statusComment": "Test dependency only",
  "applyToAllInstances": false
}
```

**Note**: There is no GET endpoint for a single component by ID. Use filtering or search instead.

### Component Dependencies

Navigate the dependency tree for a project version.

```bash
# Get root-level dependencies (profCompId=0 for root)
GET /public/v0/component-dependencies/67890/0?limit=100

# Get children of a specific component
GET /public/v0/component-dependencies/67890/12345?limit=100

# Search the dependency tree
GET /public/v0/component-dependencies/67890/search?searchText=openssl&limit=50

# Get vulnerability summaries for nodes (max 500 IDs)
GET /public/v0/component-dependencies/67890/node-summaries?ids=1,2,3,4,5

# Look up ProfileComponent ID by vcId
GET /public/v0/component-dependencies/67890/lookup?vcId=99999
```

### Project Dependencies

Cross-project dependency relationships (e.g., firmware depends on bootloader project).

```bash
# List dependencies for a project version
GET /public/v0/project-versions/67890/dependencies

# Create a dependency
POST /public/v0/project-versions/67890/dependencies
{
  "dependencyProjectVersionId": "11111",
  "relationshipType": "depends_on",
  "carryForward": true
}
```

`relationshipType` is the **full 48-value lowercase SPDX relationship
vocabulary** — `depends_on` (the usual choice), `contains`, `dependency_of`,
`build_dependency_of`, `runtime_dependency_of`, `dynamic_link`, `static_link`,
`patch_for`, `contained_by`, etc. **See `openapi.yaml` for the complete enum.**
The upper-case form (`DEPENDS_ON`) is rejected with `HTTP 400` listing the
allowed enum. Forge wraps the create/list/delete trio as
**`create_project_dependency`** / **`list_project_dependencies`** /
**`delete_project_dependency`**.

> **Update (`PUT /public/v0/project-dependencies/{depId}`) has no forge tool.**
> The spec defines `updateProjectDependencyV0` (body
> `UpdateProjectDependencyV0Request` = `relationshipType` / `carryForward`),
> but forge wraps only create/list/delete. Use `raw_api` to update a dependency.

**Filter attributes**: `dependencyId`, `dependencyName`, `dependencyVersion`, `relationshipType`, `carryForward`, `createdAt`, `createdBy`, `components`, `findings`, `violations`, `warnings`

### Scans

```bash
# List scans, newest first
GET /public/v0/scans?sort=created:desc&limit=100

# Filter by project and status
GET /public/v0/scans?filter=project==12345;status==COMPLETED
```

**Filter attributes**: `project`, `projectVersion`, `type`, `status`

**Sort options**: `created`, `completed`

**Pagination**: default `limit=20`, max 100.

**Response** (`ScanV0`):
- `id` — scan ID
- `created`, `completed` — timestamps
- `status` — `INITIAL`, `PENDING_UPLOAD`, `UPLOAD_FAILED`, `STARTED`, `COMPLETED`, `ERROR`, `NOT_APPLICABLE`
- `type` — `SCA`, `SAST`, `CONFIG`, `SBOM_IMPORT`, `SOURCE_SCA`, `VULNERABILITY_ANALYSIS`
- `branch` → `BranchRef` `{ id, name }` — the branch this scan ran against
- `errorMessage` — failure reason
- `project` → `{ id, name, created }`
- `projectVersion` → `{ id, name }`

> **Status enum changed in v0.3.0** — `FAILED`, `RUNNING`, `PAUSED` are gone;
> `PENDING_UPLOAD` and `UPLOAD_FAILED` are new. Treat **ERROR** and
> **UPLOAD_FAILED** as terminal-failure, **COMPLETED** and **NOT_APPLICABLE**
> as terminal-success, and **INITIAL / PENDING_UPLOAD / STARTED** as
> in-progress. Any `status==FAILED` filter or comparison will silently never
> match (relevant to the Workflow-15 scan gate).

**Upload and scan** (`POST /public/v0/scans`):
- Content-Type: `application/octet-stream`
- Query params: `type` (sca, sast, config, python, vulnerability_analysis), `filename`, `projectVersionId`
- Body: binary file

**Upload third-party scan** (`POST /public/v0/scans/third-party`):
- Content-Type: `application/octet-stream`
- Query params: `type` (~150 scanner types), `filename`, `projectVersionId`
- Body: scan result file

**Upload SBOM** (`POST /public/v0/scans/sbom`):
- **Used for testing only** — production SBOM ingestion goes through `fs-cli`.
- Content-Type: `application/octet-stream`
- Query params: `type` (cdx, spdx), `filename`, `projectVersionId` (**integer** here, unlike the string `projectVersionId` on the other scan-upload endpoints), optional `scanType` (`sbom_import` | `source_sca`)
- Returns **204** for CycloneDX (direct ingestion), **200** for SPDX (standard upload queue), or **402** when product-activation entitlement fails.
- Body: SBOM file

**Notable third-party scanner types** (for `POST /public/v0/scans/third-party`): `trivy`, `snyk`, `anchore_grype`, `anchore_enterprise_policy_check`, `aqua_scan`, `checkmarx_one_scan`, `gitlab_dast`, `trufflehog3`, plus `cyclonedx`, `spdx`, `sarif`, and ~150 others.

#### Direct S3 Upload Flow

The modern large-file upload path (presigned S3), superseding the direct
`application/octet-stream` `POST /scans`.

```bash
# 1. Begin the upload — returns scanId + uploadUrl (single-part) or s3UploadId (multipart)
POST /public/v0/scans/upload?projectVersionId=67890
{
  "filename": "firmware.bin",            // ^[a-zA-Z0-9. -_()]{1,60}$
  "types": ["sca"],                       // ≥1; same values as the scan endpoints (incl. spdx, sbom_import, third-party)
  "multipartUpload": false                // default false
}
# → ScanUploadV0 { scanId, multipartUpload, uploadUrl?, s3UploadId? }

# 2a. Single-part: PUT the file bytes directly to the returned uploadUrl (S3), then:
POST /public/v0/scans/67890-scanId/start      # no body — begins processing

# 2b. Multipart: for each part, fetch a presigned URL, PUT the part, then complete:
GET  /public/v0/scans/{scanId}/multipart/{s3UploadId}/{partNumber}/url
#    → ScanUploadPartUrlV0 { uploadUrl }
POST /public/v0/scans/{scanId}/multipart/{s3UploadId}/complete
{ "eTags": { "1": "<etag-1>", "2": "<etag-2>" } }   # 409 on conflict
POST /public/v0/scans/{scanId}/start          # begin processing
```

**AI scan quality report** (`GET /public/v0/scans/{scanId}/unpack-evaluation`):
Returns AI-generated unpack quality assessment for binary SCA scans. Legacy scans return 404.

Response (`UnpackEvaluationResponseV0`):
- `fsanId` — Finite State Analysis ID
- `scanId` — scan ID
- `createdAt` — evaluation timestamp
- `report` → `{ unpackingScore (1–100), shortSummary, summary, potentialIssues[] → { relevantFilepaths (string[]), description, recommendation } }`

**Download scan file** (`GET /public/v0/scans/{scanId}/files`):
Download a file from STP **by SHA-256 hash** via the required `filter` query
param — an **RSQL expression** `filter=hash=="<sha256>"` (NOT a bare hash; a
bare value 400s / matches nothing); **SCA scans only** (SAST/CONFIG etc. have
no downloadable files).

#### fsscan Update Check

`GET /public/v0/fsscan/update-check` — scanner self-update check used by
fs-scan/fs-cli on startup. Required query params: `version`, `os`
(`linux` | `darwin` | `windows`), `arch` (`amd64` | `arm64`); optional
`product` (`fs-scan` | `fs-cli`). Returns `FsscanUpdateResponse`
`{ update_available, version, sha256, signature (b64 Ed25519), download_url
(presigned S3) }`; **204** when already up to date. Client-tooling concern,
not an agent workflow.

### SBOMs

```bash
# Download CycloneDX SBOM with VEX data (includeVex defaults to true)
GET /public/v0/sboms/cyclonedx/67890?includeVex=true

# Download SPDX SBOM without VEX (pass explicitly — default is true)
GET /public/v0/sboms/spdx/67890?includeVex=false

# Include firmware file inventory in the BOM
GET /public/v0/sboms/cyclonedx/67890?includeFiles=true
```

**`includeVex` defaults to `true`** — always pass explicitly if you want `false`.

**`includeFiles`** (default off, both formats) — when `true`, file-type
components are emitted into the SBOM: as regular components in CycloneDX, and
into the `files` array in SPDX. (The project's `includeFilesInSbom` setting
controls the default; this query param overrides it per-request.)

**403** is returned (CycloneDX) if the user lacks VIEW_PROJECT permission on one or more projects in the dependency tree. (SPDX has no 403 in the spec.)

**503** is returned when the SBOM export queue is full — retry later.

### Firmware Filesystem

Browse and read the **unpacked firmware filesystem** of a project version,
backed by STP's file-tree. **Note the prefix is `projects/versions/{pvId}/`**
— distinct from the `versions/{pvId}/` family. The firmware (fsan) and org are
resolved server-side and are never supplied by the caller. All four ops accept
an optional `scanId` query param to address a specific scan (default = the
latest successful binary scan).

**Hash-addressed model:** call `/tree` first; the `file_hash` it returns is the
addressing key for `/overview`, `/content`, and `/file`.

**Two permission tiers:**
- `/tree` + `/overview` → **findings-read** (broadly available)
- `/content` + `/file` → **org-admin `VIEW_ANY_PROJECT_FILE`** (403 otherwise)

```bash
# Navigate the unpacked rootfs (metadata only)
GET /public/v0/projects/versions/67890/filesystem/tree?path=/usr/bin&depth=2

# Per-file metadata by hash
GET /public/v0/projects/versions/67890/filesystem/overview?hash=<sha256>

# Ranged read of raw bytes (admin)
GET /public/v0/projects/versions/67890/filesystem/content?hash=<sha256>&offset=0&maxBytes=4096

# Full streamed download of raw bytes (admin)
GET /public/v0/projects/versions/67890/filesystem/file?hash=<sha256>
```

| Op | Params | Returns | Permission |
|----|--------|---------|------------|
| `/tree` | `path` (default `/`), `depth` (1–8, default 1), `scanId` | `FilesystemTreeNode` | findings-read |
| `/overview` | `hash` (req), `scanId` | `FileOverviewV0` | findings-read |
| `/content` | `hash` (req), `offset` (default 0), `maxBytes` (default 4096, **cap 131072 = 128 KiB**), `scanId` | `application/octet-stream` | admin `VIEW_ANY_PROJECT_FILE` |
| `/file` | `hash` (req), `scanId` | `application/octet-stream` (streamed) | admin `VIEW_ANY_PROJECT_FILE` |

**`FilesystemTreeNode`** (`additionalProperties: true` — STP-relayed; ignore
unknown fields): `file_path`, `file_hash` (null for dirs/symlinks),
`mime_type` (nullable), `has_children`, recursive `children[]` (included only
within the requested `depth`), `errors[]`.

**`FileOverviewV0`** (`additionalProperties: true`): `file_hash`, `file_size`
(int64), `full_type` (file(1)/ELF string), `mime_type`, `machine` (CPU arch),
`hashes[]` (`{alg, value}` for md5/sha1/sha256/…), `errors[]`, and
**`security_features[]`** = binary hardening (`{name, enabled}`) for the CRA
Annex I §1.3 code-execution mitigations — NX (`dep`), PIE (`pic`), RELRO
(`relro-full`), stack canary (`stackguard`), ASLR (`aslr`). Empty for
non-binary files; a feature not listed has an uncertain status.

**Errors:** all four use `StpRelayErrorResponse` (see the code table in
§ Security Assessment) — e.g. `NO_FILESYSTEM_SCAN` (no completed binary scan),
`PATH_NOT_FOUND` (tree), `FILE_NOT_FOUND` (file), `STP_UPSTREAM_ERROR` (502 →
retry).

### Security Assessment (STP relay)

A 27-operation, all-`GET` family exposing **STP** (Static analysis platform)
device-context data over the public customer API. All paths share the base
prefix:

```
/public/v0/projects/versions/{projectVersionId}/security-assessment/
```

**Shared semantics:**
- `projectVersionId` (path, required) and optional `scanId` (query — override
  the default latest-successful-binary-scan) on **every** op.
- Permission: **findings-read** — except the three ADMIN-ONLY ops below.
- Each op is a **verbatim relay from STP**; many 200 bodies are untyped open
  objects (`additionalProperties: true`) — ignore unknown fields.

**Three ADMIN-ONLY ops** (return **403 `JsonErrorResponse`** for non-admins,
and their output is sensitive — **do not log or echo it**):
- `…/crypto/details` — full crypto material **including raw key/PEM bytes**
  when `includeFullMaterial=true` (the default).
- `…/docker-image/config/raw` — raw Docker/OCI config **including env var
  values** (possible secrets).
- `…/users` — `/etc/passwd` + `/etc/shadow` accounts **including shadow
  password hashes**.

**Pagination quirk — `X-Has-More` is NOT surfaced.** STP's `X-Has-More`
header is not relayed. On the search/list endpoints, **infer "more" from a
full page** (page returned == `limit`), then advance `offset`. The callgraph /
dependency ops carry a `has_more` flag inside the response body instead.

**Error model — `StpRelayErrorResponse`** (superset of `JsonErrorResponse`
with a machine-readable `code` discriminator; exactly one `errors[]` entry):

| `code` | HTTP | Meaning |
|--------|------|---------|
| `INVALID_PROJECT_VERSION_ID` | 400 | `projectVersionId` is not a valid id |
| `INVALID_SCAN_ID` | 400 | the `scanId` override is not a valid id |
| `INVALID_FILE_HASH` | 400 | `hash` is not a valid SHA-256 |
| `PROJECT_VERSION_NOT_FOUND` | 404 | no such project version (or not visible to caller) |
| `SCAN_NOT_FOUND` | 404 | a `scanId` was supplied but no such scan exists for this version |
| `NO_FILESYSTEM_SCAN` | 404 | the version has **no completed binary scan** with an unpacked filesystem (distinct from not-found) |
| `PATH_NOT_FOUND` | 404 | tree: the requested path does not exist |
| `FILE_NOT_FOUND` | 404 | file: no file with the given hash exists |
| `STP_UPSTREAM_ERROR` | 502 | the upstream STP service errored / was unreachable — **transient, retry** |

> **Forge consumer-in-waiting:** `RemoteSTPClient` (in
> `qemu_static_reachability.py`) is a stub for exactly this surface. The
> callgraph / has-imports / dependencies-loaded-by ops publish over the public
> API the STP data forge's pentest reachability lane has been reconstructing
> from a local firmware walk — wiring `RemoteSTPClient` here makes
> `FORGE_STP_BACKEND=remote` viable.

#### Key shapes

**Callgraph — callers / callees** (`…/callgraph/callers`, `…/callgraph/callees`):
- Params: `function[]` (required, repeatable, max 20), optional `filePath[]`
  (scope the search), `scanId`.
- `/callers` → `array<SecAssessCallerResult>`: each `{ target_function,
  callers[CallgraphEdge], has_more }`.
- `/callees` → `array<SecAssessCalleeResult>`: each `{ source_function,
  callees[CallgraphEdge], has_more }`.
- `CallgraphEdge`: `{ function_name, source_file_path, source_file_hash,
  target_file_path, target_file_hash, call_type }` where `call_type ∈
  direct | cross_binary | unresolved`.
- `/callers` is **THE reachability endpoint** — "is the vulnerable symbol
  actually called?" without a local binutils walk.

**Has-imports / has-exports** (`…/binaries/has-imports`, `…/binaries/has-exports`):
- Params: `import[]` / `export[]` (required, repeatable — the symbol names to
  search for), optional `hash[]` (content-hash filter; omit to search all),
  `match_mode` (`any` | `all`), `offset`, `limit`, `scanId`.
- Returns `SecAssessBinaryImportMatchResponse` / `…ExportMatchResponse`:
  matching binaries only, each `{ file_hash, file_paths[], matched_imports[] }`
  (or `matched_exports[]`). Server-side firmware-wide "who imports
  strcpy/gets/system / who exports symbol X" search. **Page-walk by full-page
  detection** (`X-Has-More` not surfaced).

**Binaries — file-details / info** (`…/binaries/file-details`, `…/binaries/info`):
- `/file-details` (`hash` required, single): `SecAssessBinaryFileDetailsResponse`
  — per-binary `imports`, `exports`, `symbols`, `library_dependencies`, plus
  SAST-derived `functions` / `unidentified_functions`. The SAST function lists
  are **empty without a BINARY_SAST scan**.
- `/info` (`hash[]` required, repeatable, max 100): rz-bin hardening info
  (NX / PIE / RELRO / stack canary). Untyped open-object body.

**Binaries — imports / exports** (`…/binaries/imports`, `…/binaries/exports`):
- `hash[]` (required, repeatable, max 100). Imported (dynamic) / exported
  symbol names for the given binaries. Untyped open-object body.

**Dependencies — loads / loaded-by** (ELF load graph):
- `/dependencies/loads` (`filePath[]` required, repeatable; optional
  `includeFunctions`): forward graph — libs a binary loads.
  `array<SecAssessDependencyResult>` `{ declared_libs, dependencies[],
  has_more }`.
- `/dependencies/loaded-by` (`filePath[]` required, max 20; optional
  `includeFunctions`): reverse graph — binaries that load a given library.
  `array<SecAssessDependentResult>` `{ file_path, file_hash, dependents[],
  has_more }`. Answers "is this vulnerable .so actually loaded by a reachable
  executable?"

**Kernel config** (`…/kernel/config`): `SecAssessKernelConfigResponse` — the
kernel `CONFIG_*` map(s) (e.g. verify `CONFIG_MODULE_SIG_FORCE`, or whether a
subsystem is built-in vs a loadable module).

#### Remaining ops (one line each)

| Op (suffix) | Purpose |
|---|---|
| `…/architecture` | CPU-arch profile: count per arch across binaries + bare-metal blobs |
| `…/architecture-breakdown` | Per-arch decoder/ISA detail (EM codes, word size, endianness, source+count) |
| `…/boot/cmdline` | Bootloader kernel command line(s) recovered statically (grub/extlinux/U-Boot/DT/Android) |
| `…/boot/signing-chains` | Boot signing artifacts (summary), leaf→root chain anchoring. Query `format`, `signed`, `offset`, `limit` |
| `…/boot/signing-chains/details` | Full signing chains for `hash[]` (open object) |
| `…/configs/list` | List parsed config files — metadata only (file hash, paths, Augeas module). `offset`/`limit` |
| `…/configs/details` | Full parsed config trees (Augeas) for `hash[]` (open object) |
| `…/crypto/list` | Crypto summaries (cert/key type, algorithm, size, paths — NO key bytes). Query `privateKey`, `offset`, `limit` |
| `…/services/list` | Detected services (systemd/init): service_type, name, disabled, user, ports, run_levels. `offset`/`limit` |
| `…/services/details` | Full details for one service by `configPath` |
| `…/services/systemd-units` | Systemd units with security-hardening scoring. Query `name`, `offset`, `limit` |
| `…/processing-errors` | Files that could not be unpacked/analyzed in the latest completed scans |
| `…/docker-image/config` | OCI/Docker config metadata (labels, user, entrypoint, env var NAMES + suspected-secret flags — no values) |

### Folders

```bash
# List all folders
GET /public/v0/folders?sort=name:asc

# Get folder details
GET /public/v0/folders/abc-123

# List projects in a folder
GET /public/v0/folders/abc-123/projects?limit=1000

# List users with folder roles
GET /public/v0/folders/abc-123/users

# List groups with folder roles
GET /public/v0/folders/abc-123/groups
```

**Sort options**: `name`, `created_at` (each `:asc` / `:desc`).

> **Sort-key gotcha:** `GET /folders` sorts on **`created_at`**, but
> `GET /folders/{folderId}/projects` sorts on **`created`** (no `_at`) — the
> two endpoints use different sort keys for the same concept.

**Response** (`FolderV0`):
- `id` — folder UUID
- `name` — folder name
- `description` — folder description
- `parentFolderId` — parent folder (for nesting)
- `projectCount` — number of projects in the folder
- `createdBy` — creator

**Create folder** (`POST /public/v0/folders`) — returns **201** `FolderV0`:
```json
{
  "name": "Production Devices",
  "description": "All production firmware",
  "parentFolderId": "parent-uuid-or-null"
}
```

**Update folder** (`PUT /public/v0/folders/{id}`):
`UpdateFolderV0Request` accepts `name`, `description`, **and `parentFolderId`**
— so editing the description and **re-parenting** both go through PUT folder
(not just renaming).
```json
{ "name": "Prod", "description": "Production firmware", "parentFolderId": "new-parent-uuid" }
```

**Delete folder** (`DELETE /public/v0/folders/{id}`) — returns **204**.

> **Delete does NOT require emptying the folder first.** The folder's projects
> are automatically reassigned to the **root folder** on delete. (Removing a
> project from a folder, likewise, falls it back to root.)

**Add/remove projects** (`PUT/DELETE /public/v0/folders/{id}/projects`):
Body is a plain `array<string>` of project IDs. A project lives in exactly one
folder, so `PUT` removes it from its current folder if any. Both return **200**
with a **`BulkOperationResult`** `{ successful[], failed[], totalProcessed }`.
```json
["project-id-1", "project-id-2"]
```

**Set user/group roles** (`PUT /public/v0/folders/{fId}/users/{uId}/roles` and
`…/groups/{gId}/roles`) — body `array<string>`; returns **202**:
```json
["VIEWER", "EDITOR"]
```

**RBAC read shapes:**
- `GET /folders/{id}/users` → `array<FolderUserV0>` `{ folderId, userId, email, roles[] }`
- `GET /folders/{id}/groups` → `array<FolderGroupV0>` `{ folderId, groupId, name, description, memberCount, roles[] }`
- `GET /folders/roles` → `array<string>` (the assignable folder role catalog you pass to `set*Roles`)

### Audit Trail

The audit endpoint is designed as a security log but currently functions as an entity activity log.

```bash
# Recent audit events
GET /public/v0/audit?limit=100

# Filter by user (single `=`)
GET /public/v0/audit?filter=user=jdoe

# Filter by event type (repeated key)
GET /public/v0/audit?filter=type=LoginEvent&filter=type=NewCveEvent

# Filter by date range (two ISO-8601 timestamps, NO Z on date)
GET /public/v0/audit?filter=date=2025-01-01T00:00:00,date=2025-12-31T23:59:59

# Search audit events
GET /public/v0/audit?search=delete&limit=50
```

> **The audit `filter` is NOT RSQL, and there is NO `sort` param.** Supported
> params are exactly `filter`, `search`, `offset`, `limit`. The filter
> supports only three attributes via single `=` (not `==`): `type`
> (repeated-key for multiple), `user` (or `=ilike=` / `=nilike=` for
> wildcards), and `date` (range `date=START,date=END`, **no `Z` suffix**).
> There is **no `action` field** — event kind is `type` (e.g.
> `type=LoginEvent`). Compatibility forms `time=ge=START;time=le=END` and
> `type==X` are also accepted, but do not pass general RSQL.

**Query param**: `search` — case-insensitive search on event type and username

**Response header**: `X-Total-Count`

**Response** (`AuditEventV0`):
- `time` — event timestamp (ISO8601). **Note**: may be plain string OR `{ value: "..." }` wrapper for backwards compat
- `user` — username. Same polymorphic format as `time`
- `type` — event type name. Same polymorphic format. Known types: `LoginEvent`, `NewCveEvent`, `CreateProjectEvent`, `AddComponentEvent`, `SuppressExpirationNotificationEvent`, `TrackerConfigEvent`
- `comment` — optional event comment
- `application` → `{ id, name, description, type, createdBy, created, version }` — project context (for project events)
- `appVersion` → `{ hash, name, environment }` — version context
- `component` → `{ arch, group, artifact, version, id }` — component context (for component events)
- `data` → free-form object with event-specific payload (e.g., `{ project: { id, name, version } }`)
- `components` — array of `{ application, component }` pairs (for notification events)

### Summary Counts

Pre-aggregated counts for dashboard widgets — faster than fetching all findings.

```bash
# Exploit intelligence counts
GET /public/v0/project/version/67890/findings/exploit/counts
# → { withExploit, withoutExploit, byExploit, total }

# Finding status breakdown
GET /public/v0/project/version/67890/findings/status/counts
# → { byStatus: { OPEN: 42, RESOLVED: 10, ... }, total }

# Category breakdown
GET /public/v0/project/version/67890/findings/category/counts
# → { byCategory: { CVE: 100, SAST: 20, ... }, total }

# Severity breakdown
GET /public/v0/project/version/67890/findings/severities/counts
# → { bySeverity: { CRITICAL: 5, HIGH: 20, ... }, total }
```

### Users

```bash
# List all users
GET /public/v0/users/?limit=100&sort=username:asc

# Get user by ID (optionally enrich)
GET /public/v0/users/user-uuid?enrich=full

# Create user
POST /public/v0/users/
{
  "userId": "john.doe",
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "orgRoles": ["MEMBER"]
}

# Send password reset
GET /public/v0/users/user-uuid/password-reset
```

> **`userId` is REQUIRED on create.** `POST /users/` requires both `userId`
> and `email`. `userId` is the immutable, customer-unique identity (e.g.
> `"john.doe"`); `firstName`/`lastName`/`orgRoles` are optional. A create
> without `userId` returns HTTP 400; a duplicate `userId` returns **409**.

**Query params** (on both user-read endpoints): `enrich` (`basic` | `full`) — controls how much detail is returned.

**Filter attributes**: `username`, `email`
**Sort options**: `username`, `email`, `created`

### Authenticated User

```bash
# Get current user info
GET /public/v0/authUser

# What can I do on this project?
GET /public/v0/authUser/projects/12345/actions

# What can I do on this folder?
GET /public/v0/authUser/folders/abc-123/actions
```

**Response** (`AuthenticatedUserV0`):

> **Identity lives under the `user` key (the username) — NOT `email`,
> `username`, or `id`.** This is non-obvious and a known foot-gun (forge's
> `_user_identity.resolve_authenticated_user` encodes it after PR #79's
> "unknown"-identity bug). Read `response["user"]` for the identity.

Other fields: `new` (bool), `lastLogin`, `newNotifications`, `orgActions[]`,
`orgRoles[]`, `organization` → `{ id, name }`.

The `actions` sub-endpoints (`/projects/{id}/actions`,
`/folders/{id}/actions`, `/folders/actions`) each return `array<string>` of
permitted action names.

### Groups

```bash
# List groups
GET /public/v0/groups?sort=name:asc

# Create group (orgRoles settable at create)
POST /public/v0/groups
{ "name": "Security Team", "description": "AppSec engineers", "orgRoles": ["MEMBER"] }

# Add members
POST /public/v0/groups/group-uuid/members
["user-uuid-1", "user-uuid-2"]

# Remove members
DELETE /public/v0/groups/group-uuid/members
["user-uuid-1"]

# Set group project roles
PUT /public/v0/groups/group-uuid/projects/12345/roles
["VIEWER", "TRIAGE"]

# Delete group (force if has members)
DELETE /public/v0/groups/group-uuid
{ "force": true }

# Bulk delete
POST /public/v0/groups/bulk-delete
{ "ids": ["group-uuid-1", "group-uuid-2"], "force": false }
```

**Filter attributes**: `name`
**Sort options**: `name`, `createdAt`, `updatedAt`

**Response** (`GroupV0`): `{ id, name, description, createdAt, updatedAt, memberCount, orgRoles[] }`.

**Quirks:**
- The request body for `POST /groups` and `PUT /groups/{id}` is the **full
  `GroupV0`** (so `orgRoles[]` and `description` are settable on create/update).
- `POST /groups` returns **200** (NOT 201) with the full `GroupV0` body; **409**
  if the name already exists.
- `POST /groups/bulk-delete` body is `{ ids: string[], force: boolean }`,
  returns **204**, and returns **409** if any group has members and
  `force=false`.
- `set*Roles` (project/folder) return **202**; a **404** also fires on an
  unknown **role name**, not just an unknown group/project.
- `GET /groups/{id}/members` → `array<GroupMemberV0>`
  `{ id, email, firstName, lastName, addedAt }` (supports `offset`/`limit`).
- `POST /groups/{id}/members` returns `array<string>` (the resulting member id
  list), 200 — not the group object.

### API Tokens

```bash
# List tokens
GET /public/v0/api-tokens?sort=name:asc

# Create token
POST /public/v0/api-tokens
{ "name": "CI/CD Pipeline Token" }

# Delete token
DELETE /public/v0/api-tokens/token-uuid

# Bulk delete
POST /public/v0/api-tokens/bulk-delete
["token-uuid-1", "token-uuid-2"]
```

**Sort options**: `name`, `createdTimestamp`, `createdBy` (each `:asc` / `:desc`).

> **The token `secret` is shown only on creation.** `POST /api-tokens` returns
> **201** with an `ApiToken` whose `secret` is present **once** (one-way hashed
> thereafter); subsequent reads return only `secretHint` (a `"12..45"` form).
> Capture the secret at create time. `bulk-delete` silently skips tokens not
> visible to the caller.

### CVE Updates

Poll for CVE changes (added, retracted, severity changes, exploit updates) since the original scan.

```bash
# Get all CVE updates in a date range
GET /public/v0/cves/updates?startDate=2026-03-01T00:00:00Z&endDate=2026-03-15T23:59:59Z&limit=100

# Filter to exploit updates for a specific version
GET /public/v0/cves/updates?updateType=exploit_update&projectVersionId=67890&startDate=2026-03-01T00:00:00Z&endDate=2026-03-15T23:59:59Z
```

**Query params**:
- `updateType` (optional): `cve_added`, `cve_retracted`, `severity_update`, `exploit_update`
- `startDate` (required): lower bound, exclusive — ISO-8601 with Z
- `endDate` (required): upper bound, inclusive — ISO-8601 with Z
- `projectVersionId` (optional): restrict to one version
- `folderId` (optional): restrict to one folder
- `offset`, `limit` (default 20, max 100)

**Response headers**: `X-Total-Count`, `X-Offset`, `X-Limit`

**Response** (`CveUpdateV0`):
- `cveId` — CVE identifier
- `type` — `new`, `update`, `retract`
- `oldValue` → `{ cvss, severity, exploitMaturity }` — pre-change values
- `newValue` → `{ cvss, severity, exploitMaturity }` — post-change values
- `projects` — array of affected projects

### Product Findings

Findings across a Product's full transitive dependency tree. For Products (versions with project dependencies), returns findings from all sub-projects.

```bash
# Get all findings across the product tree
GET /public/v0/versions/67890/product-findings?limit=500&sort=risk:desc

# Filter to critical CVEs
GET /public/v0/versions/67890/product-findings?filter=category==CVE;severity==CRITICAL
```

**Filter attributes**: same as `/public/v0/findings` plus `dependencyPath`

**Sort options**: same as `/public/v0/findings` plus `dependencyPath`

**Response**: `VersionFindingListEntry` — same shape as `FindingV0` with additional `dependencyPath` field showing the chain of project dependencies.

### Product Components

Mixed component + project dependency rows across a Product's dependency tree.

```bash
# Get all product components
GET /public/v0/versions/67890/product-components?limit=500&sort=dependencyPath:asc

# Filter by name, unedited only
GET /public/v0/versions/67890/product-components?filter=name==openssl*&editStatus=unedited
```

**Query params**:
- `editStatus` — `any` | `edited` | `unedited` (manual-override state filter)

**Sort options**: `dependencyPath`, `relation`, `objectType`, `name`, `version`, `date`, `releaseDate`, `created`, `type`, `warnings`, `violations`, `status`, `vulnCount`, `policy`, `supplier`, `license`, `source`

**Response fields** (in addition to standard component fields):
- `objectType` — `Component` or `Project` (discriminator)
- `relation` — `Direct` or `Indirect`
- `dependencyPath` — chain showing how this component is included

### Used-By (Reverse Dependencies)

Find which Products depend on a specific version.

```bash
GET /public/v0/versions/67890/used-by
# → [{"id": 111, "name": "Product A"}, {"id": 222, "name": "Product B"}]
```

### SIP Updates Config

Organization-level and project-level configuration for SIP (Software Intelligence Platform) vulnerability updates — controls nightly rescanning.

```bash
# Get org-level config
GET /public/v0/config/updates
# → { "updateEnabled": true, "updateScope": "GLOBAL" }

# Set org-level config (both fields required)
PUT /public/v0/config/updates
{ "updateEnabled": true, "updateScope": "GLOBAL" }

# Get project-level config (inherits from org if not overridden)
GET /public/v0/projects/12345/updates
# → { "enabled": true, "scope": "latest", "source": "organization" }

# Override project-level config
PUT /public/v0/projects/12345/updates
{ "inherit": false, "enabled": true, "scope": "latest" }

# Revert project to org inheritance
PUT /public/v0/projects/12345/updates
{ "inherit": true }
```

**Org-level response** (`UpdatesConfigV0Response`):
- `updateEnabled` — boolean, whether nightly updates are globally enabled
- `updateScope` — `GLOBAL` (all projects inherit) or `PER_PROJECT` (each controls independently)

`PUT /config/updates` (`UpdateUpdatesConfigV0Request`) requires **both**
`updateEnabled` and `updateScope`. Requires `VIEW_UPDATES_CONFIG` /
`EDIT_UPDATES_CONFIG` permission (403 otherwise); writes are audited.

**Project-level response** (`ProjectUpdatesConfigV0Response`):
- `enabled` — boolean, whether updates are enabled for this project
- `scope` — always `"latest"` for now
- `source` — `"organization"` (inheriting) or `"project"` (overridden)

**Permissions**: `VIEW_UPDATES_CONFIGURATION` / `EDIT_UPDATES_CONFIGURATION` for org-level; `VIEW_PROJECT_UPDATES` / `EDIT_PROJECT_UPDATES` for project-level.

### Scoring Config

Organization-level toggle for **EPSS-weighted scoring**.

```bash
# Get the org's EPSS-weighted scoring config
GET /public/v0/config/scoring
# → { "epssWeightedScoringEnabled": false }

# Enable EPSS-weighted scoring
PUT /public/v0/config/scoring
{ "epssWeightedScoringEnabled": true }
```

**Response / body** (`ScoringConfigV0Response` / `UpdateScoringConfigV0Request`):
- `epssWeightedScoringEnabled` — boolean, **default `false`** (new orgs start
  disabled). On the PUT body it is required.

When enabled, this gates the EPSS-weighted UI columns and the
`epssWeightedRisk` / `epssWeightedSeverity` finding fields, sort keys, and
filter attributes (see § Findings). Reachable only via `raw_api` today — no
dedicated forge tool.

### Admin

Admin endpoints require `VIEW_ANY_PROJECT` (global admin) permission.

```bash
# Recompute rollup counts for a single project
POST /public/v0/admin/products/{projectId}/recompute-rollups
# → { processed, discrepanciesFixed }

# Recompute rollup counts for all projects (same as nightly scheduler)
POST /public/v0/admin/products/recompute-all-rollups
# → { zeroDepsFixed, withDepsProcessed, discrepanciesFixed, errors }
```

These run the two-pass rollup reconciliation: bulk fix for zero-dependency versions, then per-version CTE for versions with dependencies.

- `recompute-rollups` returns `RecomputeRollupsResponse` `{ processed:int, discrepanciesFixed:int }`.
- `recompute-all-rollups` returns `RecomputeAllRollupsResponse` `{ zeroDepsFixed:int, withDepsProcessed:int, discrepanciesFixed:int, errors:int }`.

### Compliance

`POST /public/v0/compliance/workflows/status` — update a supplier-attestation
compliance workflow's status (niche; no forge consumer).

Body (`ComplianceWorkflowStatusRequest`):
```json
{
  "workflowId": "wf-123",
  "status": "approved",
  "suppliers": [
    { "externalId": "supplier-a", "status": "approved" }
  ]
}
```
200 = success; 400 = `JsonErrorResponse`.

### Organization Roles

`GET /public/v0/org/roles` — returns a flat `array<string>` of available
organization role names (not role objects). 401/403 on missing auth/authz.

### Tracker Integration

Create issue tracker tickets (Jira, etc.) for findings or components. All ticket creation/delink endpoints are scoped to `{projectVersionId}` (pvId comes **before** `/tickets/`).

```bash
# Test connectivity (NOT scoped to pvId)
POST /public/v0/tracker/tickets/ping
{
  "workspace_url": "https://company.atlassian.net",
  "username": "bot@company.com",
  "api_key": "...",
  "project_key": "SEC",
  "name": "Jira"
}

# Create tickets for findings (scoped to pvId)
POST /public/v0/tracker/{projectVersionId}/tickets/findings
{
  "components": ["vcId1", "vcId2"],
  "findings": ["CVE-2024-1234"],
  "ticket_name": "Fix CVE-2024-1234",
  "ticket_summary": "Critical vulnerability requires remediation",
  "priority": "High",
  "project_key": "SEC",
  "project_name": "Security Fixes",
  "type": "Task",
  "mode": "ONE_PER_FINDING"
}

# Create tickets for components
POST /public/v0/tracker/{projectVersionId}/tickets/components
{ ... same TrackerTicketRequest schema ... }

# Preview ticket before creating
POST /public/v0/tracker/{projectVersionId}/tickets/preview
{ ... same TrackerTicketRequest schema ... }

# Delink a ticket — finding-mode (most common)
PUT /public/v0/tracker/{projectVersionId}/tickets/delink
{
  "ticket_keys": ["SEC-123"],
  "finding_id": "CVE-2024-5535"
}

# Delink a ticket — component-mode
PUT /public/v0/tracker/{projectVersionId}/tickets/delink
{
  "ticket_keys": ["SEC-123"],
  "component_hash": "3113283771350600467"
}
```

> **Spec-vs-platform divergence on `components` / `preview`.** v0.3.0 marks
> `POST /tracker/{projectVersionId}/tickets/components` and
> `…/tickets/preview` as **live, non-deprecated** endpoints (pvId-scoped,
> body `TrackerTicketRequest`). Empirically, however, the platform has
> returned **HTTP 500** on both — use `POST /tracker/{projectVersionId}/tickets/findings`
> as the primary ticket-creation interface until that is resolved.

**`mode` values**: `SINGLE_FINDING`, `ONE_PER_FINDING`, `ONE_FOR_ALL_FINDINGS`, `ONE_PER_COMPONENT`, `ONE_FOR_ALL_COMPONENTS`, `SINGLE_COMPONENT`

**`priority` values**: `Highest`, `High`, `Medium`, `Low`, `Lowest`

**Ping response**: `{ status: 0, projects: [{ key, name, default, ticketTypes }] }` — status 0 = success, -3 = unknown host

**Create response**: `{ createdTicketKeys: ["SEC-123"], failedTickets: [] }`

**Delink**: the spec requires **at least one of** `finding_id` or
`component_hash` (the two dispatch to different join tables and the handler
picks the path).

- `finding_id` is the **CVE/GHSA string** (the `findingId` field from `GET /public/v0/findings`, e.g. `"CVE-2024-5535"`), NOT the numeric `id` field. The platform's predicate matches `cust_ticket_finding.fclass_id`. Use this for tickets created in modes `SINGLE_FINDING` / `ONE_PER_FINDING` / `ONE_FOR_ALL_FINDINGS`.
- `component_hash` is the **GlobalComponent hash** (the `gcId` field from `GET /public/v0/components`). The platform's predicate matches `cust_ticket_component.component_hash`. Use this for tickets created in modes `SINGLE_COMPONENT` / `ONE_PER_COMPONENT` / `ONE_FOR_ALL_COMPONENTS`.

> ⚠️ **Silent success — verify state, do not trust the response.** The endpoint
> returns `200 OK` with `null` body whether N rows or **zero rows** were updated
> (`TrackerTicketService.delinkTickets` doesn't surface the affected-row count).
> If you pass the wrong identifier (numeric `id` instead of CVE string, vcId instead
> of gcId, finding-mode key for a component-mode ticket), the call appears to
> succeed but nothing is removed. Callers MUST re-fetch the finding's
> `tracker.all_tickets` after the call and confirm the requested ticket_keys are
> absent before declaring success. This is a known platform bug.

**Note**: The un-scoped `/tracker/tickets/findings` path may still work for backwards compatibility but the pvId-scoped paths are the canonical form.

---

## RSQL Filter Syntax

The `filter` query parameter uses RSQL (REST Query Language) on most
collection endpoints. **Exception:** `GET /audit` does NOT use RSQL — see its
section above.

### Operators
| Operator | Meaning | Example |
|----------|---------|---------|
| `==` | Equals | `severity==CRITICAL` |
| `!=` | Not equals | `status!=RESOLVED` |
| `>` / `>=` | Greater than / or equal | `detected>=2025-01-01T00:00:00` |
| `<` / `<=` | Less than / or equal | `detected<=2025-01-31T23:59:59` |
| `=in=()` | In list | `severity=in=(CRITICAL,HIGH)` |
| `=out=()` | Not in list (RSQL standard) | `status=out=(RESOLVED,NOT_AFFECTED)` |
| `=like=` | Case-sensitive wildcard (`*`) | `component=like=spring*` |
| `=ilike=` | Case-insensitive wildcard | `component=ilike=Spring*Boot` |
| `=nlike=` | Negated case-sensitive wildcard | `component=nlike=spring*` |
| `=nilike=` | Negated case-insensitive wildcard | `component=nilike=Spring*Boot` |
| `;` or `and` | AND | `category==CVE;severity==CRITICAL` or `category==CVE and severity==CRITICAL` |
| `,` or `or` | OR | `severity==CRITICAL,severity==HIGH` or `severity==CRITICAL or severity==HIGH` |
| `(...)` | Grouping | `(severity>HIGH or inKev==true)` |

**Wildcard escaping**: use `\\*` for a literal `*`, use `\\\\` for a literal `\`.

### Common Filter Patterns
```
# CVE findings only (use this instead of type=cve to preserve reachabilityScore)
filter=category==CVE

# Date range (no Z suffix for findings endpoint)
filter=detected>=2025-01-01T00:00:00;detected<=2025-01-31T23:59:59

# Specific project
filter=projectId==12345

# Open findings only — use ``=out=``, not ``=notin=`` (platform RSQL
# parser rejects the latter with HTTP 400)
filter=status=out=(RESOLVED,RESOLVED_WITH_PEDIGREE,NOT_AFFECTED,FALSE_POSITIVE)

# Combined: CVE + CRITICAL + date range
filter=category==CVE;severity==CRITICAL;detected>=2025-01-01T00:00:00

# Wildcard: all spring-boot CVEs
filter=component=like=spring*boot and findingId=like=CVE-2025-*

# Case-insensitive component search
filter=component=ilike=Spring*Boot

# Title match (SAST findings or CVE ID prefix)
filter=title=ilike=*calloc*
```

### Date Format
- **Findings endpoint**: `2025-01-01T00:00:00` (no Z suffix)
- **Other endpoints**: `2025-01-01T00:00:00Z` (with Z suffix)
- **Audit endpoint** (`date=` attr): `2025-01-01T00:00:00` (no Z suffix)

---

## VEX Status Update

```
PUT /public/v0/findings/{projectVersionId}/{findingId}/status
```

### Request Body

Only `status` is required. Supply `response`, `justification`, and `reason` when they actually describe the triage rationale; omit them otherwise (they store as null on the finding).

```json
{
  "status": "NOT_AFFECTED",
  "response": "WILL_NOT_FIX",
  "justification": "CODE_NOT_REACHABLE",
  "reason": "Optional free-text explanation"
}
```

Minimal status-only body (e.g. moving a finding into `IN_TRIAGE` while you investigate):

```json
{ "status": "IN_TRIAGE" }
```

### Valid Enum Values

**status** (required):
`EXPLOITABLE`, `IN_TRIAGE`, `NOT_AFFECTED`, `FALSE_POSITIVE`, `RESOLVED`, `RESOLVED_WITH_PEDIGREE`

**response** (optional — supply when meaningful):
`CAN_NOT_FIX`, `WILL_NOT_FIX`, `UPDATE`, `ROLLBACK`, `WORKAROUND_AVAILABLE`

**justification** (optional — supply when meaningful):
`CODE_NOT_PRESENT`, `CODE_NOT_REACHABLE`, `REQUIRES_CONFIGURATION`, `REQUIRES_DEPENDENCY`, `REQUIRES_ENVIRONMENT`, `PROTECTED_BY_COMPILER`, `PROTECTED_AT_RUNTIME`, `PROTECTED_AT_PERIMETER`, `PROTECTED_BY_MITIGATING_CONTROL`

### When to supply response / justification

| Scenario | response | justification |
|----------|----------|---------------|
| NOT_AFFECTED + truly unreachable | `WILL_NOT_FIX` | `CODE_NOT_REACHABLE` |
| NOT_AFFECTED + code absent | `WILL_NOT_FIX` | `CODE_NOT_PRESENT` |
| IN_TRIAGE / still investigating | omit | omit |
| EXPLOITABLE | omit unless a remediation stance is known | omit |
| RESOLVED / RESOLVED_WITH_PEDIGREE | omit | omit |

Picking an enum value that doesn't match the real rationale is worse than leaving it null — those fields surface in VEX/SBOM exports as the stated reason a finding is not affected.

### Bulk Set VEX Statuses

```
PUT /public/v0/findings/{projectVersionId}/status/set/bulk
```

A real **bulk VEX SET** endpoint exists as of v0.3.0 (`bulkSetFindingStatusV0`)
— it applies **heterogeneous per-finding verdicts** in one call. This is the
preferred path for large triage applies: it **consumes a single rate-limit
token for the whole batch**, vs one token per finding for N individual PUTs.

**Body** (`BulkSetFindingStatusV0Request`):
```json
{
  "findings": [
    { "findingId": "12345", "status": "NOT_AFFECTED", "justification": "CODE_NOT_REACHABLE", "response": "WILL_NOT_FIX", "reason": "dead code" },
    { "findingId": "67890", "status": "IN_TRIAGE" }
  ]
}
```
- `findings[]` — `maxItems: 5000`. An empty array is accepted (no-op 200).
- `findingId` is a **string** matching `^-?[0-9]+$` (the numeric internal `id`,
  serialized as a string to preserve int64 precision — **not** the CVE string).
- `status` required per item; `justification` / `response` / `reason` optional
  (same enums as the single-finding PUT).

**Semantics — best-effort, NOT transactional:** findings that exist in the
project version are applied; any id not found is **skipped and reported** (a
single bad id does not roll back the rest, mirroring bulk-clear). Malformed ids,
invalid enum values, duplicate ids, and over-max batches are rejected up front
with **400** (no partial apply).

**Response** (`BulkSetFindingStatusV0Response`):
```json
{
  "status": "partial_success",
  "summary": { "total": 2, "succeeded": 1, "failed": 1 },
  "results": [
    { "findingId": "12345", "success": true,  "status": "NOT_AFFECTED" },
    { "findingId": "67890", "success": false, "status": null, "error": "not found" }
  ]
}
```
- `status` ∈ `success` (all applied) | `partial_success` (some not found) |
  `failure` (none applied). An empty request is `success`.
- `results[]` has one entry per requested finding, in request order — retry
  just the `success:false` rows.

### Clear VEX Status

```
PUT /public/v0/findings/{pvId}/{fId}/status/clear      # Single finding
PUT /public/v0/findings/{pvId}/status/clear/bulk        # Bulk clear
```

Bulk clear body: `{ "findingIds": ["123", "456", "789"] }`

> **`findingIds` must be STRINGS.** The spec's `BulkClearFindingStatusV0Request`
> requires `findingIds` as **strings** matching `^-?[0-9]+$` (`minItems:1`) to
> preserve int64 precision — NOT integers. Passing ints can fail; always send
> stringified ids.

> ⚠️ **Bulk clear is heap-sensitive — cap at ~10 IDs per call and send serially.**
> The backing service (`VexService.bulkRemoveVexStatus`) loads each finding as
> a full JPA entity, takes a `PESSIMISTIC_WRITE` lock on its VersionComponent,
> writes an audit row, calls `em.merge()`, and runs `updateVulnerabilityCounts`
> per finding — all inside one `@Transactional`. The persistence context
> grows with every finding and never flushes until commit, so large chunks
> or concurrent bulk-clear requests blow past the pod's heap limit and get
> OOMKilled. Treat this endpoint as "many small serial calls," not "one big
> call." This is a known platform constraint until the Java side streams
> per-entity work.

---

## Pagination

- Default page size: `limit=10000` (most endpoints)
- Scans endpoint default `limit=20` (max 100)
- CVE updates / product-activation list: default `limit=20`, max 100
- Use `offset` for pagination: `offset=0`, `offset=10000`, `offset=20000`
- Stop when: empty page, 3 consecutive empty pages, or all records are duplicates
- Some endpoints return `X-Total-Count` header (CVEs, audit)
- **Security-Assessment search endpoints do NOT surface `X-Has-More`** — infer
  "more" from a full page (page size == `limit`) and advance `offset`; the
  callgraph/dependency ops carry a `has_more` flag in the body instead.

### Response Formats

| Format | Structure | Endpoints |
|--------|-----------|-----------|
| Array | `[{...}, {...}]` | projects, findings, components, folders |
| Wrapper object | `{"items": [...]}` or `{"scans": [...]}` | scans, version components/findings |
| Single object | `{...}` | project by ID, version by ID |

Null/empty rows can appear for archived/excluded items — filter them out.

---

## API Quirks and Gotchas

### 1. `risk` field is 0–100, NOT 0–10 CVSS
```python
cvss_display = api_risk_value / 10.0  # 98 → 9.8
```

### 2. `type=cve` URL parameter omits `reachabilityScore`
Use `filter=category==CVE` RSQL filter instead. The `type` param silently drops reachability data.

### 3. VEX PUT — `response` / `justification` are optional
Only `status` is required. The platform previously rejected PUTs missing `response` / `justification`, but that was fixed; status-only writes are now accepted and the optional fields stay null on the finding. Supply them only when they describe the real triage rationale (those values surface in VEX/SBOM exports).

### 4. Date format differs by endpoint
Findings: `2025-01-01T00:00:00` (no Z). Others: `2025-01-01T00:00:00Z` (with Z). Audit `date=` attr: no Z.

### 5. Auth header is `X-Authorization`, not `Authorization`/`Bearer`

### 6. Nested object fields are NOT flattened
Access via `response["component"]["name"]`, not `response["component_name"]`.

### 7. Finding `id` vs `findingId`
- `id` = internal primary key (int64, used for VEX PUT path parameter)
- `findingId` = string CVE identifier (e.g., `CVE-2024-1234`)

### 8. No component detail endpoint
There is no `GET /public/v0/components/{id}`. Use `GET /public/v0/components?filter=...` or `GET /public/v0/components/search?name=...` instead.

### 9. Version delete returns 409 if dependencies exist
`DELETE /public/v0/versions/{pvId}` fails with 409 Conflict if the version has active project dependencies. Remove dependencies first.

### 10. Group delete requires `force` flag if members exist
`DELETE /public/v0/groups/{id}` returns 409 if the group has members. Pass `{ "force": true }` to delete anyway. (`bulk-delete` likewise 409s unless `force:true`.)

### 11. `includeVex` on SBOM endpoints defaults to `true`
Both `/sboms/cyclonedx/{pvId}` and `/sboms/spdx/{pvId}` default `includeVex=true`. Always pass the param explicitly if you want `false` to avoid unexpectedly including VEX data. (Both also accept `includeFiles` — default off — to emit file-type components into the BOM.)

### 12. VEX path params use the numeric `id`, not the CVE string
`PUT /public/v0/findings/{pvId}/{fId}/status` and the `status/clear` variant use the internal numeric `id` field (int64), NOT the string `findingId` (e.g., `CVE-2024-1234`). The bulk set/clear endpoints take the same numeric id, serialized as a **string** matching `^-?[0-9]+$`. The `findingId` field is for display/filtering only.

### 13. Tracker `components` / `preview` path shape and 500s
The canonical v0.3.0 path shape is `/tracker/{projectVersionId}/tickets/{components|preview}` — the **pvId comes before `/tickets/`**. The spec marks both as live, but the platform empirically returns **HTTP 500** on them; use `POST /tracker/{projectVersionId}/tickets/findings` as the primary ticket-creation interface (spec-vs-platform divergence).

### 14. Delete folder reassigns projects to root (no pre-emptying)
`DELETE /public/v0/folders/{id}` does NOT require the folder to be empty — its projects are auto-reassigned to the root folder. Do not strip projects from a folder before deleting it.

### 15. `GET /audit` is not RSQL and has no `sort`
The audit filter supports only `type` / `user` / `date` via single `=` (and the repeated-key / compat forms); there is no `action` field and no `sort` param. See § Audit Trail.

### 16. `bulkSetFindingStatusV0` exists — "bulk apply" is real now
A bulk VEX **set** endpoint exists (`PUT /findings/{pvId}/status/set/bulk`, maxItems 5000, one rate-limit token). The old note that "bulk apply does NOT exist" is obsolete — see § Bulk Set VEX Statuses.

### 17. `AuthenticatedUserV0` identity is under the `user` key
`GET /authUser` returns the identity (username) under `user`, NOT `email`/`username`/`id`. See § Authenticated User.

---

## Deprecated Endpoints

| Endpoint | Replacement |
|----------|-------------|
| `GET /public/v0/{projectId}/branches/{branchId}/versions` | `GET /public/v0/projects/{projectId}/versions` |
| `POST /public/v0/{projectId}/branches/{branchId}/versions` | `POST /public/v0/projects/{projectId}/versions` |

---

## Rate Limiting and Retries

| Code | Action |
|------|--------|
| 429 | Rate limited — retry with exponential backoff |
| 500 | Server error — usually bad data, do NOT retry |
| 502, 503, 504 | Transient — retry with backoff |
| 400, 401, 403, 404, 405, 409, 422 | Permanent — do NOT retry |

**Retry strategy**: `delay = min(2^attempt, 64) + random(0, 1)` seconds. For paginated fetches: `min(30 * attempt, 120)` seconds. Max 6–8 attempts. Check `Retry-After` header on 429.

**Throttling**: 0.5s delay between paginated calls. VEX updates: 1–5 parallel requests (or one `status/set/bulk` call — see § Bulk Set VEX Statuses — for a whole batch in one token).

> **Security-Assessment `STP_UPSTREAM_ERROR` is a 502** — transient, retry with
> backoff. Distinguish it from the 4xx `StpRelayErrorResponse` codes (permanent)
> via the `code` discriminator.

---

## Testing Patterns

```bash
# Smoke test: verify auth
curl -s "https://$DOMAIN/api/public/v0/projects?limit=1" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.[] | .name'

# List project versions
curl -s "https://$DOMAIN/api/public/v0/projects/12345/versions" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.[].name'

# Cross-project version listing
curl -s "https://$DOMAIN/api/public/v0/versions?limit=10&sort=created:desc" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.[].name'

# Count CVE findings
curl -s "https://$DOMAIN/api/public/v0/findings?filter=category==CVE&limit=1" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq 'length'

# Portfolio-wide CVE search
curl -s "https://$DOMAIN/api/public/v0/cves?filter=cveId==CVE-2024-1234" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.[0].affectedProjects'

# Download SBOM
curl -s "https://$DOMAIN/api/public/v0/sboms/cyclonedx/67890?includeVex=true" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.components | length'

# Set VEX status — status-only (moving into IN_TRIAGE while investigating)
curl -X PUT "https://$DOMAIN/api/public/v0/findings/12345/67890/status" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_TRIAGE"}'

# Set VEX status — with semantic response + justification
curl -X PUT "https://$DOMAIN/api/public/v0/findings/12345/67890/status" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"NOT_AFFECTED","response":"WILL_NOT_FIX","justification":"CODE_NOT_REACHABLE","reason":"call site is dead code"}'

# Bulk set VEX statuses — heterogeneous, one rate-limit token (string findingIds)
curl -X PUT "https://$DOMAIN/api/public/v0/findings/67890/status/set/bulk" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"findings":[{"findingId":"12345","status":"NOT_AFFECTED","justification":"CODE_NOT_REACHABLE"},{"findingId":"67891","status":"IN_TRIAGE"}]}'

# Clear VEX status
curl -X PUT "https://$DOMAIN/api/public/v0/findings/12345/67890/status/clear" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN"

# Upload a binary for SCA scan
curl -X POST "https://$DOMAIN/api/public/v0/scans?type=sca&filename=firmware.bin&projectVersionId=67890" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @firmware.bin

# Check authenticated user permissions
curl -s "https://$DOMAIN/api/public/v0/authUser/projects/12345/actions" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.'

# List folders
curl -s "https://$DOMAIN/api/public/v0/folders?sort=name:asc" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.[].name'

# Audit trail (filter is NOT RSQL — single `=`, no sort)
curl -s "https://$DOMAIN/api/public/v0/audit?filter=type=LoginEvent&limit=10" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.'

# Summary counts for a version
curl -s "https://$DOMAIN/api/public/v0/project/version/67890/findings/severities/counts" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.'

# Security Assessment — who imports a dangerous symbol (STP relay)
curl -s "https://$DOMAIN/api/public/v0/projects/versions/67890/security-assessment/binaries/has-imports?import=system&match_mode=any&limit=100" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.'

# Firmware filesystem — navigate the unpacked rootfs
curl -s "https://$DOMAIN/api/public/v0/projects/versions/67890/filesystem/tree?path=/usr/bin&depth=2" \
  -H "X-Authorization: $FINITE_STATE_AUTH_TOKEN" | jq '.'
```

---

## HELIX Differences

> **GATE:** This section applies ONLY when `api_version: helix` is set in the
> active environment. Do not apply any of these behaviors to legacy environments.

HELIX is the next-generation Finite State API. When `api_version: helix`
is set in the active environment, the following differences apply.

### Breaking Changes

| Change | Legacy | HELIX | Error |
|--------|--------|-------|-------|
| Pagination limit | Up to 10000+ | Max 1000 | ZodError: limit must be ≤ 1000 |
| Finding IDs | int64 | UUID strings | int() parse failure in bulk operations |
| Project `type` | Uppercase (`FIRMWARE`) | Lowercase (`firmware`) | 400: invalid_enum_value |
| Project `description` | Optional | Required | 400: Required |
| Scan filter field | `projectVersion` | `versionId` | 400: Unknown filter field |
| New project types | — | `machine-learning-model`, `data`, `cryptographic-asset` | N/A (additive) |

### Missing Endpoints (404)

These legacy endpoints are not available on HELIX. Status is unknown — confirm
with HELIX engineering before assuming they are permanently removed.

| Endpoint | Legacy Purpose |
|----------|---------------|
| `GET /cwes/{id}` | CWE metadata lookup |
| `GET /cves/updates` | CVE change feed (critical for Workflow 13) |
| `GET /versions/{id}/product-components` | Product dependency tree components |
| `GET /versions/{id}/used-by` | Reverse dependency lookup |
| `POST /tracker/tickets/ping` | Jira integration test |
| `PUT /folders/{id}/projects` | Assign projects to folder |
| `GET /findings/{pvId}/{fId}/cves` | CVE metadata per finding |

### Server-Side Issues (500)

These return Internal Server Error. Include request IDs when reporting.

| Endpoint | Method |
|----------|--------|
| `/folders` | POST (create) |
| `/folders/{id}` | DELETE |
| `/components/search` | GET |

### New HELIX Endpoints

Not available on legacy. Forge can adopt these in future iterations.

| Feature | Endpoints |
|---------|-----------|
| Branches | `GET/POST /projects/{id}/branches` |
| Auto-triage | `POST /findings/auto-triage` |
| Finding comments | `POST/PATCH /findings/{id}/comments` |
| Bulk VEX | `POST /findings/bulk-vex` |
| Component replace | `POST/DELETE /components/{id}/replace` |
| Upgrade advice | `GET /components/{id}/upgrade-advice` |
| Component evidence | `GET /components/{id}/evidence` |
| Ensure version | `POST /versions/ensure` |
| Binary scan context | `POST /binary-scans/context` + flow |
