# SPEC 02 — Findings & VEX Triage

_Product spec. Depends on SPEC 00 (conventions, plugin skeleton, direct remote clients) and SPEC 01 (sync engine — pull/status/plan/push, three-way merge, review panel). Facts about the backend are grounded in "Findings & VEX Triage — Local-First Design" (2026-08-11), cited below as **[LFD §n]**. This is the flagship surface: the first thing built, and the best demo._

**Status:** ready for implementation. **Phase:** 2 of the SPEC 00 build sequence — deliberately first among surfaces, because it forces the hardest problems (stable keys, three-way merge with no server preconditions, bulk apply with partial failure) and everything after reuses what it builds.

---

## 1. The job to be done

### 1.1 Triage day, today

A product security engineer opens a firmware scan and faces **3,000–10,000 findings** (fixtures run 2,155–9,507; the biggest real scan is 39,295; the engineering ceiling is ~150k) [LFD §5]. Their day looks like this:

1. **Open the web UI.** Page through findings 20 at a time (the API default). Every filter change is a server round trip.
2. **For each finding worth a look:** open the detail, open the CVE in another tab, grep the firmware in a third tool to check whether the vulnerable code path is even present, come back, pick a VEX status from a dropdown, type a justification, save. **Four context switches per decision.** A good engineer does maybe 60–100 real decisions a day this way.
3. **Bulk operations are blunt.** The server's auto-triage has exactly one rule (reachability) and `overwrite=true` clobbers human decisions by design [LFD §4]. The UI's bulk action fires and forgets — it hardcodes success regardless of the response [LFD §5].
4. **Then a new firmware version ships**, and the platform's `carry_forward_vex` best-effort copies decisions forward — except when it fails (non-fatal, unretried), except comments (never carried), except `CODE_NOT_REACHABLE` decisions when only the name matches (deliberately not promoted), and except any finding the vulnerability monitor soft-deleted and later re-confirmed, which comes back as a **fresh row with NULL VEX** [LFD §2.3]. Weeks of triage silently evaporates, and nobody can tell you which decisions survived without diffing exports by hand.
5. **Nothing is reviewable.** There is no diff, no "here's what changed and why," no way for a second engineer to approve a batch of decisions before they hit the system of record. The audit log records what happened; nothing gates what's about to happen.

The felt experience: triage is a slow, lossy, unreviewable grind, and the most valuable work product — the _reasoning_ behind each decision — lives in a free-text field that doesn't survive a version bump.

### 1.2 Triage day, on this surface

The same engineer opens bb. The firmware rootfs, the source, and the findings are in one workspace.

1. **The Findings panel paints in under 200ms from the local SQLite cache** (SPEC 00 §10). All 9,507 findings are there, virtualized, filterable instantly — no server in the render path.
2. They filter to `reachability: unreachable`, select all 2,140 rows, and say to the agent: _"triage all unreachable findings in busybox — check the reachability factors and write the justifications."_ The agent queries the cache, applies the policy file, and **writes YAML decision blocks into `.fs/triage/`** — it never touches the server [LFD §6.2].
3. The engineer reviews the result as a **plain git diff**: 40 decision blocks with status, justification, evidence, and pin. They edit two, delete one, commit.
4. `plan` shows exactly what will hit Assurance Studio — creates, updates, noops, two conflicts where a teammate triaged in the web UI (with who-and-when from the audit trail). They resolve the conflicts, hit **Push**. Bulk-applied in ≤500-item chunks, per-item results, failures stay dirty and re-plan.
5. **Next month's scan:** decisions re-attach to the new version's findings by the same tier ladder the server itself uses. What `carry_forward_vex` dropped, the local overlay re-applies. What genuinely went stale (`CODE_NOT_REACHABLE` pinned to an exact version that changed) is flagged, not silently pushed. **The overlay is the durable triage memory the platform only best-effort approximates** [LFD §6.5].

The felt experience: _"I did a day of triage in twenty minutes and every decision is reviewable"_ (SPEC 00 §2). The keyboard does the routine cases; the agent does the bulk cases; git reviews both; the sync engine pushes deliberately.

---

## 2. The core UX flows

All flows assume the SPEC 00 skeleton: plugin configured with a Platform origin + `X-Authorization` secret, a project selected (`bb finite-state project use`), and at least one `pull` completed. Forge is not required. Panel routes live under the **Findings** nav panel (`/plugins/finite-state/findings/*`). Every screen has the four designed states (loading skeleton / empty / error / unconfigured) per SPEC 00 §7.

### Flow A — manual triage of a single finding

_Persona: product security engineer. Trigger: working through the untriaged queue._

