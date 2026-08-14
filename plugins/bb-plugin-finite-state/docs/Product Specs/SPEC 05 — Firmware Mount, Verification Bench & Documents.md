# SPEC 05 — Firmware Mount, Verification Bench & Documents

_Product spec. Depends on SPEC 00 (conventions, plugin skeleton, direct remote clients, optional Forge compute, four data classes) and SPEC 01 (sync engine — everything editable here rides on it). Consumes SPEC 03 (the requirement × tier matrix that the bench proves) and feeds SPEC 04 (HBOM extraction). Grounding docs: `bb Feature Designs — Firmware FS, EARS Conversion, HBOM.md` §Feature 1, `Verification Bench — Technical Design & Toolchain Evaluation.md`, `Shortest Path — The Finite State Plugin for bb.md`, `bb Plugin Build Guide — The Finite State Panels.md`. Owner: Matt Wyckhouse. Status: ready for implementation._

**Spec set:** 00 Foundation · 01 Sync Engine · 02 Findings & VEX Triage · 03 Product Security (TARA/Requirements/Verifications) · 04 Bill of Materials (SBOM/HBOM) · **05 Firmware Mount, Bench & Documents (this)** · 06 Agentic Surfaces

**Scope:** three related surfaces that share one substrate.

1. **The Firmware Mount** — not a panel. It is bb's _native file tree_, populated directly from Platform firmware APIs or a local unpack, sitting in the worktree next to the source code and the `product-security/` model. The human browses it; the agent greps it with native Read/Grep/Edit; optional Forge compute reads the identical fully materialized bytes only for QEMU/pen-test jobs.
2. **The Verification Bench** — the panel where firmware is _proven_ (before and after hardware exists) and the proof is emitted as signed evidence. The single most demo-important artifact in the whole product — the **"safe-to-OTA" verdict card** — lives here.
3. **Documents** — datasheets, register maps, and specs as first-class context for both humans and agents, and the fuel for HBOM extraction (SPEC 04) and requirements grounding (SPEC 03).

They belong in one spec because they are one chain: **the mount is the bytes, the bench proves the bytes, and the documents describe the bytes** — and all three converge on the evidence graph anchored to a single firmware digest.

---

# PART A — THE FIRMWARE MOUNT

## A1. The job to be done

**The user:** the firmware engineer and the product security engineer, working a connected product in bb.

**What's painful today.** The firmware filesystem lives inside a scanner (STP/ArangoDB, keyed by `fsan_id` + `sha256`). To answer _"is there a hardcoded credential in `/etc`?"_ or _"which binary opens port 443?"_ the engineer leaves bb, drives a web UI, and copy-pastes findings back. The agent — the one that should do the bulk of that grepping — has no reach into the firmware at all: plugin panels have no path to hand files to an agent session (Build Guide §4, "MCP: the honest picture").

**What this surface makes possible:**

1. **Browse and grep the firmware alongside source.** The extracted rootfs is materialized as _real files_ under a reserved worktree subdir (`.fs-firmware/<pv_id>/rootfs/`). Because it is in the worktree, bb's native file tree renders it and the agent's native `Grep`/`Glob`/`Read` reach it with zero extra wiring. _This is the whole point_ — a custom RPC-backed file browser (SPEC 00 anti-pattern) would rebuild a worse version of bb's own tree and would starve the agent.
2. **One filesystem, three consumers, zero translation.** The same materialized bytes serve the human (file tree), the agent (native tools), and—when configured—the Forge pen-test/QEMU compute lane. The path seal, ELF-closure staging, and artifact hashing Forge performs all operate on exactly the bytes the user is looking at.
3. **Correctness by construction.** The platform's extraction _is_ the coordinate system every other artifact references — STP findings, SBOM component→file mappings, reachability results, and the AI assessor's citations all point at paths and `file_hash` values recorded during _that_ unpack run. Pulling the platform's own extraction (rather than re-unpacking locally) guarantees the findings↔files↔evidence join is exact. For an evidence product, that alignment is worth more than the download time.

This is the mount that SPEC 03 §2.4 links into ("node → files in the firmware mount"), that SPEC 03 §3.4 traces to ("commit that implemented it"), and that Part B proves.

## A2. The materialization design — an API-first, content-addressed cache

Structure the materialization as a proper content-addressed cache that can be hash-sealed before an optional compute handoff. It is **CACHED** in the SPEC 01 sense (a local projection, never the source of truth, rebuildable from a fresh pull) — but it lives on disk as files, not SQLite rows, because the file tree and the agent read files.

```
<worktree>/.fs-firmware/<pv_id>/
├── rootfs/…                 # the browsable tree — hardlinks into blobs/ once hydrated
├── blobs/<sha256>           # content-addressed bytes, deduped across files and versions
└── manifest.sqlite          # every node: path, file_hash, size, mime, mode, materialized flag, provenance
```

**Why content-addressing, beyond disk savings:** the first pull is the only slow one. Blobs are keyed by `sha256`, so a second firmware version re-uses every unchanged file and downloads only the delta — a point release is a few dozen files, not twenty thousand. The same property makes the manifest diff between two versions a **free version-comparison view** (A4).

### A2.1 The manifest (`manifest.sqlite`, one per `pv_id`)

Not the plugin's shared `data.db` — a sidecar next to the rootfs, so a mount is self-describing and portable. (bb KV is out: it caps at 256 KB/value, useless for a 20k-node index.)

```sql
-- .fs-firmware/<pv_id>/manifest.sqlite

CREATE TABLE fs_meta (              -- provenance: gaps must be VISIBLE, not silent
  key   TEXT PRIMARY KEY,
  value TEXT
);  -- keys: pv_id, scan_id, input_sha256, source, artifact_hash, admin_bytes_ok,
    --       materialized_at, node_count, hydrated_count, unpack_errors (JSON array)

CREATE TABLE fs_node (
  path           TEXT PRIMARY KEY,  -- virtual path, e.g. /usr/sbin/httpd
  file_hash      TEXT,              -- SHA-256; NULL for dirs and symlinks
  size           INTEGER,
  mime_type      TEXT,
  full_type      TEXT,              -- STP's richer type string (v2 search)
  unix_mode      INTEGER,
  unix_mode_octal TEXT,
  is_setuid      INTEGER NOT NULL DEFAULT 0,
  is_setgid      INTEGER NOT NULL DEFAULT 0,
  unix_uid       INTEGER, unix_gid INTEGER,
  symlink_target TEXT,              -- for symlinks
  has_children   INTEGER NOT NULL DEFAULT 0,
  materialized   INTEGER NOT NULL DEFAULT 0,  -- 0 = placeholder, 1 = bytes on disk
  errors         TEXT               -- per-node unpack errors[] from STP/snapshot.json
);
CREATE INDEX fs_node_hash ON fs_node(file_hash);
CREATE INDEX fs_node_mat  ON fs_node(materialized);
```

**Provenance is not optional.** `fs_meta.source` records how we got here (`api` | `standalone_unpack`), `scan_id` and `input_sha256` pin the exact scan, and `unpack_errors` (plus per-node `fs_node.errors`) carry the extractor's own gap list forward. When STP failed to unpack a nested archive, that shows up as an error row and a truncated subtree — **the user sees the gap; the mount never pretends completeness it doesn't have.**

### A2.2 Two paths to the mount

**Direct Platform path — canonical metadata and selective hydration.** For already-scanned firmware, pull the platform's unpack coordinate system through named `PlatformClient` methods. This is the default browse/preview path, but not an unbounded per-file whole-root download strategy:

