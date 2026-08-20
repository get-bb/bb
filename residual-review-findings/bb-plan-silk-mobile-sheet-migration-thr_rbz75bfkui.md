# Residual review findings

Branch: `bb/plan-silk-mobile-sheet-migration-thr_rbz75bfkui`  
Record head (at residual commit time): see git history for this file.  
Canonical plan: `plans/2026-08-20-001-refactor-silk-mobile-drawers-plan.md`

## Source run context

- Skill / contract: LFG residual handoff, tracker-defer **non-interactive**
- Review run id: `20260820-164824-1b0b5004`
- Artifact path: `/tmp/compound-engineering-1000/ce-code-review/20260820-164824-1b0b5004`
- Review metadata head_sha (at review): `3d17cc98d6ff0a00d52fb0db1e84836d0d5a180e`
- Review verdict: Not ready
- Completed at: `2026-08-20T17:16:46.068Z`
- Tracker detection: GitHub Issues (`get-bb/bb`, `hasIssuesEnabled: true`), confidence high, `named_sink_available: true`, `any_sink_available: true`
- Filing mode: non-interactive fallback chain (named GitHub Issues via `gh`)

## Residual Review Findings

Deferred actionable residuals from the code-review run (not fixed in-product this handoff).

### Finding #12 — Edge-swipe open ignores finger; cancelled swipe fully opens

- **Severity:** P1
- **Confidence:** 75
- **File:** `apps/app/src/components/ui/sidebar.tsx:1167`
- **Reviewers:** adversarial
- **Problem:** Sidebar edge-swipe does not scrub finger progress through Silk; safe change commits open only on winning release, but full Silk detent scrubbing remains unresolved. Custom edge-swipe `flushSync`s `setOpenMobile(true)` on drag intent so ResponsiveDrawerShell presents fully; `session.lastProgress` is not applied to Silk travel/`activeDetent`. Cancelled/sub-threshold swipes can fully open then deferred-close.
- **Suggested fix:** Drive Silk `activeDetent`/travel from swipe progress until release, or use Silk native present gesture only; if open state must flip early for realization, scrub detent to finger progress and commit detent 1 only when `shouldOpenSidebarMobileSwipe` wins.
- **Tracker:** filed
- **URL:** https://github.com/get-bb/bb/issues/2046

### Finding #10 — Implementation unit U8 has no release-readiness evidence

- **Severity:** P1
- **Confidence:** 100
- **File:** `plans/2026-08-20-001-refactor-silk-mobile-drawers-plan.md:493`
- **Reviewers:** plan-completeness
- **Problem:** U8 release-readiness evidence is incomplete: iOS Safari/device QA, style-recalc/performance, bundle-budget, and full browser evidence have not run. Working tree lacked U8 QA record / bundle-budget update / debugging-QA artifact at review time; reduced-motion forced in overlay tests and skipped core sidebar cases further weaken proof of WebKit/gesture/focus/nested-overlay/single-runtime guarantees.
- **Suggested fix:** Complete U8 (Turbo gates, app build/bundle, legacy search, iOS Simulator + device gesture/focus/performance QA, desktop/plugin overlay checks) or explicitly amend canonical plan acceptance scope if deferred.
- **Tracker:** filed
- **URL:** https://github.com/get-bb/bb/issues/2047

## Structured tracker-defer result

```json
{
  "filed": [
    {
      "finding_id": "#12",
      "title": "Edge-swipe open ignores finger; cancelled swipe fully opens",
      "severity": "P1",
      "file": "apps/app/src/components/ui/sidebar.tsx",
      "line": 1167,
      "tracker": "GitHub Issues",
      "url": "https://github.com/get-bb/bb/issues/2046"
    },
    {
      "finding_id": "#10",
      "title": "Implementation unit U8 has no release-readiness evidence",
      "severity": "P1",
      "file": "plans/2026-08-20-001-refactor-silk-mobile-drawers-plan.md",
      "line": 493,
      "tracker": "GitHub Issues",
      "url": "https://github.com/get-bb/bb/issues/2047"
    }
  ],
  "failed": [],
  "no_sink": []
}
```

## Notes

- Product code was not edited in this residual handoff.
- No PR was opened; residual section is durable only in this path (not a PR body).
- Only this residual record is intended for the residual commit.