1. **Findings list.** The engineer opens the Findings panel. Header shows the active project/version, a **sync status chip** (`✓ pulled 12m ago · 3 local changes`), and the filter bar. The table shows the default view: untriaged first, sorted by risk score descending. A left-edge **local-change gutter** (● dot) marks rows with uncommitted overlay decisions.
2. **Navigate.** `j`/`k` moves the row cursor. The engineer lands on `CVE-2023-42364 · busybox 1.36.1 · HIGH · reachability −40`.
3. **Open detail.** `Enter` opens the detail pane (right split, list stays visible; route becomes `findings/f/<stableKey>`). The detail shows: title/description/remediation; the component identity block (purl, name, version — monospace); effective CVSS/EPSS/percentile, KEV badges, exploit maturity (all re-resolved server-side from SIP at pull time [LFD §1.1]); **reachability factors rendered as evidence** ("no caller of `getvar_s`"); location; the current server VEX tuple; the **decision history** from the audit endpoint (who/when/old/new); and comments.
4. **Cross-check in the same workspace.** The location field links into the firmware mount (SPEC 05) — one click opens the binary's directory in the file tree. No app switch.
5. **Decide.** The engineer presses `n` (`NOT_AFFECTED`). Because CDX 1.6 requires a justification for `NOT_AFFECTED` (enforced by us, since the API doesn't [LFD §2.1]), a **justification picker** opens inline: nine CDX 1.4 justifications, type-ahead, with one-line explanations. They pick `CODE_NOT_REACHABLE`. A reason field is pre-seeded from the reachability evidence; they edit it: _"awk applet not compiled into this image (`CONFIG_AWK` unset); no call path from any input vector."_ `⌘Enter` commits the decision.
6. **What actually happened:** the plugin wrote (via bb's SHA-256 CAS file write [LFD §6.0]) a decision block into `.fs/triage/acme-router/busybox.yaml`, keyed by the stable key — **no network call**. Because status is NOT_AFFECTED with justification CODE_NOT_REACHABLE, `pin: exact_version` was set automatically (§4.4). The row's gutter dot lights up; the row's triage column flips to a hollow `NOT_AFFECTED` badge (hollow = local, solid = pushed); the header chip increments to `4 local changes`. The cursor auto-advances to the next untriaged row.
7. **Visible in status.** `bb finite-state status` (CLI or the sync panel) now lists the decision under **local changes**: `~ VEX busybox@1.36.1 / CVE-2023-42364 → NOT_AFFECTED (CODE_NOT_REACHABLE)`. It rides the normal SPEC 01 plan/push flow whenever the engineer chooses — one decision or two hundred, same gate.

**Empty state** (no findings pulled): "No findings cached for this version. Run a pull." with a Pull button. **Error state**: stale-with-banner, never blank (SPEC 00 §10).

### Flow B — agent bulk triage (the money flow)

_Persona: engineer + agent. Trigger: "triage all unreachable findings in busybox."_

1. **The ask.** In a bb thread, the engineer types: _"Triage all unreachable findings in busybox on acme-router v2.1. Use the policy file. Show me a summary before I review the diff."_ (Or from the panel: select rows → **Ask agent to triage** — which spawns a thread via `bb.sdk.threads.spawn` with the selection as context.)
2. **Agent queries, locally.** The agent calls `fs_findings_query` (§6.2) — a read tool against the SQLite cache: `{component: "busybox", reachability: "unreachable", triage: "untriaged"}` → 41 findings with scores, factors, KEV/EPSS. No remote call.
3. **Agent applies policy.** It calls `fs_triage_apply_policy` (or reasons per-finding and calls `fs_triage_set` for each). The tool evaluates `.fs/triage/policy.yaml` (§5): rule `unreachable-not-affected` matches 39 findings; **2 are held back** — one is in KEV (holdback rule), one lacks `vuln_in_dataset`. The tool **writes YAML decision blocks** with `provenance.by: "bb-agent"`, per-finding evidence strings, and `pin: exact_version` — and returns a machine summary. **It has not touched the server; there is no tool that can** (SPEC 00 §8, SPEC 01 §8).
4. **Agent reports inline.** The agent's message ends with `::fs-triage-summary{id="tr-20260811-1402"}` — a live card: _39 decisions written · 2 held for human (1 KEV) · 0 conflicts · view diff_. It lists the two holdbacks with reasons and asks the engineer to review.
5. **Human reviews the git diff.** The engineer opens bb's diff panel on `.fs/triage/` (or `git diff` in a terminal). The artifact is 39 YAML blocks — status, justification, response, reason-with-evidence, pin, provenance [LFD §6.2]. They spot one weak justification, edit the YAML directly in the editor (it's just a file), delete one block they disagree with, and commit: `triage: busybox unreachable batch (agent, reviewed)`. **The model got code review before it reached the system of record** (SPEC 01 §3).
6. **Plan.** `bb finite-state plan triage` (or the review panel): `38 to update, 0 conflicts, 0 orphans`. Each row expands to the field-level diff. The blast-radius footer notes ">20 entities — confirm" (SPEC 01 §5).
7. **Push.** The engineer clicks **Push** in the review panel. The engine groups by pvId, resolves stable keys to cached finding uuids (covering duplicate rows precisely), sends `PUT /findings/{pvId}/status/set/bulk` in ≤500-item plugin chunks, consumes per-item partial success, stamps `[bb:tr-20260811-1402]` into `vex_reason`, advances each decision's `sync.base` on success [LFD §6.3]. Progress streams to the panel via realtime. Result card: `38 applied · 0 failed`. The CLI `push triage` spelling can lead the engineer here, but cannot execute the apply.
8. **The demo beat:** _the agent proposed changes to your security model — here is the exact diff — approve to push_ (SPEC 01 §7). Total elapsed for the engineer: ~3 minutes of review for what was an afternoon of clicking.

### Flow C — conflict (someone triaged in the web UI)

_Trigger: a teammate set `CVE-2022-48174` to EXPLOITABLE in Assurance Studio yesterday; our local overlay says NOT_AFFECTED from last week._

1. **Detection is at plan time, not push time.** There are no server preconditions — every write surface is last-write-wins [LFD §5] — so the engine detects conflicts by three-way tuple comparison during `plan`: fresh-pulled server tuple (`theirs`) ≠ recorded `sync.base`, AND `theirs` ≠ `ours` ⇒ conflict [LFD §6.4].
2. **What the user sees.** In the plan (CLI and review panel), the item renders with all three tuples plus **server audit attribution** fetched from `GET .../activity`:

   ```
   ⚠ conflict  VEX  busybox@1.36.1 / CVE-2022-48174
        base:   IN_TRIAGE  —  "needs exploitability review"
        ours:   NOT_AFFECTED (CODE_NOT_REACHABLE)  —  "ash arithmetic not exposed…"
        theirs: EXPLOITABLE  —  set by jsmith, 2026-08-10 16:41 (web UI)
   ```

   In the Findings table, the row shows a ⚠ conflict badge; the detail pane shows a side-by-side of ours vs theirs with the audit line.

3. **Resolution is explicit, per item:** `take-ours` / `take-theirs` / edit (SPEC 01 §6). The **surface default for VEX is theirs-wins on human server edits** — the server cannot distinguish our stale write from an intentional override, so a human's deliberate web-UI decision should not be silently overwritten by our older one [LFD §6.4]. The plan applies the default but requires the user to confirm defaults-applied conflicts before Push enables.
4. **Choosing `take-theirs`** rewrites the local YAML block to match the server and advances its base — the local overlay now _remembers_ the teammate's decision and will carry it across versions. **Choosing `take-ours`** keeps the YAML and pushes over theirs (with the audit trail preserving both). **Edit** opens the YAML block in the editor.
5. **Residual race** (server changes between plan and apply) is accepted — strictly smaller than the platform UI's own exposure, reconstructable from the audit trail. If fs-api ships `vexChangedAt` + an `expected` precondition, apply upgrades to true compare-and-swap with no client redesign [LFD §6.4, §7.1].

### Flow D — re-scan drift (new version, decisions re-attach)

_Trigger: v2.2 firmware is scanned. New version ⇒ every finding is a brand-new row with a new uuid [LFD §1.2]; `carry_forward_vex` has already run server-side with its known gaps._

1. **Pull.** `bb finite-state pull triage` (or the panel's Pull button) fetches v2.2's findings into the cache and re-resolves **every YAML decision key against the new component set via the tier ladder** (§4.3) — the same ladder the server uses [LFD §6.5].
2. **The drift report** (rendered in the sync panel and CLI) buckets every decision:
   - **`re-attached / noop`** — server carry-forward already landed the same tuple. Nothing to do. (Expected majority.)
   - **`re-apply`** — the key resolves, but the server tuple is NULL or differs from ours with base unchanged: carry-forward missed it (RPC failure, soft-delete/re-confirm cycle, tier-3 exclusion). **The local overlay is the recovery mechanism** — plan shows these as updates [LFD §6.5].
   - **`stale`** — `pin: exact_version` and the component version changed (e.g. busybox 1.36.1 → 1.37.0). The decision is _reported, not pushed_ — matching the server's own refusal to promote `CODE_NOT_REACHABLE` across versions [LFD §2.3, §6.5]. The row appears in a **Stale decisions** filter with a one-click path: "Re-evaluate" opens the finding detail with the old reasoning pre-loaded; or "Ask agent to re-verify" spawns a thread that re-checks reachability on the new version and either refreshes the decision (new evidence, new provenance) or flags it.
   - **`orphaned`** — the key no longer resolves at any tier (component removed from the image). Kept in YAML, listed in `status`, excluded from plan. §8.2 covers lifecycle.
3. **What the user sees in the panel:** version switcher now shows v2.2; a post-pull banner: _"312 decisions re-attached · 14 re-apply (carry-forward missed) · 9 stale (version bump) · 2 orphaned."_ Clicking each count applies the corresponding filter.
4. **New untriaged findings** enter the default queue and the agent's policy queue — Flow B runs again on the delta.
5. **Push** the re-applies like any plan. Note the noop rule matters here: identical re-PUTs still bump `vex_changed_at` and spam the audit log, so anything already matching is _skipped, never re-sent_ [LFD §5, §6.3].

### Flow E — vendor VEX import

_Trigger: a supplier ships a CycloneDX VEX / CSAF / OpenVEX document for a component in the image._

1. **Import is local-first.** `bb finite-state triage import-vex ./vendor/acme-soc-vex.json --vendor "Acme SoC"` (also a panel action: **Import VEX…**). Port the already-reviewed CDX VEX / CSAF / OpenVEX reader logic as local plugin code, preserving the OpenVEX mapping `affected→EXPLOITABLE`, `fixed→RESOLVED`, `under_investigation→IN_TRIAGE`, `not_affected→NOT_AFFECTED` [LFD §2.1]. Do not import or invoke the Forge runtime. The command **writes YAML overlay decisions** with `provenance.by: "vendor:acme-soc"` and `provenance.evidence: "<doc id/filename>"`.
2. **We reject the legacy importer's fabrication caveat.** The prior importer defaulted omitted fields to `justification=CODE_NOT_PRESENT`, `response=WILL_NOT_FIX` — fabricated rationale that reaches exports [LFD §3.2]. Our importer **never invents fields**: an omitted justification on NOT_AFFECTED imports as an **incomplete decision** — written to YAML with `justification: null` and listed in a "needs completion" report; plan validation blocks pushing it until a human (or agent, with evidence) completes it.
3. **Match report.** Statements match to cached findings via the tier ladder. Output: `matched: 71 · unmatched: 6 (component not in image) · already-triaged locally: 3 (kept ours — see conflicts)`. Unmatched statements are retained in the YAML with a `match: none` marker so a later pull can catch them (a component may appear in the next scan).
4. **Vendor-vs-local collisions** are not server conflicts — they're resolved at import time: existing local decisions win by default (`--overwrite` to prefer vendor), and each collision is listed.
5. **Review and push as normal.** The vendor's assertions become a git-reviewable diff, then a plan, then a push — same gate as the agent's work. A vendor document is just another untrusted author.

---

## 3. The panel design

One nav panel: **Findings** (`app.slots.navPanel({ id: "findings", title: "Findings", icon: "ShieldAlert", path: "findings" })`), subPath-routed (§6.1). Layout: full-bleed, three regions — filter/header bar, virtualized table, detail pane (right split, toggleable). Density per SPEC 00 §7: compact rows, monospace identifiers, right-aligned numerics, severity as color + label.

### 3.1 The findings table

- **Virtualized** with `@tanstack/react-virtual` (bundles from plugin node_modules; SPEC 00 §7). Target: 10k rows at 60fps, tested against the 39k fixture. Data comes from paged RPC (`limit ≤ 200` per call, cursor-paged) backed by SQLite — **no external call in a render path** (SPEC 00 §10).
- **Columns** (defaults; user-configurable, persisted in `bb.storage.kv`):

  | Column    | Notes                                                                                                     |
  | --------- | --------------------------------------------------------------------------------------------------------- |
  | ● (local) | gutter dot: local overlay decision not yet pushed; ⚠ variant for conflict; ◐ for stale                    |
  | Severity  | color + label, never color alone                                                                          |
  | CVE / ID  | monospace; `finding_id` text (CVE/GHSA); dup-row count badge when >1 row share the key (§8.3)             |
  | Component | name@version; hover reveals full purl                                                                     |
  | Risk      | right-aligned `risk_score`                                                                                |
  | EPSS      | right-aligned percentile; KEV badge inline (KEV / VC-KEV)                                                 |
  | Reach     | reachability score; negative renders as "unreachable" pill                                                |
  | Triage    | VEX status badge — hollow = local-only, solid = pushed/server, dashed = server value with no local record |
  | Age       | `first_seen_at`, relative                                                                                 |

- **Sort:** any column; default `triage=untriaged first, risk desc`.

### 3.2 Filters that matter

Filter bar chips + a `/`-focused query box. All filters compile to SQL against the cache — instant.

- **Severity** (multi), **Triage status** (untriaged / each VEX status / stale / conflict / orphaned / needs-completion), **Reachability** (unreachable / reachable / unknown), **KEV** (KEV / VC-KEV / none), **EPSS ≥ n**, **Component** (type-ahead over cached components), **Finding type** (`cve|sast|binary-sast|config|thirdparty`), **Has local change**, **Policy flag** (warning/violation counts > 0).
- **Saved views**, three shipped: _Untriaged by risk_, _Local changes_, _Needs attention_ (conflicts + stale + orphans + needs-completion). Saved views are the same objects the drift-report banner links into (Flow D.3).

### 3.3 Detail view

Right split pane (route `findings/f/<stableKey>`), list remains navigable behind it. Sections, top to bottom: identity header (CVE, component purl, severity, badges) → decision block (current server tuple, local tuple if different, decision controls) → intelligence (CVSS vector, EPSS, KEV, exploit maturity/info, CWEs, references) → reachability evidence (score + `factors` rendered as readable claims) → location (links into firmware mount) → history (audit events via cached activity, plus local provenance) → comments (server comments; read/write via comments CRUD; **flagged: comments do not carry across versions** [LFD §2.3], the UI says so next to the composer).

The decision block is the same domain component everywhere — `<FindingCard id={stableKey}/>` self-fetches by id (SPEC 00 §7) and renders in the panel, in the review panel's expanded rows, and inline in threads via the directive (§6.4).

### 3.4 Bulk selection + bulk decide

- `x` toggles row selection; `shift-j/k` extends; header checkbox selects filtered set ("Select all 2,140 matching" — selection is _the filter predicate_, not 2,140 row ids, so it survives re-sort and stays cheap).
- Selection summary bar slides up: count, severity histogram, actions: **Set status…** (opens the same status→justification→reason flow as single-row; reason supports `{evidence}` templating from per-row factors), **Apply policy** (dry-run preview first, §5.4), **Ask agent to triage** (spawns thread with the predicate as context), **Clear local decisions** (removes YAML blocks; if a block was already pushed, plan will surface a `clear` op → server clear endpoints [LFD §3.1]).
- Bulk decide writes N YAML blocks in one CAS transaction per component file; one undo entry (§3.6).

### 3.5 The "local changes" indicator

Three tiers of the same signal:

1. **Row gutter dot** (●/⚠/◐) — per finding.
2. **Header chip** — `N local changes · M conflicts`, click → the _Local changes_ saved view; from there **Review & push** → the SPEC 01 review panel (`/plugins/finite-state/sync`), pre-filtered to `entity_kind: vexDecision`.
3. **CLI** — `bb finite-state status` shows the same three lists (local / upstream / conflicts) plus orphans (SPEC 01 §5).

### 3.6 Keyboard-driven triage

Triage must feel like a game of speed chess. Every action below works from the list (row cursor) and the detail pane. Shortcuts display in a `?` overlay.

| Key                                      | Action                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `j` / `k`                                | next / previous row                                                                 |
| `J` / `K` (or `shift-j/k` with `x` mode) | extend selection down / up                                                          |
| `x`                                      | toggle row selection                                                                |
| `Enter` or `o`                           | open / focus detail pane                                                            |
| `Esc`                                    | close detail → clear selection → clear filters (progressive)                        |
| `]` / `[`                                | next / previous **untriaged** finding                                               |
| `/`                                      | focus filter query box                                                              |
| `⌘K`                                     | command palette (all actions, saved views, version switch)                          |
| `n`                                      | set NOT_AFFECTED → opens justification picker (required)                            |
| `e`                                      | set EXPLOITABLE                                                                     |
| `t`                                      | set IN_TRIAGE                                                                       |
| `f`                                      | set FALSE_POSITIVE                                                                  |
| `r`                                      | set RESOLVED                                                                        |
| `R`                                      | set RESOLVED_WITH_PEDIGREE                                                          |
| `1`–`9`                                  | (inside justification picker) pick the nth CDX justification                        |
| `c`                                      | edit reason / add comment                                                           |
| `p`                                      | toggle pin (`exact_version` ↔ `any_version`; blocked for CODE_NOT_REACHABLE — §4.4) |
| `u`                                      | undo last local decision (reverts the YAML write; multi-level, session-scoped)      |
| `⌘Enter`                                 | commit decision and advance to next untriaged                                       |
| `d`                                      | show this row's local diff (ours vs base vs server)                                 |
| `g s`                                    | go to sync/review panel                                                             |
| `?`                                      | shortcut overlay                                                                    |

Status keys with a selection active apply to the selection (with the bulk confirm bar). The six status letters mirror the vocabulary exactly — six statuses, six keys [LFD §2.1].

---

## 4. Data model

### 4.1 SQLite cache — the `findings` table (Tier A: derived, never authored, regenerable [LFD §6.1])

Lives in the plugin DB (`<dataDir>/plugins/finite-state/data.db`), migrated via `bb.storage.migrate` (SPEC 00 §5). Mirrors server rows for pulled versions; **read-only to humans and agents** — CACHED class in the SPEC 01 registry.

```sql
CREATE TABLE findings (
  -- server identity (per-version ephemeral handles — cached, never authored against)
  uuid            TEXT NOT NULL,          -- server finding id; NOT stable across versions
  pv_id           TEXT NOT NULL,          -- project-version id
  project_id      TEXT NOT NULL,
  cve             TEXT NOT NULL,          -- finding_id text (CVE/GHSA)
  finding_type    TEXT NOT NULL,          -- cve|sast|binary-sast|config|thirdparty
  category        TEXT,

  -- component identity (the stable-key ladder inputs)
  component_id    TEXT,
  purl            TEXT,                   -- tier 1
  comp_name       TEXT NOT NULL,          -- tier 2/3 (case-folded on index)
  comp_group      TEXT,
  comp_version    TEXT,

  -- scoring & intel (effective values, resolved server-side at pull)
  severity        TEXT NOT NULL,
  risk_score      REAL,
  cvss_score      REAL,
  epss_score      REAL,
  epss_percentile REAL,
  is_in_kev       INTEGER NOT NULL DEFAULT 0,
  is_in_vc_kev    INTEGER NOT NULL DEFAULT 0,
  exploit_maturity TEXT,
  reachability_score REAL,
  factors         TEXT,                   -- jsonb passthrough (reachability evidence)
  vuln_in_dataset INTEGER,                -- needed by policy selectors (§5)
  cwes            TEXT,                   -- json array
  location        TEXT,
  warning_count   INTEGER NOT NULL DEFAULT 0,
  violation_count INTEGER NOT NULL DEFAULT 0,
  detected_at     TEXT,
  first_seen_at   TEXT,

  -- current server VEX tuple ("theirs")
  vex_status        TEXT,
  vex_justification TEXT,
  vex_response      TEXT,
  vex_reason        TEXT,

  -- sync bookkeeping
  is_deleted      INTEGER NOT NULL DEFAULT 0,   -- soft-delete mirror
  pulled_at       TEXT NOT NULL,

  PRIMARY KEY (pv_id, uuid)
);
CREATE INDEX findings_stablekey ON findings (project_id, purl, cve);
CREATE INDEX findings_namekey   ON findings (project_id, comp_name COLLATE NOCASE, comp_group COLLATE NOCASE, comp_version, cve);
CREATE INDEX findings_queue     ON findings (pv_id, vex_status, risk_score DESC);
CREATE INDEX findings_component ON findings (pv_id, comp_name COLLATE NOCASE);
```

Notes:

- The **base fingerprint** (server VEX tuple at last pull, per stable key) lives in SPEC 01's `base_snapshot` table (`entity_kind='vexDecision'`), not here — the cache row's `vex_*` columns are always _current_ theirs. Duplicate rows per stable key are expected and preserved (§8.3).
- Pull consumes the normalized `PlatformClient.getFindings({projectVersionId, page:{pageSize,continuation}})` async iterable; the direct adapter alone maps that to upstream offsets. The owner service still carries the explicit D-1 `projectId` + `projectVersionId` scope and passes only the reviewed route field to this version-addressed client call. The opaque yielded `next` value is recorded in `sync_state` for resume (SPEC 00 §5). No lane or persisted state names an upstream offset.
- **`overlay_index`** — a derived SQLite mirror of the YAML overlay, rebuilt by a file watcher on `.fs/triage/**`, so the table's local-change gutter and `has-local-change` filter are a JOIN, not a YAML parse per render. YAML remains the sole source of truth for authored decisions; dropping `overlay_index` loses nothing.

```sql
CREATE TABLE overlay_index (
  project     TEXT NOT NULL,
  stable_key  TEXT NOT NULL,             -- canonical serialization, §4.3
  file        TEXT NOT NULL,             -- .fs/triage/<project>/<component>.yaml
  cve         TEXT NOT NULL,
  status      TEXT, justification TEXT, response TEXT, reason TEXT,
  pin         TEXT NOT NULL,
  state       TEXT NOT NULL,             -- dirty|pushed|conflict|stale|orphaned|needs_completion
  by          TEXT, at TEXT,
  PRIMARY KEY (project, stable_key)
);
```

### 4.2 The YAML overlay (Tier B: authored, git-tracked, OVERLAY class)

One file per component under `.fs/triage/<project>/<component>.yaml`, exactly the schema from the research doc [LFD §6.1]:

```yaml
# .fs/triage/acme-router/busybox.yaml
schema: fs-triage/v1
project: acme-router
component:
  purl: pkg:generic/busybox@1.36.1 # tier-1 identity
  name: busybox # tier-2/3 fallback
  version: 1.36.1
decisions:
  CVE-2023-42364:
    status: NOT_AFFECTED
    justification: CODE_NOT_REACHABLE
    response: null
    reason: "awk applet not compiled into this image (CONFIG_AWK unset); no call path from any input vector."
    pin: exact_version # exact_version | any_version
    provenance:
      by: "bb-agent" # engineer id | "bb-agent" | "vendor:<name>"
      at: 2026-08-11T14:02:11Z
      evidence: "reachability_score=-40; factors: no caller of getvar_s"
    sync:
      base: { status: null, justification: null, response: null, reason: null }
      pushed_at: null
```

Deliberately absent: **finding uuids** (ephemeral; resolved at push time from the cache) and **version ids** (decisions re-attach across versions, like `carry_forward_vex`) [LFD §6.1]. Why two tiers: YAML can't hold 39k findings; SQLite isn't reviewable. YAML holds only intent + the three-way base — authored decisions run 10²–10³ per version [LFD §5].

All writes to these files — human (via panel), agent (via tools), importer — go through bb's SHA-256 compare-and-swap file API [LFD §6.0], so a panel write and an agent write can't silently clobber each other.

### 4.3 The stable key and the tier ladder

> The stable triage key is **(project, component-identity, CVE)**, where component-identity resolves by ladder: **purl → case-folded (name, group, version) → (name, group) any-version**. This is exactly the key the platform itself uses to move triage across versions (`carry_forward_vex`) and what the single-finding write endpoint keys on [LFD §1.4].

```ts
// lib/sync/stable-key.ts
export interface StableKey {
  project: string;
  purl: string | null; // tier 1
  name: string; // tier 2/3 (compare case-folded)
  group: string | null;
  version: string | null; // null ⇒ tier-3-only key
  cve: string;
}

export type Resolution =
  | { tier: 1 | 2 | 3; rows: CachedFinding[] } // rows: ALL matching (dups included)
  | { tier: "orphaned" };

export function resolve(
  db: Db,
  key: StableKey,
  pvId: string,
  pin: Pin,
): Resolution {
  const t1 = key.purl && db.byPurl(pvId, key.purl, key.cve);
  if (t1?.length) return { tier: 1, rows: t1 };

  const t2 =
    key.version &&
    db.byNameGroupVersion(
      pvId,
      fold(key.name),
      fold(key.group),
      key.version,
      key.cve,
    );
  if (t2?.length) return { tier: 2, rows: t2 };

  if (pin === "any_version") {
    // tier 3 gated on promotability, mirroring
    const t3 = db.byNameGroup(pvId, fold(key.name), fold(key.group), key.cve); // finding_justification_is_promotable
    if (t3?.length) return { tier: 3, rows: t3 };
  }
  return { tier: "orphaned" };
}
```

Resolution returns **all matching rows** — the bulk write addresses each cached uuid so duplicate rows are covered precisely; the CVE-keyed single PUT fallback fans out server-side anyway (`X-Affected-Count`) [LFD §3.1, §6.3].

Two distinct legacy alias sources feed the same declared old-to-new migration map: VEX-space aliases derived from legacy VEX identity (`rememberMigration`) and persisted cache-space aliases looked up by accepted finding id (`rememberPersistedKeyMigration`). That map rewrites only authored `.fs/triage` YAML; cache rows are regenerated by pull rather than rewritten. Canonical identity is derived from one Platform finding row. For purl-less rows, namespace normalization applies NFC, trims each slash-delimited segment, drops empty segments, uses the final segment as `name`, and percent-encodes each preceding `group` segment before joining them with `%2F` (`debian/stable/main/libxml2` → `name=libxml2`, `group=debian%2Fstable%2Fmain`). The key retains the raw wire `keyVersion` (for example `%2B`) so it remains collision-free and migration-stable, while the decoded `version` is display data. Authored write/read-back canonicalizes the namespace and raw key version symmetrically.

### 4.4 `pin` semantics

`pin` mirrors the server's promotability rule [LFD §2.3]:

- **`exact_version`** — the decision is evidence-bound to this build. On a version bump where the component version changed, it goes **stale** (reported, never auto-pushed). **Forced** for `justification: CODE_NOT_REACHABLE` — reachability is build-specific; this is the server's own tier-3 exclusion, enforced at write time and re-validated at plan time. The UI's `p` toggle is disabled with an explanatory tooltip for these.
- **`any_version`** — the decision follows the component across versions (tier 3 allowed). Appropriate for `CODE_NOT_PRESENT`, protocol-level FALSE_POSITIVEs, vendor assertions scoped to a product line.
- Default: `exact_version` (safe). Policy rules and the importer set it explicitly.

---

## 5. Policy-as-code — `.fs/triage/policy.yaml`

The platform's triage policy today is scattered: one hardcoded server rule (reachability), fs-report's band rules living in a client-side report tool, and AS's holdback heuristics in an API route [LFD §4]. This file consolidates them as reviewable code — and is the spec seed for a future native server-side policy engine [LFD §7.4].

### 5.1 Schema

```yaml
# .fs/triage/policy.yaml
schema: fs-triage-policy/v1
rules: # evaluated in order; first match sets, later rules skip set findings
  - name: unreachable-not-affected # ported: fs-report band rule + server auto-triage
    when: { reachability: unreachable, vuln_in_dataset: true }
    set:
      {
        status: NOT_AFFECTED,
        justification: CODE_NOT_REACHABLE,
        pin: exact_version,
        reason: "Unreachable per binary reachability analysis: {factors}",
      }
  - name: critical-band-in-triage # ported: fs-report CRITICAL band rule
    when: { band: CRITICAL }
    set:
      {
        status: IN_TRIAGE,
        reason: "Critical band — queued for exploitability review",
      }
holdback: # never auto-set; always routed to a human (ported: AS auto-triage holds)
  - { kev: true } # KEV always held
  - { set_status: NOT_AFFECTED, justification: null } # NOT_AFFECTED without justification: invalid, hold
options:
  overwrite_existing: false # never touch findings with an existing local or server decision
```

`when` selectors compile to SQL over the cache: `reachability` (sign of `reachability_score`), `vuln_in_dataset`, `band` (severity/risk banding as computed by fs-report's prioritization), `kev`, `epss_gte`, `severity`, `component`, `finding_type`, `cwe`. `set` fields are the decision tuple + `pin`; `reason` supports `{factors}` / `{score}` templating from the row.

**`overwrite_existing: false` is load-bearing.** The server's own auto-triage will clobber humans with `overwrite=true` [LFD §4]; ours never does — an existing decision (local or server) is skipped and counted, mirroring carry-forward's never-clobber gate [LFD §2.3].

### 5.2 How the agent applies it

`fs_triage_apply_policy` (§6.2) takes a scope (version + optional filter predicate), evaluates rules against the cache, writes YAML for matches, and returns `{written, held: [{key, rule, why}], skipped_existing, errors}`. Holdbacks are the agent's cue to reason case-by-case (with `fs_triage_set` per finding, evidence required) or escalate to the human. The SKILL.md (§6.3) teaches exactly this split: _policy for the routine, judgment for the held._

### 5.3 How a human edits it

It's a file in the repo — edit in bb, review in git like any code change. Changing policy does not retroactively rewrite existing decisions (decisions are data, policy is a generator); a policy change only affects the next apply run. The panel surfaces the active policy under a **Policy** subPath with a rendered rule list and a "dry-run against current version" button.

### 5.4 Dry-run

`bb finite-state triage apply-policy --dry-run` (and the panel's Apply-policy preview) produces the full match report — per rule: matched count, sample findings, would-write tuples, holds — **without writing YAML**. Bulk apply from the panel always shows the dry-run first; confirm proceeds to write.

---

## 6. bb integration

This section is the heart of the surface. Extension points per the bb Plugin Build Guide; conventions per SPEC 00 §8.

### 6.1 Nav panel + subPath routing

```ts
app.slots.navPanel({
  id: "findings",
  title: "Findings",
  icon: "ShieldAlert",
  path: "findings",
  component: FindingsPanel,
  headerContent: FindingsHeaderChips,
}); // sync chip + local-changes chip
```

| subPath            | Screen                               |
| ------------------ | ------------------------------------ |
| _(root)_           | table, default saved view            |
| `f/<stableKey>`    | table + detail pane for that finding |
| `view/<savedView>` | table with saved view applied        |
| `policy`           | policy file viewer + dry-run         |
| `import`           | vendor VEX import + match report     |

Internal navigation via `useBbNavigate().toPluginPanel("findings", { subPath })` — browser back/forward walks panel history. The review/push surface is **not** duplicated here: the header chip and all "Review & push" affordances route to SPEC 01's sync panel (`/plugins/finite-state/sync`), pre-filtered to `vexDecision`.

### 6.2 Agent tools

Registered via `bb.agents.registerTool`, bridged into the agent runtime automatically. **Read tools are free; write tools mutate local YAML only. There is no push tool** (SPEC 00 §8, SPEC 01 §8).

```ts
bb.agents.registerTool({
  name: "fs_findings_query", // READ — SQLite cache, never remote
  description:
    "Query cached findings. Filters: version, component, cve, severity, reachability, kev, epss_gte, triage, finding_type, limit/cursor.",
  input: findingsQuerySchema, // zod; paged output { items, total, cursor }
  run: ({ input }) => queryCache(db, input),
});

bb.agents.registerTool({
  name: "fs_triage_set", // WRITE — YAML only
  description:
    "Write one VEX decision to the local overlay (.fs/triage). Requires justification when status=NOT_AFFECTED, and evidence. Never contacts the server.",
  input: z.object({
    stableKey: stableKeySchema, // resolved against cache; error if orphaned
    status: vexStatus,
    justification: vexJustification.nullable(),
    response: vexResponse.nullable(),
    reason: z.string().min(10),
    pin: z.enum(["exact_version", "any_version"]).optional(), // defaulted/forced per §4.4
    evidence: z.string(),
  }),
  run: writeOverlayDecision, // CAS file write; validates vocab + CDX rules; stamps provenance by:"bb-agent"
});

bb.agents.registerTool({
  name: "fs_triage_apply_policy", // WRITE — YAML only, via policy engine (§5)
  input: z.object({
    version: z.string(),
    filter: findingsFilterSchema.optional(),
    dryRun: z.boolean().default(false),
  }),
  run: applyPolicy, // returns {written, held[], skipped_existing, errors}
});
```

`fs_triage_set` enforces at the tool boundary everything the API doesn't: vocabulary validity, NOT_AFFECTED ⇒ justification, CODE_NOT_REACHABLE ⇒ `pin: exact_version`, evidence required. Also available to the agent: SPEC 01's `fs_sync_status` and `fs_sync_plan` (read-only), so it can check its own work before asking the human to push.

### 6.3 SKILL.md — `skills/triage/SKILL.md` (content outline)

1. **When to use this surface** — any request touching vulnerabilities, findings, CVEs, VEX, triage, "false positive," reachability.
2. **The iron rule** — you write intent to `.fs/triage/**` YAML (via `fs_triage_set` / `fs_triage_apply_policy` or direct file edits); you never call a mutating API; a human pushes. Check your work with `fs_sync_plan`.
3. **The stable key** — decisions key on (project, component, CVE), never on finding uuids; how to construct it from an `fs_findings_query` row; pin semantics and the CODE_NOT_REACHABLE rule.
4. **The vocabulary** — the 6/9/5 VEX enums with one-line usage guidance; NOT_AFFECTED requires a justification; reasons must cite evidence.
5. **Policy first, judgment second** — run `fs_triage_apply_policy` for routine cases; reason individually about holdbacks (KEV especially); never set `overwrite_existing`.
6. **Show, don't tell** — emit `::fs-finding{id="…"}` when discussing a specific finding; `::fs-triage-summary{id="…"}` after a bulk run; mention CVEs as `#CVE-…` so they resolve to live context.
7. **Review etiquette** — after writing decisions, summarize (counts, holds, notable calls), point the human at the diff and the plan, and stop. Never claim decisions are "applied" — they're proposed until pushed.

### 6.4 Directives

- **`::fs-finding{id="acme-router|pkg:generic/busybox@1.36.1|CVE-2023-42364"}`** — mounts `<FindingCard>` inline in the assistant message. Self-fetches by stable key via RPC (attributes are untrusted strings — fetch by id, never render payloads); renders the §3.3 decision block compactly; click-through to `toPluginPanel("findings", { subPath: "f/<id>" })`. Also accepts `cve=` + `purl=` attribute form.
- **`::fs-triage-summary{id="tr-…"}`** (optional `version=` scoping attribute) — the Flow B card: written/held/conflict counts, holdback list, buttons for _View diff_ and _Open plan_. Fetches the run record via RPC (`triage_runs` table row written by the policy engine), so it stays live if the human edits the YAML afterward. Primary attribute is always `id`, per SPEC 06 §2.5.

Unknown/crashing directives degrade to literal text per the host contract — both directives must render sensibly from a cold cache (show the id + a "pull to load" hint).

### 6.5 Mention provider

```ts
bb.ui.registerMentionProvider({
  id: "fs-intel",
  label: "Intelligence",
  triggers: ["#"], // ONE `#` provider, shared with SPEC 04
  search: (q) => searchIntelCache(q), // one ranked search: CVE/GHSA ids, component names/purls,
  // MPNs/ref-des — cache-only, <2s box
  resolve: (id) => renderIntelContext(id), // routes internally by pattern: CVE-/GHSA- → finding
  // context; purl/name → component; MPN/ref-des → part
});
```

This is the single consolidated `#` provider for the whole plugin (SPEC 06 §2.3/§2.6 ⚑3): SPEC 04's component/part corpus registers into it rather than adding a second provider on the same trigger — one registration, one dedup point. `#CVE-2023-42364` in the composer resolves **at send time** to fresh cached context: the finding rows (all components affected in the active version), scores, reachability factors, current server VEX, local overlay state. This is what makes "why did we mark #CVE-2023-42364 not affected?" a one-line question with a grounded answer.

### 6.6 CLI verbs

Under the single SPEC 00 top-level command; discoverable by agents through bb's auto-generated plugin-commands skill; all output `--json`-capable and paged (1 MiB cap):

```
# the four sync verbs — canonical form is verb-first at top level (SPEC 00 §9)
bb finite-state pull   triage [--version <v>]   # refresh cache + bases; run re-attach (Flow D); drift report
bb finite-state status triage                   # local / upstream / conflicts / orphans / stale / needs-completion
bb finite-state plan   triage                   # SPEC 01 plan, scoped to vexDecision
bb finite-state push   triage                  # validate + hand off to review panel; never applies

bb finite-state triage                          # surface group — domain verbs
  list [--filter …] [--json]         # query the cache (CLI twin of fs_findings_query)
  set <stableKey> --status … [--justification …] [--reason …] [--pin …]   # single YAML write
  apply-policy [--filter …] [--dry-run]
  import-vex <file> --vendor <name> [--overwrite]
  orphans [--prune]                  # list / clean orphaned decisions (§8.2)
  pull | status | plan | push        # scoped aliases; push is the same non-mutating panel handoff
```

The four sync verbs are **verb-first at top level** (SPEC 00 §9, SPEC 06 §2.4) — deliberately git/Terraform-shaped. The `triage`-scoped forms are retained as documented aliases with no behavior difference. In v1 both `push` spellings are non-mutating review-panel handoffs; only the panel can apply or resolve conflicts.

### 6.7 Realtime progress

Per SPEC 00 §5: broadcast is a hint to refetch, never a data channel. Channels:

- `fs-findings-pull` — `{pvId, page, of, phase: "fetch"|"reattach"|"done"}` → panel progress bar during pull; on `done`, panels refetch and the drift banner renders.
- `fs-triage-overlay-changed` — published by the file watcher on any `.fs/triage/**` change (human editor save, agent tool, importer) → table refetches `overlay_index` joins; this is how an agent's YAML writes appear in the panel _live_ while the run progresses.
- `fs-push-progress` — `{runId, applied, failed, of}` from the SPEC 01 apply loop → review panel + header chip. Reconcile on reconnect via `useRealtimeConnectionState()` (signals are not replayed).

### 6.8 Where the plan/review panel hooks in

The review panel is SPEC 01 §7's — this surface only feeds it well:

- `vexDecision` rows group under **VEX Triage**; each row's expansion renders `<FindingCard>` with a base/ours/theirs tuple diff (not raw YAML).
- Conflict rows carry the audit attribution line and the per-item resolution controls, with the theirs-wins default pre-selected for human server edits (Flow C).
- The blast-radius footer counts this surface's ops; >20 decisions requires confirmation; Push disabled while conflicts are unresolved.
- Post-push per-item results with retry; failures link back to the findings table rows (which remain dirty).

---

## 7. Platform API dependencies

### 7.1 Already available (build on these now)

- **Reads (direct `PlatformClient`):** named methods for projects/versions, paged findings, finding detail/activity/comments/summary, and exports. Pull pages the Platform route directly and writes one complete page per SQLite transaction.
- **Writes (direct `PlatformClient`):** the reviewed status/VEX routes represented by the vendored Platform OpenAPI and endpoint audit, including single CVE fan-out, bulk partial success, and clear operations [LFD §3.1]. The client exposes typed outcomes rather than HTTP-shaped payloads.
- **Patterns to port:** fs-report `VexApplier`'s 429 backoff and applied/skipped/failed reconciliation [LFD §3.2, §6.3]; the reviewed CDX/CSAF/OpenVEX reader algorithms for Flow E. Port these as dependency-free plugin modules; do not depend on Forge as a process or proxy.

### 7.2 Closed client operations to implement (plugin backend; S — 2–3 d)

Exact domain operations in `PlatformClient`:

```
set_finding_vex(pv_id, cve_or_uuid, status, justification=None, response=None, reason=None) -> {affected_count}
bulk_set_vex(pv_id, items[<=500]) -> {results: [{id, ok, error?}], summary}     # per-item partial success surfaced, not swallowed
listFindings(version_id, page) -> {items, total, cursor}
```

The implementation maps these operations only to reviewed Platform routes. It must not expose generic request/path/method access and must not route through Forge. The checked-in Platform API snapshot is the contract-test source; the frozen TypeScript interface is the lane boundary.

### 7.3 The former fs-report dead-path finding is superseded

The older LFD claim that `/status/set/bulk` did not exist predates the reviewed v0.3.0 contract. The verified route is `PUT /public/v0/findings/{projectVersionId}/status/set/bulk`: one path-scoped version id, heterogeneous `findings[]`, and an ordered per-item result. The bb plugin calls it directly; no Forge/fs-report wrapper is part of this transport path.

### 7.4 Asked of fs-api (tracked, not blocking — SPEC 01 §11)

1. **Expose `vexChangedAt`/`updatedAt` in `FindingV0Schema` + optional `expected: {…}` precondition on status PUTs** (reject-item on mismatch) — upgrades our three-way _detection_ to true CAS with zero client redesign. S–M (2–4 d) [LFD §7.1].
2. **`vex_source` provenance column** (`human|auto_reachability|carry_forward|vendor_vex|agent`) — today machine and human writes are indistinguishable, which is why we stamp `[bb:{run-id}]` into `vex_reason` as the only available attribution channel [LFD §7.5, §6.3].
3. **VEX-preservation exclusion in monitor reassessment** — the soft-delete → re-confirm cycle loses triage server-side [LFD §1.2]; the overlay recovers it, but the platform should stop losing it.

Nothing in this spec's build depends on 7.4; items 7.2–7.3 are the only prerequisites, and only for push (the panel + YAML flows work read-only without them).

---

## 8. Edge cases and failure modes

**8.1 Partial bulk failure.** The bulk endpoint returns per-item results inside HTTP 200 [LFD §3.1]. The apply loop consumes them item-by-item: successes advance their `sync.base` and record `pushed_at`; failures are recorded in `push_log` with the server error, stay dirty, and re-plan next run (SPEC 01 §5). A crash mid-push leaves a coherent partially-advanced state — never a corrupted one. Retry-able from the post-push results card. **Never** mimic the platform UI's hardcoded-success bug [LFD §5].

**8.2 Orphaned decisions.** Stable key resolves at no tier (component removed, or CVE id rewritten upstream). Orphans are: kept in YAML, excluded from plan, listed in `status` and the _Needs attention_ view with the component + last-known evidence. Lifecycle: auto-resurrect if a later pull re-resolves them (component returns); `orphans --prune` (or panel bulk action) deletes blocks after explicit confirmation with blast radius. Orphans older than a configurable horizon (default 180 days) get a nudge banner. Never auto-deleted — an orphan may be the only surviving record of a real decision.

**8.3 Duplicate finding rows.** Duplicates per (version, component, CVE) are legitimate and deliberate (multi-scan-source; the unique index was dropped; 48k dup groups existed in legacy data) [LFD §1.2]. The table groups them into one logical row with a `×N` badge (expandable to per-row provenance); one stable key = one decision covering all rows. Push addresses every cached uuid in bulk (precise), or falls back to the CVE-keyed single PUT whose server-side fan-out covers them anyway (`X-Affected-Count` is verified against the expected row count; mismatch logs a warning) [LFD §6.3].

**8.4 Soft-delete → re-confirm loss.** The vulnerability monitor soft-deletes findings it can't re-confirm — with **no VEX preservation** — and a later re-confirm inserts a fresh NULL-VEX row [LFD §1.2]. Detection: pull marks cached rows `is_deleted`, and a new row appearing at a stable key whose overlay says `pushed` with server NULL classifies as **`re-apply`** in the drift report (Flow D). The overlay is the recovery mechanism; the plan re-pushes the decision. This exact scenario is a scripted demo beat: _"the platform lost this decision; the workspace didn't."_

**8.5 Auto-triage clobbering.** Server auto-triage with `overwrite=true` overwrites human decisions by design, attributed via a GUC actor id [LFD §4]. From our side it's just an upstream change: three-way comparison flags every clobbered decision as a **conflict** (theirs = auto-triage tuple, ours = the human decision), with the audit line showing the auto-triage actor. The theirs-wins-on-_human_-edits default does **not** apply to recognizable auto-triage actors — default flips to ours-wins, because a reviewed human decision outranks the one-rule robot. ⚑ **Open question:** the auto-triage actor's audit identity string must be confirmed against prod before we key the default on it.

**8.6 Rate limits.** All pushes flow through the SPEC 00 token-bucket (per-org cap, shared across panels/tools/CLI). 429/5xx: exponential backoff with jitter, resume from `push_log` (pattern proven in `vex_applier.py` [LFD §6.3]). Pull pages are similarly bucketed; a pull can't starve a push (two priority classes in the bucket).

**8.7 The 39k-finding scan.** Pull: 4 pages of 10k, streamed to SQLite in a transaction per page; progress via realtime; ~seconds, not minutes. Table: virtualization handles it (perf budget: 60fps scroll at 39k, tested). Policy apply: SQL-side selection, YAML writes only for matches — bounded by decisions, not findings. Push: 39k would be 78 bulk chunks _if_ someone triaged everything; the plan's noop suppression and the ≤500 chunking make it mechanical. The 150k engineering ceiling changes none of the shapes, only durations [LFD §5].

**8.8 Incomplete decisions.** `NOT_AFFECTED` without justification (vendor import, hand-edited YAML). Never pushed: plan validation rejects with a per-item error pointing at the file/line; the _Needs attention_ view lists them. The API would accept it (validation is client-side only [LFD §2.1]) — we hold the line anyway, because exports downstream consume these fields.

**8.9 Git-level YAML conflicts.** Two branches edit the same component file. This is a git conflict, not a sync conflict — resolved in the editor like any code conflict. Mitigation by construction: one file per component and one block per CVE keeps merge granularity fine; the file watcher re-validates on save and flags malformed YAML in the panel (banner + file/line) rather than crashing the sync.

**8.10 Clearing a pushed decision.** Deleting a YAML block whose `sync.base` shows a pushed tuple ⇒ plan emits a `clear` op through the exact version-scoped bulk operation `PUT /public/v0/findings/{projectVersionId}/status/clear/bulk` with `{ "findingIds": ["<finding-id>", ...] }`. Finding IDs are decimal strings to preserve int64 precision; success is HTTP 204 with no response body. The plugin chunks and resumes clears above the narrow `PlatformClient.clearVexStatus` boundary. Clears participate in blast-radius confirmation. A block with `base` all-null just disappears (nothing was ever pushed).

**8.11 Comments.** Server comments don't carry across versions [LFD §2.3]. The reviewed v0.3.0 Platform authority exposes comments only through finding reads, so v1 caches and renders them read-only; no comment composer or mutation passthrough is exposed. The fixed 65-name RPC inventory retains `findings.comments.create|update|delete` as reserved schemas, but all three are non-executable in v1 for two independent reasons: WP-06 has no reviewed upstream mutation route (route-blocked), and bb exposes no authenticated capability mint path (authorization-blocked). No `PlatformClient` comment-mutation methods or RPC handlers may be invented. Durable reasoning belongs in `reason`/`evidence` in the overlay.

**8.12 VEX transport normalization.** The single-finding status PUT and bulk clear both succeed only on HTTP 204 and expose `Promise<void>`; no JSON success body is invented. `dryRun` is never a Platform field: preview remains the local policy/plan workflow in §5.4 and SPEC 01. Before any single or bulk set call, empty optional `response`, `justification`, or `reason` values normalize to omission, and finding ids are validated as decimal strings. Bulk set alone returns the documented ordered per-item result envelope.

---

## 9. Success metrics

| Metric                                                                                          | Target                                                                        | How measured                                                                                       |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Time to triage 100 routine findings** (unreachable/policy-matched), including human review    | **< 5 min** (vs ~1–2 hr in the web UI)                                        | scripted benchmark on the 9,507-row fixture; wall clock from ask → pushed                          |
| **Time to triage 1 finding manually** (list → decision committed)                               | < 15 s median                                                                 | panel telemetry (local, opt-in)                                                                    |
| **% decisions surviving a version bump** (re-attached or correctly staled, zero silent losses)  | **> 99%**, vs server carry-forward baseline measured on the same fixture pair | drift-report accounting: re-attached + re-apply + stale + orphaned = 100% of decisions; "lost" = 0 |
| **Recovery of server-lost triage** (soft-delete/re-confirm, carry-forward failure)              | 100% of recoverable keys surface as `re-apply`                                | seeded loss-path fixture                                                                           |
| **Silent clobbers** (our push overwrote an unseen server change without a conflict being shown) | **0**                                                                         | audit-log reconciliation test: every push either matched base or went through conflict UX          |
| **Redundant writes** (re-PUT of an identical tuple)                                             | 0 — noops always skipped                                                      | push_log audit vs server audit_events                                                              |
| **Panel performance**                                                                           | first paint < 200ms from warm cache; 60fps scroll at 10k rows; usable at 39k  | perf harness, per SPEC 00 §10                                                                      |
| **Bulk-push integrity**                                                                         | a killed push resumes with no duplicate or lost items                         | chaos test on the 500-chunk loop                                                                   |
| **Keyboard coverage**                                                                           | full Flow A with zero pointer use                                             | scripted test                                                                                      |
| **The demo**                                                                                    | Flow B end-to-end (ask → diff → plan → push) offline from warm cache, < 4 min | the SPEC 00 §12 scripted demo path                                                                 |

---

## 10. Build plan

Sequencing follows direct Platform client → plugin core → policy → hardening and overlaps the SPEC 01 engine build, which is proven on VEX first (SPEC 01 §10). Estimates assume one strong engineer plus the SPEC 00 Phase-1 skeleton (remote clients, SQLite, RPC, theme) in place.

| Phase                               | Deliverable                  | Contents                                                                                                                                                                                                                                                                  | Effort                                                                                                      |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **2a — Read**                       | Findings panel, read-only    | `findings` cache table + pull (paged, realtime progress); virtualized table + filters + saved views; detail pane (`<FindingCard>`); `#CVE` mention provider; `triage pull/list/status` CLI (status read-only); four states                                                | **4–5 d**                                                                                                   |
| **2b — Decide locally**             | Manual triage, YAML overlay  | overlay schema + CAS writes + file watcher + `overlay_index`; stable-key module + tier ladder + pin rules; keyboard triage (full §3.6 map); bulk select/decide; local-change indicators; `triage set` CLI                                                                 | **4–5 d**                                                                                                   |
| **2c — Push**                       | Plan/push via SPEC 01 engine | direct `PlatformClient` operations (7.2); classify noop/create/update/conflict/orphan; bulk apply (bounded chunks, partial success, resumability, provenance stamp); conflict UX incl. audit attribution + theirs-wins default; review-panel integration; `plan/push` CLI | **5–6 d**                                                                                                   |
| **2d — Agent**                      | The money flow               | `fs_findings_query` / `fs_triage_set` / `fs_triage_apply_policy`; policy engine + shipped policy file + dry-run; `::fs-finding` + `::fs-triage-summary` directives; SKILL.md; `apply-policy` CLI; "Ask agent to triage" panel action                                      | **4–5 d**                                                                                                   |
| **2e — Drift + import + hardening** | Flows D and E, edge cases    | re-attach on pull + drift report + stale/orphan lifecycle; vendor VEX import (readers reuse, no fabricated fields, match report); loss-path fixtures (8.4) + chaos tests (8.1) + 39k perf pass; scripted demo                                                             | **4–5 d**                                                                                                   |
| **Total**                           |                              |                                                                                                                                                                                                                                                                           | **~4.5 weeks** plugin-side (concurrent with SPEC 01's 3.5–4.5 wk engine work, which this surface exercises) |

Demoable milestones: end of 2a — the fast table (already better than the web UI for reading); end of 2b — Flow A; end of 2c — Flow A pushed end-to-end with conflicts; end of 2d — **Flow B, the flagship demo**; end of 2e — the full loss-recovery story.

---

## Open questions

1. **Auto-triage actor identity** (8.5) — confirm the audit actor string for server auto-triage in prod so conflict defaults can key on machine-vs-human authorship reliably. Until then, all conflicts default theirs-wins with manual override.
2. **Band computation** (§5.1) — fs-report's CRITICAL band derives from its prioritization transform. Recompute locally from cached scores (preferred: pure function of severity/EPSS/KEV/reachability, documented in the policy schema) or import fs-report's banding verbatim? Decide in 2d; the rule schema is stable either way.
3. **Stable-key serialization in URLs/directives** — the `project|purl|CVE` string (§6.4) contains characters needing escaping in subPaths. Proposal: base64url-encode in routes, human-readable form in YAML/CLI. Confirm in 2a before the detail route ships.
4. **SAST/config findings** (`finding_type != cve`) — they have no CVE; their `finding_id` is the STP class id (`FS-XXX-NNNN`) with content-hash instance identity [LFD §1.3]. v1 scopes keyboard/policy triage to CVE-type findings and renders others read-only. ⚑ Follow-up spec section needed before GA for STP-native finding triage keys.
5. **Multi-version overlays** — one overlay tree currently serves the project across versions (by design — decisions re-attach). Branch-per-product-line repos with divergent triage need a convention (`.fs/triage/<project>@<branch>/`?). Defer until a real customer shape demands it.
6. **Findings-page size and cursor contract** (7.2) — pin the reviewed Platform behavior in contract tests and keep paging details inside `PlatformClient`; never materialize a server-local path.