1. **Manifest sync (cheap, always first).** Recurse `PlatformClient.browseFirmwareFilesystem` using the verified tree/overview contract and depth limit. If the Platform later exposes a reviewed flat-search route, add it as a named frozen method; do not emulate one through a generic request. Write the directory skeleton + **zero-byte placeholder files** into `rootfs/` and one `fs_node` row per node. The human gets a fully browsable tree without pulling file bytes.
2. **Lazy content hydration.** When a file is opened (human click, or the agent Reads it), call `PlatformClient.getFirmwareFile` in `full` mode and stream its `RemoteArtifact` into `.fs-firmware/<pv_id>/blobs/<sha256>`, then hardlink the blob into `rootfs/<path>` and flip `materialized=1`. Small files (≤128 KiB) can use `range`; larger files stream without entering RPC or being wholly buffered. Content is keyed by `file_hash`, so identical blobs dedupe.
3. **Bounded hydration only.** Explicit file/closure hydration uses bounded workers and is resumable. Reject an unbounded whole-root per-file request; direct the user to local unpack until a reviewed Platform tarball exists.

**Complete-image path — local unpack.** When whole-root bytes are required, run STP's `services/unpack/standalone_unpack.py` (78 FACT plugins, no infrastructure required) inside the unpack Docker container. It extracts the tree and emits `snapshot.json { input_file, input_sha256, file_tree[], unpack_metadata, errors[] }`, which we ingest directly into the manifest (`source="standalone_unpack"`). Use it for active-development images, offline/air-gapped work, non-admin tenants, or any Tier-1 run that needs a complete root before a Platform tarball exists.

```ts
// lanes/firmware/materialize.ts — abbreviated; backend only
async function materialize(pvId: string, scanId?: string): Promise<void> {
  const queue = ["/"];
  while (queue.length) {
    const path = queue.shift()!;
    const page = await platform.browseFirmwareFilesystem({
      projectVersionId: pvId,
      scanId,
      path,
      depth: 1,
    });
    await persistNodesAndPlaceholders(page); // validates containment before every write
    queue.push(...childDirectories(page));
    bb.realtime.publish("fs-firmware-progress", progressSnapshot());
  }
}
```

## A3. The optional Forge compute handshake — one path, three readers

This is the load-bearing integration. Forge **never unpacks and never fetches** — `resolve_firmware_root(pv_id)` resolves `FORGE_QEMU_FIRMWARE_<PV_ID>` (or a hard-coded demo map) to a directory and reads it directly: `pentest/target_staging.py` carves the ELF closure off disk, `pentest/factory.py` enforces `_under_firmware_root()` containment and builds `build_firmware_path_seal()`, `qemu_dynamic.py` computes `_firmware_artifact_hash(firmware_root)` over the tree. `pentest/dispatch.py` and `preauth.py` fail fast on anything that is not the unpacked rootfs directory.

**So the handshake is: materialize into the worktree, then register that path with Forge.** After that, all three consumers read identical, hash-verified bytes:

| Consumer                         | Reaches the rootfs via                                  |
| -------------------------------- | ------------------------------------------------------- |
| **The human**                    | bb's native file tree (it's in the worktree)            |
| **The agent**                    | Claude Code's native `Grep`/`Glob`/`Read` (same reason) |
| **Forge's pen-test / QEMU lane** | `FORGE_QEMU_FIRMWARE_<pv_id>` → that same directory     |

**How the plugin prepares compute.** `prepareFirmwareRoot` is a reserved, non-freezeable boundary—not a verified Forge MCP method at pinned commit `5083a9d7`. It does not expose a generic Forge tool. WP-50 may close it in one of two deployment-honest ways; until then the remote client reports unsupported and WP-06 cannot freeze that member:

- **Demo appliance (today):** Forge is launched on the same host; inject `FORGE_QEMU_FIRMWARE_<pv_id>=<abs path to rootfs>` (and `FORGE_QEMU_BUNDLE_<pv_id>` when an evidence bundle exists) at Forge spawn/restart. The docstring confirms the env var exists "to register another pv_id without editing this module."
- **Productization (small backend ask, X15):** a narrowly scoped Forge runtime method registers a root plus expected digest without restart. The plugin maps only that method to `prepareFirmwareRoot`; remote Forge returns an explicit unsupported capability until a safe byte/root contract exists.

**The ordering constraint (non-negotiable).** Forge's compute lane has **no fetch fallback** — a lazily-hydrated tree with placeholder files fails opaquely _inside_ the verifier. Therefore, before dispatching any Part B pen-test/QEMU run, the plugin **must fully materialize the target's bytes first**: at minimum the target binary's ELF closure, in practice the whole rootfs (a bulk hydrate). The `fs_bench_run` handler and the panel Run button both assert `materialized=1` for the target path(s), verify the digest, and trigger a blocking bulk hydrate — with progress — before dispatch. Core firmware browsing and hydration do not require Forge.

## A4. UX

**The pull is a background job with progress.** `materializeFirmware({ pvId, scanId? })` runs under `bb.background.service` / a job, publishing `fs-firmware-progress` `{ pvId, phase, done, total }`. The panel header for the active project shows a **status chip**:

```
◍ Firmware: AX3000 v2.4  ·  20,418 files  ·  312 hydrated  ·  [Materialize full image…]  [Refresh manifest]
```

Chip states: `not materialized` (offer Pull) · `manifest ready` (browsable, bytes lazy) · `hydrating N/M` (progress) · `fully hydrated` · `stale` (A5.5) · `metadata-only` (admin gate, A5.1).

**Pre-warm from the CLI.** `bb finite-state firmware pull <pv_id> [--scan <id>]` pulls the direct Platform manifest and bounded selected bytes. `--full --image <path>` uses the local complete-image path; `--full` without a local image is rejected until a reviewed Platform tarball exists. Pre-warm before a demo so nothing is fetched live on stage.

**The `fileOpener` for binaries — a metadata card, not raw bytes.** Register `app.slots.fileOpener` for extensionless / ELF / `.bin` firmware artifacts. Opening one renders a card, never a text editor full of `^@^@`:

```
┌─ /usr/sbin/httpd ─────────────────────────────── [Reveal in tree] [Analyze ▸] ┐
│ ELF 32-bit LSB executable · ARM · dynamically linked · stripped               │
│ size 412 KB · sha256 9c2f…d4f1 · mode 0755 · uid 0                            │
│ Security   NX ✓   PIE ✗   RELRO partial   Stack-canary ✗   ASLR n/a          │  ← color+label
│ Symbols    imports 214 · exports 0 · (from binary_file_details)               │
│ Hex        00000000  7f 45 4c 46 01 01 01 00  00 00 00 00 00 00 00 00  |.ELF..│  ← first 256B
└───────────────────────────────────────────────────────────────────────────────┘
```

`security_features` (NX/PIE/RELRO/stack-canary) come from `browse_firmware_filesystem` overview + `binary_file_details`; the hex preview from `get_firmware_file` `mode="range"` (first 256 bytes). "Analyze ▸" offers "Run Tier-0 static" / "Stage in bench" (Part B). Severity-style features render as color **plus** label (SPEC 00 §7), never color alone.

**Version-diff view (free from content-addressing).** `bb finite-state firmware diff <pv_a> <pv_b>` (and a panel entry point) compares two manifests:

```
AX3000 v2.3 → v2.4
  + added     /usr/lib/libcrypto.so.3           (new)
  ~ changed   /usr/sbin/httpd    9c2f…d4f1 → 7a10…be44   size +12 KB   RELRO partial → full ✓
  ~ changed   /etc/config/wireless  (config)
  - removed   /usr/bin/telnetd                  ✓ (attack surface reduced)
  = 20,331 unchanged (blobs re-used, 0 bytes downloaded)
```

