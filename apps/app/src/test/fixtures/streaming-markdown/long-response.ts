export const longResponse = `I traced the slow checkout flow end to end and found three separate problems. The biggest one is in the retry scheduler, which rebuilds its whole queue on every tick; the other two are smaller but compound under load. Below is what I changed, how I verified it, and what I would still keep an eye on.

## Summary

- **Retry scheduler**: \`RetryQueue.schedule()\` sorted the entire pending list on every insert. With 40k pending webhooks that is roughly 40k × log(40k) comparisons per event, and it ran inside the request handler.
- **Session store**: \`SessionStore.get()\` parsed the full session JSON twice, once for validation and once for the typed read.
- **Checkout page**: the React tree re-rendered the whole cart list whenever the shipping estimate refreshed, because the estimate lived in the same context value as the cart items.

All three are fixed on this branch. The end-to-end p95 for \`POST /checkout/confirm\` dropped from **2.8 s** to **310 ms** in the load test, and the page no longer drops frames while the estimate polls.

## 1. Retry scheduler

The scheduler lives in \`packages/webhooks/src/retry-queue.ts\`. Every call to \`schedule()\` pushed the job and then called \`this.pending.sort(byNextAttempt)\`:

\`\`\`ts
export class RetryQueue {
  private pending: RetryJob[] = [];

  schedule(job: RetryJob): void {
    this.pending.push(job);
    this.pending.sort(byNextAttempt);
    this.wake();
  }

  private takeDue(now: number): RetryJob[] {
    const due: RetryJob[] = [];
    while (this.pending.length > 0 && this.pending[0]!.nextAttemptAt <= now) {
      due.push(this.pending.shift()!);
    }
    return due;
  }
}
\`\`\`

Two things make this expensive:

1. \`sort()\` is \`O(n log n)\` per insert, so a burst of \`k\` inserts costs \`O(k · n log n)\`.
2. \`shift()\` is \`O(n)\` because it reindexes the array, so draining \`d\` due jobs costs \`O(d · n)\`.

I replaced the array with a binary min-heap keyed by \`nextAttemptAt\`, with a stable tie-breaker on the job id so jobs scheduled for the same millisecond keep their insertion order:

\`\`\`ts
interface HeapEntry {
  at: number;
  seq: number;
  job: RetryJob;
}

function before(left: HeapEntry, right: HeapEntry): boolean {
  return left.at < right.at || (left.at === right.at && left.seq < right.seq);
}

export class RetryQueue {
  private heap: HeapEntry[] = [];
  private nextSeq = 0;

  schedule(job: RetryJob): void {
    const entry = { at: job.nextAttemptAt, seq: this.nextSeq++, job };
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
    this.wake();
  }

  private takeDue(now: number): RetryJob[] {
    const due: RetryJob[] = [];
    while (this.heap.length > 0 && this.heap[0]!.at <= now) {
      due.push(this.pop().job);
    }
    return due;
  }

  private pop(): HeapEntry {
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!before(this.heap[child]!, this.heap[parent]!)) {
        return;
      }
      [this.heap[child], this.heap[parent]] = [this.heap[parent]!, this.heap[child]!];
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    const size = this.heap.length;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < size && before(this.heap[left]!, this.heap[smallest]!)) {
        smallest = left;
      }
      if (right < size && before(this.heap[right]!, this.heap[smallest]!)) {
        smallest = right;
      }
      if (smallest === parent) {
        return;
      }
      [this.heap[parent], this.heap[smallest]] = [this.heap[smallest]!, this.heap[parent]!];
      parent = smallest;
    }
  }
}
\`\`\`

Insert and pop are now \`O(log n)\`. For the 40k-job burst in the load test the scheduler went from about 1.9 s of CPU per second of wall time to 11 ms.

> The previous implementation also had a subtle ordering bug: \`Array.prototype.sort\` is stable in V8, but jobs were re-pushed after a failed attempt with the *old* \`nextAttemptAt\` still set for one tick, so a failing job could jump ahead of newer due jobs. The heap takes the timestamp at insert time, which removes that window.

### Backoff policy

While I was in there I checked the backoff math against the spec in \`docs/webhooks/retries.md\`. The delay for attempt $n$ is

$$
d(n) = \\min\\left(d_{\\max},\\ d_0 \\cdot 2^{n-1}\\right) \\cdot (1 + j), \\quad j \\sim U(-0.2, 0.2)
$$

with $d_0 = 2\\,\\text{s}$ and $d_{\\max} = 15\\,\\text{min}$. The code clamped *after* adding jitter, which let the delay exceed $d_{\\max}$ by up to 20%. I moved the clamp so the jitter applies to the clamped value, matching the spec.

| Attempt | Old delay (max) | New delay (max) | Spec |
| ------: | --------------: | --------------: | :--- |
| 1 | 2.4 s | 2.4 s | 2 s ± 20% |
| 4 | 19.2 s | 19.2 s | 16 s ± 20% |
| 9 | 18 min | 15 min | clamp at 15 min |
| 12 | 18 min | 15 min | clamp at 15 min |

### Tests

I added \`retry-queue.test.ts\` cases for:

- [x] same-millisecond jobs keep insertion order
- [x] draining 10k due jobs returns them sorted by \`nextAttemptAt\`
- [x] a failed job re-scheduled during a drain is not returned in the same drain
- [x] the delay never exceeds \`maxDelayMs\` for attempts 1–50
- [ ] a property test over random schedules (left as a follow-up; see the end of this message)

\`\`\`bash
pnpm exec turbo run test --filter=@acme/webhooks -- retry-queue
\`\`\`

\`\`\`text
 ✓ packages/webhooks/src/retry-queue.test.ts (14 tests) 212ms
   ✓ RetryQueue > keeps insertion order for equal timestamps
   ✓ RetryQueue > drains due jobs in timestamp order
   ✓ RetryQueue > does not return a job rescheduled during a drain
   ✓ backoff > never exceeds maxDelayMs

 Test Files  1 passed (1)
      Tests  14 passed (14)
\`\`\`

## 2. Session store double parse

\`SessionStore.get()\` in \`apps/api/src/session/store.ts\` looked like this:

\`\`\`ts
async get(sessionId: string): Promise<Session | null> {
  const raw = await this.redis.get(sessionKey(sessionId));
  if (raw === null) {
    return null;
  }
  if (!isValidSessionJson(raw)) {
    await this.redis.del(sessionKey(sessionId));
    return null;
  }
  return sessionSchema.parse(JSON.parse(raw));
}
\`\`\`

and \`isValidSessionJson\` was:

\`\`\`ts
export function isValidSessionJson(raw: string): boolean {
  try {
    return sessionSchema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}
\`\`\`

So every request parsed the session JSON twice and ran the Zod schema twice. Sessions carry the cart, which for large B2B orders reaches 300–600 KB. The profile showed \`JSON.parse\` at 14% of request CPU on \`/checkout/confirm\`.

The fix is a single parse at the boundary:

\`\`\`diff
 async get(sessionId: string): Promise<Session | null> {
   const raw = await this.redis.get(sessionKey(sessionId));
   if (raw === null) {
     return null;
   }
-  if (!isValidSessionJson(raw)) {
+  const parsed = parseSessionJson(raw);
+  if (parsed === null) {
     await this.redis.del(sessionKey(sessionId));
     return null;
   }
-  return sessionSchema.parse(JSON.parse(raw));
+  return parsed;
 }
\`\`\`

\`\`\`ts
export function parseSessionJson(raw: string): Session | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = sessionSchema.safeParse(value);
  return result.success ? result.data : null;
}
\`\`\`

\`isValidSessionJson\` had two other callers, both in the admin tooling. I switched them to \`parseSessionJson(raw) !== null\` and deleted the old helper.

### Why not cache the parsed session?

I considered an in-process LRU keyed by session id, but sessions are written from three services and we have no invalidation channel. A stale cart during checkout is worse than a slow one, so I left caching out.

## 3. Checkout page re-renders

The checkout page is \`apps/web/src/routes/checkout/CheckoutPage.tsx\`. The shipping estimate refreshes every 5 seconds while the address form is open, and the React profiler showed each refresh committing **~2,400 components** in about 90 ms on a mid-range laptop.

The cause was the context value:

\`\`\`tsx
const CheckoutContext = createContext<CheckoutContextValue | null>(null);

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const cart = useCart();
  const estimate = useShippingEstimate(cart.address);
  return (
    <CheckoutContext.Provider value={{ cart, estimate }}>
      {children}
    </CheckoutContext.Provider>
  );
}
\`\`\`

Every estimate refresh created a new \`{ cart, estimate }\` object, so every \`useCheckout()\` consumer re-rendered, including each \`CartLineItem\`. I split the context in two and memoized the values:

\`\`\`tsx
const CartContext = createContext<Cart | null>(null);
const EstimateContext = createContext<ShippingEstimate | null>(null);

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const cart = useCart();
  const estimate = useShippingEstimate(cart.address);
  return (
    <CartContext.Provider value={cart}>
      <EstimateContext.Provider value={estimate}>{children}</EstimateContext.Provider>
    </CartContext.Provider>
  );
}

export function useCartContext(): Cart {
  const cart = useContext(CartContext);
  if (cart === null) {
    throw new Error("useCartContext must be used inside CheckoutProvider");
  }
  return cart;
}

export function useEstimateContext(): ShippingEstimate {
  const estimate = useContext(EstimateContext);
  if (estimate === null) {
    throw new Error("useEstimateContext must be used inside CheckoutProvider");
  }
  return estimate;
}
\`\`\`

\`useCart()\` already returns a referentially stable object from the store selector, so no extra \`useMemo\` was needed there. \`useShippingEstimate\` returns the React Query \`data\`, which is structurally shared.

Then I updated the consumers:

| Component | Before | After | Reads |
| :-- | :-- | :-- | :-- |
| \`CartLineItem\` | \`useCheckout()\` | \`useCartContext()\` | cart |
| \`CartSummary\` | \`useCheckout()\` | both hooks | cart, estimate |
| \`ShippingOptions\` | \`useCheckout()\` | \`useEstimateContext()\` | estimate |
| \`PlaceOrderButton\` | \`useCheckout()\` | \`useCartContext()\` | cart |
| \`PromoCodeField\` | \`useCheckout()\` | \`useCartContext()\` | cart |

After the change an estimate refresh commits **31 components** in 4 ms.

### Line items

\`CartLineItem\` also rebuilt its \`formatter\` on every render:

\`\`\`tsx
function CartLineItem({ line }: { line: CartLine }) {
  const formatter = new Intl.NumberFormat(line.locale, {
    style: "currency",
    currency: line.currency,
  });
  return (
    <li className="flex justify-between">
      <span>{line.title}</span>
      <span>{formatter.format(line.totalCents / 100)}</span>
    </li>
  );
}
\`\`\`

\`Intl.NumberFormat\` construction is surprisingly expensive (about 30 µs each here), and a 400-line order paid that on every render. I moved it to a small module-level cache keyed by \`locale|currency\`:

\`\`\`ts
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function currencyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = \`\${locale}|\${currency}\`;
  let formatter = currencyFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}
\`\`\`

## Verification

### Load test

I ran the existing k6 scenario against a local stack seeded with the large-cart fixture:

\`\`\`bash
docker compose -f infra/local/compose.yml up -d
pnpm --filter @acme/api seed:large-carts
k6 run infra/load/checkout-confirm.js --vus 50 --duration 5m
\`\`\`

\`\`\`text
     checks.........................: 100.00% ✓ 148212 ✗ 0
     http_req_duration..............: avg=182ms  min=41ms  med=164ms  max=1.02s  p(90)=260ms  p(95)=310ms
     http_req_failed................: 0.00%   ✓ 0      ✗ 74106
     iterations.....................: 74106   246.8/s
\`\`\`

For comparison, \`main\` on the same machine:

\`\`\`text
     http_req_duration..............: avg=1.41s  min=88ms  med=1.12s  max=9.8s   p(90)=2.3s   p(95)=2.8s
     http_req_failed................: 0.37%   ✓ 274    ✗ 73832
     iterations.....................: 31022   103.3/s
\`\`\`

The failures on \`main\` were all \`504\` from the gateway timeout while the scheduler blocked the event loop.

### CPU profile

Top self-time functions during the load test, before and after:

| Function | \`main\` self % | branch self % |
| :-- | --: | --: |
| \`Array.prototype.sort\` (retry queue) | 38.2 | 0.1 |
| \`JSON.parse\` | 14.1 | 7.2 |
| \`ZodObject._parse\` | 11.8 | 6.0 |
| \`Array.prototype.shift\` | 6.4 | 0.0 |
| \`siftDown\` | n/a | 0.4 |
| idle | 9.7 | 71.3 |

### Frontend

I profiled the checkout page with the React DevTools profiler and Chrome's performance panel with 4× CPU throttling:

- estimate refresh commit: 90 ms → 4 ms
- longest task while typing an address: 212 ms → 38 ms
- dropped frames during the 5 s estimate poll: 23 → 0

\`\`\`json
{
  "scenario": "checkout-estimate-poll",
  "throttling": "4x",
  "before": { "commitMs": 91.4, "components": 2398, "longestTaskMs": 212, "droppedFrames": 23 },
  "after": { "commitMs": 4.1, "components": 31, "longestTaskMs": 38, "droppedFrames": 0 }
}
\`\`\`

### Database

The retry worker also runs a claim query. I checked its plan to make sure the heap change did not shift load onto Postgres:

\`\`\`sql
EXPLAIN ANALYZE
SELECT id, payload, attempt
FROM webhook_deliveries
WHERE status = 'pending'
  AND next_attempt_at <= now()
ORDER BY next_attempt_at
LIMIT 500
FOR UPDATE SKIP LOCKED;
\`\`\`

\`\`\`text
Limit  (cost=0.43..612.18 rows=500 width=412) (actual time=0.041..1.912 rows=500 loops=1)
  ->  LockRows  (cost=0.43..48211.90 rows=39412 width=412) (actual time=0.040..1.861 rows=500 loops=1)
        ->  Index Scan using webhook_deliveries_pending_next_attempt_idx on webhook_deliveries
              (cost=0.43..47817.78 rows=39412 width=412) (actual time=0.031..1.402 rows=500 loops=1)
              Index Cond: (next_attempt_at <= now())
Planning Time: 0.211 ms
Execution Time: 1.954 ms
\`\`\`

It uses the partial index as expected.

## Rollout

I would ship this in two steps:

1. **Backend first** (retry queue + session store). Both are internal and have no API change. Watch these after deploy:
   - \`webhooks.retry_queue.depth\` should stay flat instead of sawtoothing
   - \`api.checkout_confirm.p95\` should drop below 400 ms
   - \`api.event_loop_lag.p99\` should stay under 50 ms
2. **Frontend second**. The context split changes the exported hooks, so any other package importing \`useCheckout()\` breaks at compile time. I searched the monorepo and found no imports outside \`apps/web\`, but \`useCheckout\` is still exported from \`apps/web/src/routes/checkout/index.ts\` for backwards compatibility and marked deprecated.

### Risks

- The heap changes iteration order only for jobs with **identical** \`nextAttemptAt\`, and the tie-breaker keeps insertion order, so observable ordering is unchanged. The stable-order test covers it.
- Deleting \`isValidSessionJson\` could break an out-of-tree script. I grepped \`scripts/\` and \`infra/\` and found none.
- Splitting the context means a component that reads both cart and estimate now subscribes to two contexts. That is fine for React, but a future refactor should not re-merge them "for simplicity".

## Follow-ups

- Add a property test for the heap: generate random \`schedule\`/\`takeDue\` interleavings and compare against a reference implementation that sorts a copy. I left a \`TODO\` in the test file with the seed strategy I would use.
- \`webhook_deliveries\` has 2.1M rows in the \`delivered\` state older than 30 days. They are never read. A nightly partition drop would shrink the table and its indexes by about 80%.
- The shipping estimate poll could pause while the tab is hidden; it currently keeps polling every 5 s in background tabs.
- \`CartSummary\` computes tax with \`Number\` arithmetic. It is correct for our current currencies because amounts are integer cents, but we should switch to a decimal type before adding currencies with three minor units.

Let me know if you want me to split this into separate PRs. The three changes are independent, so they review more easily apart, and the backend PR can merge first without waiting for frontend review.
`;
