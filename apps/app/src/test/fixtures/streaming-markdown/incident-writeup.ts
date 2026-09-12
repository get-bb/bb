export const incidentWriteup = `Here is the writeup for the webhook delivery backlog on March 4. I rebuilt the timeline from the on-call channel, the deploy log, and the queue dashboards, and I cross-checked every timestamp against the metrics store, so the times below are from the metrics rather than from memory.

## Summary

Between 14:02 and 16:48 UTC, outbound webhook deliveries fell behind by up to 38 minutes. No events were lost, but 1,912 customers received order, refund, and subscription webhooks late, and 214 of them had integrations that treated a delivery older than 15 minutes as stale and dropped it on their side.

The trigger was a routine deploy of the delivery worker that changed how connection pools are sized. The new sizing looked correct in staging, but in production it interacted with a slow partner endpoint and a retry policy that had no jitter floor. Workers spent most of their time waiting on sockets that would never answer, and the retry queue grew faster than it drained.

We mitigated by rolling the worker back at 15:31 and by temporarily raising the per-host concurrency limit for the three largest partners. The backlog was fully drained at 16:48.

## Impact

| Surface | Degradation | Duration | Customers affected |
| :-- | :-- | --: | --: |
| Order webhooks | Delivered 4 to 38 minutes late | 2 h 46 min | 1,204 |
| Refund webhooks | Delivered 3 to 31 minutes late | 2 h 39 min | 488 |
| Subscription webhooks | Delivered 2 to 22 minutes late | 2 h 12 min | 220 |
| Webhook dashboard | Delivery status showed "pending" for delivered events | 1 h 05 min | all |
| Partner integrations | Stale deliveries dropped by receiver | n/a | 214 |

Nothing in the payment path was affected. Checkout, capture, and refund processing all stayed within their normal latency bands, because they write to the outbox and never wait on delivery.

## Timeline

All times are UTC on March 4.

| Time | Event |
| :-- | :-- |
| 13:47 | Deploy \`delivery-worker@8f3c21a\` starts rolling out, 10% of hosts |
| 13:55 | Rollout reaches 50% of hosts; error rate unchanged |
| 14:02 | Rollout reaches 100%; delivery lag begins to climb |
| 14:09 | \`webhooks.delivery_lag_p95\` crosses 2 minutes, no alert (threshold is 10 minutes) |
| 14:26 | Lag p95 reaches 10 minutes; \`WebhookLagHigh\` pages the on-call engineer |
| 14:31 | On-call acknowledges, starts looking at partner error rates |
| 14:44 | Partner endpoint for the largest marketplace returns timeouts on 61% of requests |
| 14:52 | Incident declared, severity 2, incident channel opened |
| 15:03 | Retry queue depth reaches 412k jobs, still climbing |
| 15:12 | First hypothesis: the partner outage alone. Their status page shows no incident |
| 15:19 | Second hypothesis: the deploy. Connection pool saturation graphs point at the new sizing |
| 15:31 | Rollback to \`delivery-worker@4be9d07\` completes |
| 15:34 | Per-host concurrency for the three largest partners raised from 8 to 32 |
| 15:58 | Lag p95 falls below 10 minutes |
| 16:20 | Retry queue depth below 20k |
| 16:48 | Backlog drained, lag p95 back under 5 seconds, incident resolved |

## Root cause

The deploy replaced a fixed pool of 64 connections per worker with a pool sized from the number of distinct partner hosts in the last hour, capped at 256. The intent was to stop one busy partner from starving the rest. In production the estimate came out at 212, which is fine on its own, but the change also removed the per-host limit that used to sit in front of the pool.

With no per-host limit, one slow partner could hold almost every connection. That partner started timing out at 14:40 for reasons unrelated to us, and each timed-out request held a socket for the full 30 second timeout. Within a few minutes almost all of the pool was parked on that host.

### How the retry storm formed

1. A delivery to the slow partner times out after 30 seconds and is scheduled for retry.
2. The retry delay for the first attempts is 2 seconds, and the jitter was applied as a multiplier on that delay, so early retries landed within a few hundred milliseconds of each other.
3. Retried jobs go back into the same pool, so they compete with fresh deliveries for the same parked connections.
4. Deliveries to healthy partners wait for a free connection, miss their own deadline, and are retried as well, even though the partner never saw them.
5. The retry queue grows faster than it drains, and every retry adds load to the pool that caused the delay.

The scheduling code that made step two worse is below. The jitter multiplies a delay that starts very small, so it barely spreads the retries out:

\`\`\`ts
export function retryDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(base * jitter);
}
\`\`\`

The fix we shipped on March 6 adds a floor to the jitter window and caps the number of in-flight retries per host:

\`\`\`ts
export function retryDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  const spread = Math.max(MIN_JITTER_MS, base * 0.2);
  return Math.round(base + (random() * 2 - 1) * spread);
}
\`\`\`

## Contributing factors

- The per-host concurrency limit was removed in the same change as the pool sizing, and the review focused on the sizing math.
- Staging has four partner hosts, all of them mocks that answer in under 50 milliseconds, so the failure mode could not appear there.
- The lag alert threshold was 10 minutes, which gave us 24 minutes of silent degradation before the page.
- The dashboard read delivery status from a replica that fell behind under the extra write load, which made the first responder think deliveries were not being attempted at all.
- The runbook for delivery lag starts with checking partner status pages, which sent us down the partner outage path first.

## Detection and response

The page fired 24 minutes after the lag started, which is too slow for a customer facing delay. The alert itself worked as configured; the threshold was set when the product promised delivery within an hour, and nobody revisited it when the documentation changed to promise a few seconds.

Once paged, the on-call engineer found the slow partner quickly, but the partner was a symptom rather than the cause. It took another 35 minutes to connect the saturation graphs to the deploy, mostly because the deploy had finished 40 minutes before anyone looked at it and the deploy marker was not shown on the delivery dashboard.

The rollback was quick and clean. Raising the concurrency limit for the three largest partners was a judgment call that helped drain the backlog faster, and we reverted it at 17:30 once the queue had been empty for half an hour.

## What went well

- No events were lost. The outbox and the retry queue both behaved exactly as designed under pressure.
- The rollback took four minutes from decision to completion.
- Customer support had a macro ready within twenty minutes of the incident being declared, and the status page was updated at 15:05.

## What went poorly

- Detection was slow because the alert threshold did not match what we promise customers.
- The dashboard showed stale delivery status and pointed responders in the wrong direction.
- The change bundled two behaviors that should have shipped separately, and the risky one was hidden behind the obvious one.
- We had no load test that includes a slow receiver, so the combination of saturation and fast retries had never been exercised.

## Action items

| # | Action | Owner | Priority | Due |
| --: | :-- | :-- | :-- | :-- |
| 1 | Restore a per-host concurrency limit, default 8, configurable per partner | Delivery team | P0 | Mar 6 (done) |
| 2 | Add a jitter floor and per-host retry cap to the retry scheduler | Delivery team | P0 | Mar 6 (done) |
| 3 | Lower \`WebhookLagHigh\` to 2 minutes and add a warning at 60 seconds | Platform on-call | P1 | Mar 11 |
| 4 | Show deploy markers on the delivery dashboard | Observability | P1 | Mar 13 |
| 5 | Read delivery status from the primary for the last 15 minutes of data | Delivery team | P1 | Mar 18 |
| 6 | Add a slow receiver scenario to the delivery load test | Performance | P2 | Mar 25 |
| 7 | Rewrite the delivery lag runbook to check recent deploys first | Platform on-call | P2 | Mar 20 |
| 8 | Contact the 214 partners whose integrations dropped stale deliveries | Partner success | P1 | Mar 8 |

## Customer communication

Support sent the first message to affected customers at 15:10 and a resolution notice at 17:02. The second message included the time window and a link to the replay tool, but it did not say which event types were affected, and 31 customers wrote back to ask. For the next incident the template should list the affected event types and the worst observed delay.

For the 214 partners that dropped stale deliveries, partner success is reaching out individually. Most of them can replay from our dashboard, but a handful built their integrations around exactly once delivery and will need us to resend specific events by id.

## Appendix: how the numbers were computed

Late deliveries were counted from the delivery attempts table, using the first successful attempt per event and comparing it to the time the event was written to the outbox:

\`\`\`sql
SELECT
  e.event_type,
  COUNT(DISTINCT e.account_id) AS customers,
  COUNT(*) AS late_events,
  MAX(a.succeeded_at - e.created_at) AS worst_delay
FROM outbox_events e
JOIN LATERAL (
  SELECT MIN(succeeded_at) AS succeeded_at
  FROM delivery_attempts
  WHERE event_id = e.id AND status = 'succeeded'
) a ON TRUE
WHERE e.created_at BETWEEN '2025-03-04 14:00' AND '2025-03-04 17:00'
  AND a.succeeded_at - e.created_at > INTERVAL '2 minutes'
GROUP BY e.event_type
ORDER BY late_events DESC;
\`\`\`

| Event type | Customers | Late events | Worst delay |
| :-- | --: | --: | --: |
| \`order.updated\` | 1,204 | 88,412 | 38 min 12 s |
| \`refund.created\` | 488 | 9,733 | 31 min 40 s |
| \`subscription.renewed\` | 220 | 4,106 | 22 min 05 s |

The customer counts in the impact table come from the same query. A customer is counted once per event type, so the totals in the impact table overlap: 1,912 is the number of distinct customers across all three types.

The dropped delivery count comes from partner reports rather than from our data, because a receiver that answers with a success status and then discards the event looks identical to a healthy delivery from our side.

## Open questions

We still do not know why the partner endpoint started timing out at 14:40. Their team confirmed elevated latency on their side during that window but has not shared a cause, and their status page never showed an incident. It does not change our action items, since a slow receiver must never be able to starve every other partner, but it would help to know whether this is likely to recur.

The other open question is whether the replay tool should resend deliveries that a receiver acknowledged but later reported as dropped for being stale. Resending would fix those integrations, but it would also double deliver to receivers that did process the late event, so I would rather ask the affected partners than guess.

If you want, I can turn the action items into tickets and link them back to this writeup.
`;