"Changed" = same path, different `file_hash`; click a changed binary → a side-by-side of the two metadata cards (arch match? security features regressed? size delta?). This is exactly the "deviation detection across versions" the Deep Wiki concept wants, and it costs nothing beyond the manifest we already hold.

## A5. Edge cases

**A5.1 Admin permission gate on bytes.** Metadata/tree needs only findings-read; **file bytes require the org-admin `VIEW_ANY_PROJECT_FILE` permission.** In a non-admin tenant the manifest materializes fine but direct Platform hydration returns a typed 403. Set `fs_meta.admin_bytes_ok = 0`, render placeholders with a **"metadata-only (needs elevated permission)"** chip, and offer the `standalone_unpack.py` fallback if we hold the image. This is a product/positioning fact stated in UI copy, **not a bug**.

**A5.2 Rate limits.** At the documented ~60 req/min per-org proxy cap, a 20k-file full hydrate is minutes-to-hours, not seconds. Mitigations: (1) we own the limit — raise/exempt it for our own tenant; (2) throttle the bulk worker pool to ~1 req/sec/worker, few workers; (3) metadata-first browsing hides the latency for the common case; (4) pre-warm before demos. The real fix is the `/filesystem/export` tarball endpoint (X15) — **the highest-leverage backend item in this plan**, collapsing hours to minutes and a real customer feature.

**A5.3 20k+ file trees.** Metadata-first means the tree is always browsable regardless of size; bytes are pulled only for touched files. Never auto-hydrate all bytes on sync. In v1, recurse only through the frozen `PlatformClient.browseFirmwareFilesystem` tree contract with bounded depth and resumable subtrees; the `manifest.sqlite` is the local paging index. `v2/file_tree_search` is not in the vendored closed Platform interface and is therefore unavailable, not a callable production route. If a reviewed flat-search endpoint is added later, expose it only as a named contract amendment.

