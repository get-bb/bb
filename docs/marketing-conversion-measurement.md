# Marketing download intent

`landing_download_intent` version 1 measures activation of a same-origin `/download/{macos,windows,linux}` link on a public marketing page. It uses the existing browser PostHog identity, session, OS and device fields. `download_target` describes the installer selected, not the visitor OS. `source_path`, `page_family`, `page_subtype`, `placement`, `intent_at` and `download_campaign` preserve activation context. Unlabelled inline links use placement `inline`; shared CTA placements, including `local`, are retained.

The router triggers explicit pageviews; SDK automatic pageviews are disabled. Existing public-page initialization registers eligible paths. Account, dashboard and OAuth routes do not initialize analytics or produce pageviews. Root route observations deduplicate initialization, rerenders and repeated observations of the same URL, and count returning to a page after another route. Query changes count as pageviews; hash-only navigation does not.

Clicks and middle-button activations are measured, including keyboard-generated clicks. Pointerdown is only used by existing campaign propagation, never counted as intent. Browser capture is immediate and uses Beacon transport without delaying download navigation. Analytics failure, missing configuration or JavaScript blocking must not stop the link. A click before SDK initialization is deliberately not queued: there is no established browser/session context to preserve. Coverage is best effort among analytics-observed visitors. Context-menu open/save and direct download requests can lack browser intent.

GPC strips advertising click IDs from carried parameters and browser event URLs/properties, including initial/person fields, while retaining campaign labels. Persistent visitor/session IDs are never added to download URLs. Legacy server `landing_download_*_clicked` events are unchanged request counts; do not merge them with this browser event or label either series completed downloads/installations.

## Reporting contract

Use complete UTC dates and exact production `$host` in `getbb.app`, `www.getbb.app`, `getbb.app.`. Exclude a `qa-` campaign in the event `utm_campaign`, current URL, referrer query, or `download_campaign.utm_campaign`. Retain Other/unknown OS. Mobile/Tablet device or iOS/Android OS takes priority, followed by Mac OS X, Windows and Linux.

For each path and exposure OS: denominator is unique observed browser `distinct_id` with a pageview; numerator is the subset with a strictly later version-1 intent on the same path, browser and nonempty session. Deduplicate repeat clicks and visits at the chosen browser or session unit. Report same-family and other-page assisted outcomes separately; never divide a browser numerator by a session denominator. Families overlap, so obtain globally deduplicated totals rather than summing rows.

A HogQL extraction for the join is:

```sql
SELECT distinct_id, timestamp, event, properties.$session_id AS session_id,
       properties.$pathname AS viewed_path, properties.source_path AS intent_path,
       properties.$os AS visitor_os, properties.$device_type AS device_type,
       properties.download_target AS installer
FROM events
WHERE timestamp >= toDateTime('START_DATE', 'UTC')
  AND timestamp < toDateTime('END_DATE', 'UTC')
  AND properties.$host IN ('getbb.app', 'www.getbb.app', 'getbb.app.')
  AND (event = '$pageview' OR
       (event = 'landing_download_intent' AND properties.measurement_version = 1))
  AND notEmpty(coalesce(toString(properties.$session_id), ''))
  AND NOT startsWith(lower(coalesce(toString(properties.utm_campaign), '')), 'qa-')
  AND NOT startsWith(lower(coalesce(toString(properties.download_campaign.utm_campaign), '')), 'qa-')
  AND NOT match(coalesce(toString(properties.$current_url), ''), '(?i)[?&]utm_campaign=qa-')
  AND NOT match(coalesce(toString(properties.$referrer), ''), '(?i)[?&]utm_campaign=qa-')
```

Replace date placeholders, apply the ordered same-browser/session/path join and bucket OS from the exposure row. Check query pagination and exclude incomplete exposure periods. This is an extraction recipe, not a completed funnel query. Cutover is **unknown until deployment is verified**. Historical request data cannot backfill browser conversion.

## Verification

Inspect ingested tagged-QA events for initial load, SPA forward/back navigation, each download placement, raw comparison links, marketplace detail, keyboard and middle click. Assert one pageview per visit and one intent per activation, same browser/session identity, correct source path and distinct visitor/installer OS. Test GPC, private routes, delayed/failed SDK initialization and blocked analytics while verifying links still download. Validate assisted versus same-path attribution with a known session before using the new series in reports.