**A5.4 Worktree pollution / gitignore.** Tens of thousands of files must never appear in a commit or a thread diff. Reserve `.fs-firmware/` and add it to the worktree `.gitignore` (or the environment's ignore set). **Verify bb's diff engine honors the ignore with a 10k-file mount** (Feature Designs §1d risk 3 — test it, don't assume). Blobs are deduped and hardlinked, so the on-disk cost is content, not path count.

**A5.5 Staleness detection.** Pin `scan_id` (canonical binary scan) and the direct Platform response's verified artifact hash, when present, in `fs_meta`. On re-open, if the version's latest scan id or artifact hash changed, mark the mount stale, publish `fs-firmware-stale` `{ pvId }`, and offer **re-materialize (changed blobs only)**. If the reviewed Platform contract does not expose an artifact hash, fall back honestly to scan-id comparison; do not depend on Forge to echo a Platform header.

**A5.6 Path safety.** STP paths are attacker-influenced firmware paths (odd bytes, `..`, symlinks escaping the rootfs). Do **not** hand-roll path joins — every write anchors under `.fs-firmware/<pv_id>/` via bb's `rootPath` confinement (`bb.sdk.files`), which enforces containment the way Forge's own `_under_firmware_root()` does server-side.

---

# PART B — THE VERIFICATION BENCH

## B6. The job to be done

**The user:** the product security engineer, the firmware engineer, and — for Eagle specifically — the person who has to sign off that an AI-generated/AI-assisted firmware build is safe to ship _before_ the hardware exists and _again_ after it does.

**What this makes possible:** prove firmware across a tiered ladder and emit **signed evidence** that maps 1:1 to the Assurance Studio requirement IDs (SPEC 03). Every tier's runner produces an in-toto/SLSA attestation whose _subject_ is the firmware digest and whose _predicate_ carries the requirement IDs exercised, pass/fail, coverage, and measured values. The result is a verifiable evidence graph — "commit SHA → signed static analysis → signed rehosted pen-test → signed HIL measurements → countersigned lab report" — all anchored to the threat model. **That evidence graph is the certification/compliance deliverable and the differentiated product story.**

The bench is where SPEC 03 §4.2 promised the verdict card ("for bench-tier runs, the SPEC 05 verdict card"). This part defines it.

## B7. The tiered model — what runs when

Design principle (from the Verification Bench design §5): **fast feedback on every commit, deeper checks nightly, hardware on merge/nightly, lab on milestones — and every tier emits signed evidence mapped to a requirement ID.** You do **not** need full-system SoC emulation to get 80% of the value; you will never emulate PHY/RF/baseband (physics and law), so don't spend a dollar trying.

| Tier                            | Cadence                                    | Runs                                                                                                                                                                                                                                                                                          | Forge/tooling                                                                                                                              | Evidence                                                                                                 |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Tier 0 — Static/binary**      | per commit (secs–2 min), no emulation boot | SBOM, known-CVE, secrets, memory-safety smells, **AI-injection/hallucination diffs** on changed binaries; per-binary/per-function harnessing (Qiling/Unicorn)                                                                                                                                 | FS core binary analysis; maps to `config_check`/`sbom_query`/`binary_analysis`/`binary_pattern`/`vuln_absence` → SPEC 03 **static** column | signed static-analysis + SBOM attestation                                                                |
| **Tier 1 — Rehosted image**     | per commit / per PR (2–10 min)             | Automated rehosting (FirmAE/EMBA lineage, fed by FS unpacker) boots the Linux twin; **Forge `verify_dynamic` (QEMU rehost) + `pen_test_run` two-agent pen-test**; AFL++ short fuzz on network services/parsers; LLM repair agent diagnoses boot failures, un-repairable → flags **needs-HIL** | `verify_dynamic`, `pen_test_run`, 10 STP relay tools; **requires the full mount materialized first (A3 ordering constraint)**              | signed rehosting + Forge run attestation with coverage + verifier results → SPEC 03 **emulation** column |
| **Tier 2 — Deterministic/deep** | nightly (10 min–hrs)                       | Renode deterministic golden-path regressions: boot chain, **secure-boot accept/reject**, Verilator-co-simulated custom IP; extended LibAFL; differential AI-vs-reference logic; optional Corellium high-fidelity twin                                                                         | Renode `.repl`/`.resc` on the bench host; byte-identical signable regressions                                                              | signed regression + long-fuzz attestations; diff vs last green                                           |
| **Tier 3 — HIL**                | on-merge / nightly-on-hardware (hrs)       | Labgrid + pytest drive the real board: real boot, secure-boot with real fuses, sleep-current/power profile, physical-interface robustness, Wi-Fi/cellular functional bring-up, `tc netem` resilience; Avatar2 bridges emulator↔board for un-modeled peripherals                               | the **HIL rack, enrolled as a bb host** (B9); results write back via `external_sync` → SPEC 03 **HIL** column                              | signed HIL run with **measured values** (OpenHTF-style) tied to requirement IDs                          |
| **Tier 4 — Chamber/lab**        | milestone/release (days, external)         | RF conformance (shield box + LitePoint/R&S), cellular carrier acceptance (accredited lab, PTCRB/GCF), thermal/environmental                                                                                                                                                                   | external lab; reports ingested + countersigned                                                                                             | lab reports ingested and **countersigned** into the evidence chain                                       |

Un-repairable Tier-1 failures draw a **needs-HIL** arrow to Tier 3; un-modeled peripherals draw an Avatar2 bridge from Tier 1/2 to a Tier-3 board. The tier taxonomy is _the same_ `static | emulation | hil | manual` axis SPEC 03 §4.1 uses for its matrix columns — one vocabulary, two surfaces; the five run tiers map onto those four columns per the B10 mapping table.

## B8. Panel design

`navPanel` **"Bench"** (`icon: "FlaskConical"`, `path: "bench"`), subPath-routed. States designed per SPEC 00 §7: loading = skeleton timeline; empty = "No bench runs yet — run Tier 0 on the current firmware, or `bb finite-state bench run`"; error = what failed + retry; credential-unconfigured = `needsConfiguration`; missing optional bench tooling = a bench-scoped advisory while the plugin remains running (FS-158).

### B8.1 Runs as a timeline (landing view)

Bench runs are inherently temporal, so the landing view is a **timeline**, newest first, virtualized:

```
Bench · AX3000 v2.4  (firmware 7a10…be44)                      [Run ▾]  ◍ host: rack-01
────────────────────────────────────────────────────────────────────────────────────────
● 14:32  Tier 1  rehost + pen-test    commit a91f2   4m12s   ✓ passed   → thread ↗   ✔ signed
◐ 13:05  Tier 3  HIL power profile    merge  #218     47m     ⟳ running  → thread ↗
✗ 09:20  Tier 1  rehost + pen-test    commit 3c8e1    3m41s   ✗ 2 findings           ✔ signed
● 02:00  Tier 2  Renode secure-boot   nightly         1h02m   ✓ passed   → thread ↗   ✔ signed
```

Each row: status glyph+color, timestamp, **tier**, kind, trigger (commit/merge/nightly/manual/needs-HIL), **duration**, verdict summary, a link to the run's **bb thread** (B9), and a "signed" badge when an attestation exists. Filter bar: tier · status · trigger · firmware version · "failing only." `[Run ▾]` opens the run launcher (tier picker + optional target requirement) — a `pendingInteraction` form for parameter approval (Build Guide §2).

### B8.2 Run detail

Cell/row click → run detail (right sheet; subPath `bench/<run_id>`):

- **Config** — tier, kind, verifier set / Renode script / pytest suite, parameters, firmware digest, trigger, host.
- **Live logs** — cursor-paged RPC (`getBenchLog({ runId, afterSeq, limit })`) nudged by `fs-bench-log` realtime; large logs stream via a `bb.http` route (RPC is strict-JSON, no streaming). For host-run tiers the _native thread terminal_ is the live log (B9); this pane mirrors/links it.
- **Artifacts** — pcaps, coredumps, fuzz corpora, screenshots, reports — links served through `bb.http` proxy routes (auth stays server-side), or previewed via `bb.sdk.files.createPreview` for synced copies.
- **The signed verdict** — the run's attestation, rendered as the verdict card (B8.3).

### B8.3 The "safe-to-OTA" verdict card — the single most demo-important component

**Spec it deliberately.** This is the money artifact — the thing that makes an investor or a regulator believe the thesis. It renders as a `messageDirective` (`::fs-verdict{id}`), inside the run detail, and as `bb finite-state bench verdict <pv_id>` text. It must be **visually unmistakable** and **honest**.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║   ✅  SAFE TO OTA                                          AX3000 · v2.4       ║
║   Firmware digest  sha256:7a10be44…c091                                        ║
╠══════════════════════════════════════════════════════════════════════════════╣
║   Tier coverage                                                                ║
║     Tier 0 static      ✓ passed   (24 checks)                                  ║
║     Tier 1 emulation   ✓ passed   (Forge pen-test, 31 verifiers, 0 findings)   ║
║     Tier 2 determinism ✓ passed   (secure-boot accept/reject)                  ║
║     Tier 3 HIL         ✓ passed   (boot, sleep-current 18µA ≤ 25µA)            ║
║     Tier 4 lab         — not run  (pre-cert engineering build)                 ║
║   Requirement coverage                                                         ║
║     18 of 18 required requirements proven at their required tiers              ║
║     0 failed · 0 inconclusive · 2 requirements have optional tiers unrun       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║   Signed  keyless OIDC  ci@finitestate.io   ·   Rekor  a7f3…  [verify ↗]       ║
║   in-toto/SLSA  ·  2026-08-11T14:36:12Z     [Download DSSE envelope]           ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Verdict logic (deterministic, computed in the plugin from the cache):**

- `SAFE TO OTA` (green) iff: every **required** requirement (SPEC 03 `is_required` checks) has a `verified` latest result at each of its **required** tiers, **and** no `failed`/`error` anywhere in scope, **and** the run's `firmware_digest` equals the current materialized rootfs artifact hash (else the card carries a **stale** overlay — "verdict is for a firmware that has since changed").
- `NOT SAFE` (red) iff any required check is `failed`/`error`. The card lists the failing requirements with drill-through to the run detail.
- `INCONCLUSIVE` (amber) iff no failures but ≥1 required tier is unproven (`○ mapped, not run`, or `— no check mapped`). **Gaps are shown as gaps, never as passes** — the copy is explicit: _"Safe-to-OTA reflects the evidence that exists; unmapped or unrun tiers are gaps, not green."_

**Requirement coverage links straight back to SPEC 03's matrix.** The "N of M required requirements proven" line _is_ the SPEC 03 §4.1 requirement × tier matrix filtered to required checks; clicking it deep-links to `product-security` → `verifications` with the same filter. The verdict card and the matrix are two renderings of one truth: the matrix answers "what's unproven?" per requirement; the verdict answers "is the whole build shippable?" — and they must never disagree (both derive from the cached `verification_results` + rollup).

## B9. bb hosts — bench runs as threads (bb's strongest structural fit)

A bench run is a long-lived process with logs, artifacts, and often a reasoning agent driving it. **That is exactly a bb thread.** So the emulation host and the HIL rack are enrolled as bb **hosts**, and a bench run _is_ a thread running on that host.

**How it works:**

1. **Enroll the rack/host.** Register the emulation box (Tiers 1–2, QEMU/Renode + Forge, `FORGE_ALLOW_PENTEST` + verifier binary + Docker) and the HIL rack (Tier 3, Labgrid coordinator → exporter hosts → shield-boxed DUTs) as bb hosts. Each `bench_run.host_id` names the host the run executed on; a tier can target a different host. **[UNVERIFIED — exact SDK surface]:** the Build Guide documents `bb.sdk.environments` (worktree-bearing environments) and multi-host `bb.sdk.files`, but does not fully document a first-class "host registration" API. Confirm the enrollment primitive against the bb SDK before Phase 5; if hosts are modeled as environments, bind runs to an environment id instead. Flagged in Open Questions.
2. **A run = a thread on the host.** Dispatching a bench run spawns a thread (`bb.sdk.threads.spawn`, `origin: "plugin"`, bound to the host/environment) that executes the Labgrid/pytest suite, the Renode script, or the Forge verifier. The thread's terminal is the **native live log**; artifacts land in the host's worktree; the `bench_run.thread_id` links the row to the thread.
3. **Surfacing.** The timeline row's "→ thread ↗" opens that thread. The `threadPanelAction` "Bench run" tab (params = `runId`, persists across reloads — Build Guide §2) embeds the run beside whatever thread is doing the work, using the host-provided `ThreadChat variant="timeline"` component. No custom log renderer — the thread _is_ the log.

This is why the bench is bb's best structural fit: we are not inventing a job runner and a log viewer; we are letting bb's thread/host model _be_ the bench, and the plugin is the index and the verdict layer over it.

## B10. Data model

Bench runs, results, artifacts, and attestations are **CACHED** (SPEC 01). Assurance Studio owns verification records; optional Forge owns only its compute jobs and compute artifacts; plugin/host runners own local Tier-0/2/3 execution evidence until it is recorded through a verified AS result operation. We project the unified view for the panel and refresh on pull + realtime nudges. Runs themselves are **ACTION-ONLY** to trigger (invoked, never stored as YAML — nothing about a run lands in the plan; SPEC 03 §4.3).

```sql
CREATE TABLE bench_run (
  id             TEXT PRIMARY KEY,   -- normalized AS, Forge-compute, or local run id
  pv_id          TEXT NOT NULL,
  firmware_digest TEXT,              -- artifact hash of the materialized rootfs at run time
  tier           TEXT NOT NULL,      -- tier0|tier1|tier2|tier3|tier4
  kind           TEXT NOT NULL,      -- static|rehost|pentest|fuzz|renode|hil|lab
  status         TEXT NOT NULL,      -- queued|running|passed|failed|error|cancelled
  trigger        TEXT,               -- commit:<sha> | merge:<pr> | schedule:<name> | manual | needs-hil
  host_id        TEXT,               -- bb host/environment the run executed on (B9)
  thread_id      TEXT,               -- bb thread surfacing the run (B9)
  config         TEXT,               -- JSON: verifier set, params, script
  started_at     TEXT, finished_at TEXT, duration_ms INTEGER,
  synced_at      TEXT NOT NULL
);
CREATE INDEX bench_run_pv ON bench_run(pv_id, started_at);

CREATE TABLE bench_result (          -- maps outcomes to requirement IDs (feeds SPEC 03 matrix)
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES bench_run(id),
  requirement_key TEXT,              -- SPEC 03 req slug (via id_map); NULL for un-mapped checks
  check_key      TEXT,
  tier           TEXT,               -- static|emulation|hil|manual
  status         TEXT NOT NULL,      -- verified|failed|error|inconclusive|running|pending|skipped
  confidence     TEXT,
  evidence_summary TEXT,
  measured       TEXT,               -- JSON measured values (HIL: sleep_current_uA, boot_ms, …)
  synced_at      TEXT NOT NULL
);
CREATE INDEX bench_result_req ON bench_result(requirement_key, tier);

CREATE TABLE bench_artifact (
  id     TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES bench_run(id),
  kind   TEXT,                       -- log|pcap|coredump|screenshot|report|sbom|attestation
  name   TEXT, size INTEGER, sha256 TEXT,
  path   TEXT,                       -- plugin-controlled local synced path (served via bb.http)
  synced_at TEXT NOT NULL
);

CREATE TABLE bench_attestation (     -- the in-toto/SLSA evidence, bound to the firmware digest
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES bench_run(id),
  subject_digest TEXT NOT NULL,      -- in-toto subject = firmware artifact digest
  predicate_type TEXT,               -- https://slsa.dev/provenance/v1 | fs:verification/v1
  verdict       TEXT NOT NULL,       -- safe_to_ota | not_safe | inconclusive
  requirement_ids TEXT,              -- JSON array of req slugs exercised
  signer_identity TEXT,              -- keyless OIDC identity (Sigstore Fulcio)
  rekor_uuid    TEXT,                -- transparency-log entry (verifiable)
  envelope_path TEXT,                -- DSSE envelope (served via bb.http for download)
  signed_at     TEXT, synced_at TEXT NOT NULL
);
```

**Tier mapping (declared at sync time — SPEC 06 §2.6 ⚑14).** `bench_run.tier` is five-valued (`tier0…tier4`); `bench_result.tier` and the SPEC 03 §4.1 matrix are four-valued (`static|emulation|hil|manual`). The mapping is fixed:

| `bench_run.tier` | `bench_result.tier` / matrix column | Note                                                                                                            |
| ---------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| tier0            | `static`                            |                                                                                                                 |
| tier1            | `emulation`                         |                                                                                                                 |
| tier2            | `emulation`                         | it _is_ emulation; the deterministic sub-kind (Renode/Verilator) is recorded in `bench_result.evidence_summary` |
| tier3            | `hil`                               |                                                                                                                 |
| tier4            | `manual`                            | a countersigned lab report is attestation-class evidence                                                        |

**Requirement mapping + writeback.** `bench_result.requirement_key` is the join to SPEC 03. Results also write back into AS via `external_sync` so SPEC 03 §5.6's `verification_results` cache (and thus the matrix and status pills) reflects bench outcomes — the bench is the _producer_, the SPEC 03 matrix is a _reader_. This closes the loop SPEC 03 §4.3 described ("Bench/HIL runs dispatch through the SPEC 05 bench… this tab only reflects them").

**Attestation binding.** Every attestation's `subject_digest` is the firmware artifact hash (identical to `qemu_dynamic.py`'s `_firmware_artifact_hash` and the manifest's `artifact_hash`), the predicate carries `requirement_ids` + `verdict` + measured values, signed via **Sigstore keyless (Fulcio OIDC + Rekor)** in an in-toto/DSSE envelope with a **SLSA provenance** predicate. The `rekor_uuid` makes the "verify ↗" link on the verdict card real — anyone can check the transparency log. This is the signed-evidence spine the Verification Bench design §5 specifies.

---

# PART C — DOCUMENTS

## C11. The job to be done

**The user:** the product security engineer grounding requirements in a spec, and the hardware engineer whose datasheets and register maps are the only place credible HBOM data lives.

**What this makes possible:** datasheets, register maps, and specifications become **first-class context for humans and agents** — searchable, viewable inline, and structurally extracted with page-level provenance. Documents are not a filing cabinet; they are the fuel for SPEC 04's HBOM extraction and SPEC 03's requirements grounding.

**Verified substrate (Feature Designs §3a):** AS has document list/upload-url/finalize/analyze/download/batch handlers and a `doc_type` enum (`architecture|design|other|regulatory|requirements|sbom|security_assessment|specification|test_report|user_manual` — **no `datasheet`/`bom`**). v1 keeps documents worktree-local until those binary flows are frozen in `AssuranceStudioClient`. Browser-to-plugin upload always goes through authenticated `bb.http`, not JSON RPC; the backend may later stream to signed AS upload URLs through named methods. Forge is not involved.

## C12. Panel

`navPanel` **"Documents"** (`icon: "FileText"`, `path: "documents"`) — a **split list/viewer**.

```
┌─ Documents ──────────────┬──────────────────────────────────────────────────────┐
│ [＋ Add]  filter: type ▾ │  bcm6755-ds.pdf                          p. 1 / 214    │
│──────────────────────────│                                                       │
│ ● bcm6755-ds.pdf   data..│   ┌──────────────────────────────────────────────┐   │
│   ax3000-regmap.svd  reg │   │            (PDF rendered inline)              │   │
│   cra-annex-i.pdf   regu │   │                                              │   │
│   bom-rev-c.xlsx    bom  │   │   ░░ extracted overlay ░░                    │   │
│                          │   │   ┌──────────────────────────────────┐       │   │
│                          │   │   │ We read 14 fields from this page: │       │   │
│                          │   │   │  MPN        BCM6755KFEBG   ●high   │       │   │
│                          │   │   │  Mfr        Broadcom       ●high   │       │   │
│                          │   │   │  Package    FBGA-609       ◐med    │       │   │
│                          │   │   │  … → HBOM-0001            [review] │       │   │
│                          │   │   └──────────────────────────────────┘       │   │
│                          │   └──────────────────────────────────────────────┘   │
└──────────────────────────┴──────────────────────────────────────────────────────┘
```

- **List (left):** filter by `doc_type` and project; each row shows filename, type badge, analyzed/not-analyzed state.
- **Viewer (right):** **PDF inline** via bb's built-in preview or a sandboxed iframe pointed at `bb.sdk.files.createPreview` (confined transport for synced local copies). Register-map/SVD/BOM formats render structured.
- **Agent-extracted structure as an overlay.** When the agent has extracted fields from a page, an overlay panel shows _"we read these 14 fields from this page"_ — each field a `{value, confidence}` cell with a **source_ref** (page + region) and a link to its target (`→ HBOM-0001`, `→ REQ-104`). This is the credibility surface: an extraction nobody can trace is worthless; page-level provenance is what makes it defensible for CRA/FCC (mirrors SPEC 04's per-field provenance model). Low-confidence cells carry a `[review]` action.
- **Upload via `bb.http` (binary, not RPC).** The `[＋ Add]` dropzone POSTs the binary to `bb.http.route("POST", "documents/upload", handler, { auth: "local" })`; the route stores the file in the single document store at `product-security/documents/<sha256>-<name>` in the worktree (git-tracked — anything a `source_ref` cites must survive a clone; shared with SPEC 04's HBOM ingestion, SPEC 06 §2.6 ⚑12) and writes a `document` row. After direct AS binary methods are verified and frozen, the backend may also stream through AS `upload-url`→object-store→`finalize`; v1 keeps docs worktree-local.
- **`fileOpener` registration.** Register openers for `pdf` (native preview handles rendering; our opener adds the extraction overlay), and for register-map formats (`svd`, register-header `.h`, BOM `.csv`/`.xlsx`) → our structured viewer. Registration is ~an hour (Build Guide §7).

### C12.1 Data model (`data.db`)

```sql
CREATE TABLE document (             -- the SINGLE scoped ledger; WP-04 is frozen authority
  project_id         TEXT NOT NULL,
  project_version_id TEXT NOT NULL, -- backend @project sentinel only; wire null never the literal
  document_id        TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  name               TEXT NOT NULL,
  path               TEXT NOT NULL,
  doc_kind           TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  bytes              INTEGER NOT NULL,
  withdrawn          INTEGER NOT NULL DEFAULT 0,
  needs_ocr          INTEGER NOT NULL DEFAULT 0,
  uploaded_at        TEXT NOT NULL,
  analyzed_by        TEXT,
  analyzed_at        TEXT,
  cells_extracted    INTEGER NOT NULL DEFAULT 0,
  indexed_at         TEXT NOT NULL,
  PRIMARY KEY (project_id, project_version_id, document_id),
  UNIQUE (project_id, project_version_id, sha256)
);
CREATE TABLE document_extraction (  -- the overlay + the provenance ledger
  project_id         TEXT NOT NULL,
  project_version_id TEXT NOT NULL,
  extraction_id      TEXT NOT NULL,
  document_id        TEXT NOT NULL,
  field              TEXT NOT NULL,
  value              TEXT,
  confidence         REAL,
  source_ref         TEXT NOT NULL,
  locator_kind       TEXT NOT NULL, -- pdf | sheet | text; typed locator columns follow
  status             TEXT NOT NULL,
  extracted_at       TEXT NOT NULL,
  PRIMARY KEY (project_id, project_version_id, extraction_id),
  FOREIGN KEY (project_id, project_version_id, document_id)
    REFERENCES document(project_id, project_version_id, document_id) ON DELETE CASCADE
);
```

WP-04 defines the remaining typed locator/target columns and all constraints/indexes. No lane may replace this with an unscoped digest lookup or another document ledger.

## C13. How documents feed the other surfaces

**→ HBOM extraction (SPEC 04).** The document extraction agent parses datasheets/BOM spreadsheets/schematic exports and emits `{value, provenance, source_ref, confidence}` cells that become the `product-security/hbom/hbom.yaml` component fields (SPEC 04 §4.3; MPN, manufacturer, package, reference designators, lifecycle, country-of-origin). `document_extraction.target = "hbom:HBOM-0001.mpn"` is the join; the shared `document` ledger (C12.1) records what was ingested (filename, doc_kind, sha256, analyzed_at). AS seeds almost no real HBOM fields (hardware components carry no MPN/manufacturer/ref-des), so **the documents carry the real data** — this is document-driven HBOM, not magic inference (SPEC 04 owns the merge/review-queue; this surface is the source).

**→ Requirements grounding (SPEC 03).** Regulatory and specification documents ground requirements: a requirement's `rationale`/`controls`/`standards` cite a clause, and the clause text can be extracted from the uploaded regulation PDF (`document_extraction.target = "req:REQ-104.rationale"`, or a standard-clause body for the SPEC 03 `standards_clauses` cache). The agent uses `fs_doc_search` (X14) to find the spec text a requirement must satisfy — e.g., "find the secure-boot clause in cra-annex-i.pdf" — and cites the page in the requirement's `source_description`. Documents are how "the spec said so" becomes a link, not a memory.

---

# CROSS-CUTTING

## X14. bb integration (all three surfaces)

Per SPEC 00 §8, each surface declares its four agent affordances. Reads are free; **the only server-touching tools here are the ACTION-ONLY invocations** (`fs_firmware_materialize` hydrate, `fs_bench_run`) — two members of SPEC 06's exactly-three compile-time allowlist alongside `fs_verification_run`. There is **no push tool and no attestation-write tool** — attestations are produced by the bench runner and signed server-side. Every action is logged; a running bb/provider policy may show an approval interaction, but that policy-dependent UI is not the safety boundary.

### X14.1 Agent tools (`bb.agents.registerTool`)

```ts
bb.agents.registerTool({
  name: "fs_firmware_materialize", // READ + ACTION (hydrate is the flagged exception)
  description:
    "Materialize a firmware version's file tree (manifest) and/or hydrate bytes for " +
    "specific paths so native Read/Grep can reach them. Manifest is always safe; hydrating " +
    "pulls bytes (admin-gated) and is required before a Tier-1 pen-test. Never edits the model.",
  input: z.object({
    pv_id: z.string(),
    scan_id: z.string().optional(),
    mode: z.enum(["manifest", "hydrate", "hydrate_all"]).default("manifest"),
    paths: z.array(z.string()).optional(), // for mode:"hydrate" — e.g. ["/etc", "/usr/sbin"]
  }),
  // handler: materialize()/hydrateFile() from A2; publishes fs-firmware-progress; asserts rootPath confinement
});

bb.agents.registerTool({
  name: "fs_bench_run", // ACTION-ONLY — the flagged exception (see SPEC 03 §6.2)
  description:
    "Trigger a verification-bench run at a tier against a firmware version. Invokes the " +
    "platform's own analysis (verify_dynamic / pen_test_run / HIL suite); results land as signed " +
    "evidence rows. Does NOT edit the model. Requires the mount fully materialized (auto-hydrates first).",
  input: z.object({
    pv_id: z.string(),
    tier: z.enum(["tier0", "tier1", "tier2", "tier3", "tier4"]),
    requirement: z.string().optional(), // scope to one requirement's checks
    target: z.string().optional(), // e.g. a binary path to stage
  }),
  // handler: assert materialized; use ForgeComputeClient only for Tier-1/QEMU/pen-test;
  // other tiers dispatch to their declared local/host runner; all return normalized run summaries
});

bb.agents.registerTool({
  name: "fs_bench_status", // READ
  description:
    "List/get bench runs, results, artifacts, and the safe-to-OTA verdict for a firmware " +
    "version. Serves from the SQLite cache; returns run ids suitable for ::fs-bench and ::fs-verdict.",
  input: z.object({
    pv_id: z.string().optional(),
    run_id: z.string().optional(),
    want: z.enum(["runs", "results", "artifacts", "verdict"]).default("runs"),
    limit: z.number().int().max(200).default(50),
  }),
});

bb.agents.registerTool({
  name: "fs_doc_search", // READ
  description:
    "Search documents and their agent-extracted structure (datasheets, register maps, " +
    "specs, regulations). Returns matches with page + region source_refs, for grounding " +
    "requirements and HBOM fields. Never uploads or edits.",
  input: z.object({
    project_id: z.string(),
    query: z.string(),
    doc_type: z.string().optional(),
    limit: z.number().int().max(100).default(20),
  }),
});
```

### X14.2 SKILL.md outlines

- **`skills/firmware/SKILL.md`** — the mount is always browsable via the manifest; **call `fs_firmware_materialize` to hydrate before Reading** a file (bytes are lazy and admin-gated); large binaries stream to disk, so prefer `Grep` over dumping a binary; the rootfs is at `.fs-firmware/<pv_id>/rootfs/`; grepping firmware alongside source is the intended workflow (e.g. "hydrate /etc and /usr/sbin, then grep for hardcoded creds"); paths are attacker-influenced — cite exact paths, never guess.
- **`skills/bench/SKILL.md`** — a run is invoked, never a YAML edit; **the mount must be fully materialized before a Tier-1 pen-test** (the tool auto-hydrates but say so); the tier taxonomy (`static|emulation|hil|manual`) matches SPEC 03's matrix; results write back to the requirement matrix; **never assert "safe to OTA" in prose — emit `::fs-verdict` and let the signed card speak**; gaps are gaps, not passes; show a run with `::fs-bench`, a verdict with `::fs-verdict`.
- **`skills/docs/SKILL.md`** — extract only fields you can cite to a page/region (set a `source_ref`); set `confidence: low` for anything inferred; never overwrite a human-reviewed cell; write extractions targeting HBOM cells (SPEC 04) or requirement rationale (SPEC 03); use `fs_doc_search` to ground a requirement in a spec clause and cite the page.

### X14.3 Directives (`app.slots.messageDirective`)

All fetch by id via RPC (attributes are attacker-controlled — never render attribute content, never accept payloads; SPEC 00 §8, Build Guide §5):

| Directive                     | Renders                                                                                            | Notes                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `::fs-bench{id="run-88"}`     | bench-run card — status, tier, duration, verifier count, artifacts summary, link to thread + panel | click-through → `bench/run-88`                                                  |
| `::fs-verdict{id="7a10be44"}` | **the safe-to-OTA verdict card** (B8.3) — keyed by firmware digest or run id                       | the demo centerpiece; self-fetches from cache so it works offline (SPEC 00 §12) |
| `::fs-doc{id="doc-1"}`        | document card with the extraction overlay preview + page thumbnails + source-ref links             | click-through → `documents` with the doc open                                   |

Unknown ids render the designed empty/error card, never a crash (directives are ErrorBoundary'd; fallback is literal text).

### X14.4 Mentions

`~bench-run-88` and `~verdict-<digest>` resolve to fresh bench context at send time (SPEC 03 §6.5 reserved `~bench-run-…` for this spec). `@datasheet:bcm6755` resolves a document. The mention provider searches the SQLite cache server-side (2s box) and `resolve` returns the agent-visible context (run status + verdict summary, or extracted fields) at send time.

### X14.5 CLI (extends SPEC 00 §9)

```
bb finite-state firmware pull <pv_id> [--scan <id>] [--full --image <path>]
bb finite-state firmware status <pv_id>                        # chip state as text
bb finite-state firmware hydrate <pv_id> <path>...             # pull bytes for specific paths
bb finite-state firmware diff <pv_id_a> <pv_id_b>              # version-comparison (free from content-addressing)

bb finite-state bench run <pv_id> [--tier tier1] [--requirement REQ-104] [--target <path>]
bb finite-state bench list [--pv <id>] [--tier tier1] [--failing] [--json]
bb finite-state bench show <run_id>
bb finite-state bench verdict <pv_id>                          # the safe-to-OTA card as text

bb finite-state doc list [--project <id>] [--type datasheet] [--json]
bb finite-state doc show <doc_id>
bb finite-state doc search <query> [--project <id>]
```

1 MiB CLI output cap — page everything. Both the human and the agent use these (SPEC 00 §9).

### X14.6 Realtime channels

Ephemeral broadcast — publish "changed" nudges, refetch via RPC; never a data channel (SPEC 00 §5):

| Channel                | Payload                        | Trigger                                             |
| ---------------------- | ------------------------------ | --------------------------------------------------- |
| `fs-firmware-progress` | `{ pvId, phase, done, total }` | manifest sync + bulk hydrate progress               |
| `fs-firmware-stale`    | `{ pvId }`                     | scan-id / artifact-hash change on re-open (A5.5)    |
| `fs-bench-run`         | `{ runId, status }`            | run state transition (queued→running→passed/failed) |
| `fs-bench-log`         | `{ runId, seq }`               | new log lines available (cursor refetch nudge)      |
| `fs-doc-changed`       | `{ projectId }`                | upload finalized / extraction merged                |

## X15. Platform, Assurance Studio, and optional Forge-compute dependencies

**What exists today (verified):**

- **Platform firmware:** direct `PlatformClient.browseFirmwareFilesystem` and `getFirmwareFile` own tree/overview and meta/range/full bytes. Full mode returns a backend byte stream; bytes require `VIEW_ANY_PROJECT_FILE`. STP owns the 78-plugin FACT unpacker + `standalone_unpack.py` fallback.
- **Bench:** `verify_dynamic` (QEMU rehost), `pen_test_run` (two-agent pen-test), the **10 STP relay tools**, all gated behind `FORGE_ALLOW_PENTEST` (7 pen-test/QEMU tools). in-toto/SLSA/Sigstore signing is the target evidence format.
- **Assurance Studio verification:** closed methods for checks/results/runs and rollups are shared with SPEC 03. Each method requires verified route evidence; there is no raw API escape hatch.

**What's needed (build asks, roughly in leverage order):**

1. **`GET /filesystem/export?pv_id=&scan_id=` tarball endpoint (STP + Helix) — the high-leverage ask.** Streams the extracted tree as a tarball; collapses the hours-long first pull to minutes; a real customer feature (offline/air-gapped analysis). **[UNVERIFIED, moderate]** — does not exist; recommend building regardless of this project.
2. **Reviewed Platform flat filesystem search route** — optional optimization. Without it, v1 enumerates by recursing `browseFirmwareFilesystem`; add only as a named frozen method.
3. **Normalized run-history sources** — direct AS verification runs plus optional `ForgeComputeClient.listJobs`; the timeline joins them with plugin/host runs rather than inventing one Forge-owned history API. The invocation allowlist remains closed to the four checksummed MCP operations, while `ForgeJobSnapshot.tool` and the list filter preserve arbitrary Forge registry strings as telemetry metadata.
4. **Safe Forge firmware-root preparation** — `prepareFirmwareRoot(pv_id, path, digest)` via local process control or a narrow runtime tool; remote Forge explicitly reports unsupported until secure transfer/registration exists.
5. **Direct Platform artifact-hash exposure** — enables stronger staleness detection; scan id remains the honest fallback.
6. **Direct AS binary document methods** — verified signed upload/finalize and download streams, plus a `datasheet`/`bom` type extension; optional for v1.
7. **Direct AS HIL result writeback** so Tier-3 results land in `verification_results` through the sanctioned result route.

**Host provisioning (Part B):**

- **Emulation host (Tiers 1–2):** `FORGE_ALLOW_PENTEST=1`, the verifier binary, Docker (QEMU-in-Docker), Renode. Enroll as a bb host (B9).
- **HIL rack (Tier 3):** Labgrid coordinator + exporter hosts + shield-boxed DUTs + power/SMU + J-Link + `tc netem`; enroll as a bb host. Starter rig ~$8k–$20k; procure early (hardware lead time is the schedule risk).
- **Provision these before the demo** (Shortest Path week 5 note) — the pen-test lane fails opaquely without `FORGE_ALLOW_PENTEST` + verifier + Docker + a fully materialized mount (A3).

## X16. Build plan

Slots into SPEC 00 build sequence **Phase 5** after the shared infra—direct remote clients, optional compute adapter, SQLite, panel kit, and theming—is standing. One strong engineer; upstream asks (X15) run in parallel.

| Part  | Step | Deliverable                                                                                                                      | Effort                                                                |
| ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **A** | A.1  | Manifest sync via direct Platform tree recursion (optional reviewed flat-search optimization) → placeholders + `manifest.sqlite` | 2–3 d                                                                 |
| **A** | A.2  | Direct Platform selective hydration + blob dedup; local complete-image materialization + progress                                | 2–3 d                                                                 |
| **A** | A.3  | Optional `ForgeComputeClient.prepareFirmwareRoot` handshake + digest and ordering-constraint enforcement                         | 1 d                                                                   |
| **A** | A.4  | `fileOpener` binary metadata card + version-diff view + status chip + CLI verbs                                                  | 2 d                                                                   |
| **A** | A.5  | `standalone_unpack.py` fallback path (ingest `snapshot.json`), gitignore/pollution test, staleness detection                     | 1–2 d                                                                 |
|       |      | **Part A subtotal**                                                                                                              | **~6–9 d** (A.5 fallback removes rate-limit/admin risk)               |
| **B** | B.1  | Bench data model + normalized AS/optional-Forge/local run sync + timeline panel (states, filters)                                | 2–3 d                                                                 |
| **B** | B.2  | Run detail — config, cursor-paged log tail, artifact proxy routes                                                                | 2–3 d                                                                 |
| **B** | B.3  | **The safe-to-OTA verdict card** — verdict logic, attestation binding, Sigstore/Rekor verify link, DSSE download                 | 2–3 d                                                                 |
| **B** | B.4  | bb-host enrollment + run-as-thread wiring + `threadPanelAction` tab                                                              | 2–4 d ([UNVERIFIED host API — may reduce to environment binding)      |
| **B** | B.5  | Tier orchestration (dispatch `verify_dynamic`/`pen_test_run`, needs-HIL flag) + writeback to SPEC 03 matrix                      | 2–3 d                                                                 |
|       |      | **Part B subtotal**                                                                                                              | **~10–16 d** (Tiers 2–4 are staged; Tier 1 + verdict is the demo MVP) |
| **C** | C.1  | Documents panel — split list/viewer, PDF inline, `bb.http` upload route, `fileOpener` registrations                              | 3–4 d                                                                 |
| **C** | C.2  | Extraction overlay + `document_extraction` model + `fs_doc_search` + HBOM/requirements feed wiring                               | 2–3 d                                                                 |
|       |      | **Part C subtotal**                                                                                                              | **~5–7 d**                                                            |
| **X** | X.1  | Agent tools (4), SKILL.md (3), directives (`::fs-bench`/`::fs-verdict`/`::fs-doc`), mention provider, realtime                   | 3–4 d                                                                 |
|       |      | **Total (Part 05)**                                                                                                              | **~5–7 eng-weeks** on shared infra, Tiers 3–4 partial                 |

**Ship order within Phase 5:** the firmware mount first (it is the prerequisite for the pen-test lane _and_ what lets the agent grep firmware alongside source — SPEC 03 §2.4/§3.4 and Part B both depend on it landing), then Documents (unblocks SPEC 04 HBOM), then the bench Tier-0/Tier-1 + verdict card (the demo MVP), then Tiers 2–4 as breadth. **The verdict card (B.3) is the single highest-value component in this spec — build it deliberately, demo it early.**

**Definition of done** (SPEC 00 §12 + surface-specific): a 10k-file mount materializes directly from Platform or local unpack with Forge absent, is gitignored, and the agent greps it alongside source · when Forge compute is configured, its prepared-root digest matches and a Tier-1 pen-test runs against that fully materialized target · a bench run appears as a bb thread on an enrolled host · the safe-to-OTA verdict card renders from warm cache offline, with a verifiable Rekor link · a datasheet upload extracts fields with page-level source refs that populate an HBOM cell · `::fs-verdict` works offline.

---

## Open questions

1. **bb host-registration API (B9).** The Build Guide documents `bb.sdk.environments` and multi-host `bb.sdk.files` but not a first-class "enroll a host" primitive. Confirm against the bb SDK before Phase 5; if hosts are environments, bind bench runs to an environment id. **This is the one architectural unknown in Part B** — resolve early.
2. **Forge firmware-root preparation.** Env-var-at-spawn works for the local demo appliance; a narrow digest-bound runtime registration is the productization fix. Remote Forge must report unsupported until it has a secure byte/root handoff.
3. **Platform artifact hash (A5.5).** Staleness detection is best with a direct, reviewed Platform artifact hash; until it is exposed, fall back to scan-id comparison. Forge is not the source of this metadata.
4. **Verdict scope boundary.** Does "safe to OTA" evaluate _all_ required requirements for the version, or a run-scoped subset? Proposal: the card is always version-scoped (all required requirements) and a run contributes evidence; a single run rarely earns the whole verdict. Confirm the demo narrative wants version-scoped.
5. **Tier 3/4 evidence ingestion format.** Tier 4 lab reports are external PDFs to countersign; Tier 3 HIL emits OpenHTF-style measurements. Decide the canonical `measured` JSON shape and the countersign flow (who signs, with what identity) before HIL lands.
6. **Document retention in v1 (C12).** Docs live worktree-local until `as_upload_document` exists — acceptable for FDE/demo, a data-loss risk for a tenanted product. Decide whether Phase 5 ships the binary I/O tools or defers to Horizon 2.
7. **`doc_type` enum extension.** `datasheet`/`bom` need a small AS migration or land as `specification`/`other`. Confirm whether we extend the enum now (cleaner HBOM provenance) or map locally and defer.

---

## Amendments applied by later specs

- **SPEC 08 §4.1 — tier D (development) below tier 0.** The bench answers "does this build pass?"; debug answers "why is this hanging?" — different loops, different safety postures. Tier D is interactive, human-initiated, read-mostly, with destructive operations requiring explicit instruction. **Tier D results are diagnostic, never evidentiary**: they never feed the requirement × tier matrix and never produce attestations. A hypothesis confirmed at the bench is a finding, not a proof. Data lands in `probe_run` (AMD-0010), not `verification_results`.
- **SPEC 08 §5 — `build_run.digest` joins the attestation chain.** A firmware image built by the authoring loop is the subject of the attestation produced by this spec's bench, binding "the requirement flipped because _this_ build passed" to a digest.
- **SPEC 07 §2 — the hardware artifact cache mirrors the firmware mount.** `.fs-hw/<project-hash>/` follows the same CACHED discipline as `.fs-firmware/`: content-addressed, gitignored, regenerable, provenance recorded per artifact.
