export const dataAnalysis = `I looked at two weeks of request logs for the search endpoint to find out why p95 latency went up after the cache change on the 12th. The short answer is that the cache did not make anything slower. It made the fast requests faster and moved a slow minority of cold queries into a different part of the distribution, and the p95 now lands inside that slow group.

## Data

The sample covers March 1 to March 14, 18.4 million requests to \`GET /api/search\`, taken from the access logs with bot traffic removed. I dropped 0.3% of requests that timed out at the load balancer, because they have no server side latency and would have to be modeled separately.

For each day I computed the mean, the median, and the 95th percentile. The percentile is the usual nearest rank definition: for $n$ sorted latencies $x_{(1)} \\le \\dots \\le x_{(n)}$, the $p$-th percentile is $x_{(k)}$ with $k = \\lceil p \\cdot n \\rceil$.

| Day | Requests | Mean (ms) | p50 (ms) | p95 (ms) | Cache hit rate |
| :-- | --: | --: | --: | --: | --: |
| Mar 8 | 1,302,114 | 142 | 118 | 301 | n/a |
| Mar 9 | 1,188,650 | 139 | 116 | 296 | n/a |
| Mar 10 | 1,344,902 | 145 | 121 | 309 | n/a |
| Mar 11 | 1,361,277 | 144 | 120 | 305 | n/a |
| Mar 12 | 1,338,040 | 101 | 34 | 342 | 61% |
| Mar 13 | 1,352,811 | 96 | 29 | 351 | 64% |
| Mar 14 | 1,327,455 | 94 | 28 | 355 | 66% |

The mean dropped by about a third and the median by more than three quarters, while the p95 rose by roughly 15%. That combination is the signature of a distribution that became bimodal.

## Modeling the mixture

After the change a request is either a cache hit or a miss. If a hit latency follows a distribution $H$ and a miss latency follows $M$, and the hit rate is $h$, the overall distribution is the mixture

$$
F(x) = h \\cdot H(x) + (1 - h) \\cdot M(x).
$$

The mean of a mixture is the weighted mean of the components, which is why the average improved so clearly:

$$
\\mathbb{E}[X] = h \\cdot \\mu_H + (1 - h) \\cdot \\mu_M = 0.64 \\cdot 12 + 0.36 \\cdot 246 \\approx 96 \\text{ ms}.
$$

Percentiles do not mix that way. The p95 of the mixture is the value $q$ that solves $F(q) = 0.95$. Hits are almost all under 40 ms, so $H(q) \\approx 1$ for any $q$ in the range we care about, and the equation becomes

$$
0.64 + 0.36 \\cdot M(q) = 0.95 \\quad \\Rightarrow \\quad M(q) = \\frac{0.31}{0.36} \\approx 0.861.
$$

So the overall p95 is now the 86th percentile of the misses. Before the change every request was effectively a miss, and the p95 was the 95th percentile of that single population.

## Why misses got slower

If the misses behaved like the old traffic, the 86th percentile of misses would be about 240 ms and the overall p95 would have gone down. It went up because the miss population changed. The cache absorbs the popular queries, which were also the cheap ones: short queries with few terms that hit warm index segments. What is left in the miss group is dominated by long tail queries with many terms, filters, and rare tokens.

I split the misses by number of query terms to check this:

| Terms | Share of misses before | Share of misses after | p86 of misses (ms) |
| --: | --: | --: | --: |
| 1 | 38% | 11% | 88 |
| 2 | 29% | 22% | 164 |
| 3 | 18% | 27% | 297 |
| 4 | 9% | 23% | 402 |
| 5 or more | 6% | 17% | 611 |

The share of misses with three or more terms went from 33% to 67%. Those queries were always slow; the cache just removed the cheap requests that used to hide them in the percentile.

## A quick check of the arithmetic

The per term p86 values combine with the after shares into an approximate miss distribution. Treating each group as a point mass at its p86 is crude, but it lands in the right place:

$$
\\hat{q}_{0.86} \\approx \\sum_{t} w_t \\, q_t = 0.11 \\cdot 88 + 0.22 \\cdot 164 + 0.27 \\cdot 297 + 0.23 \\cdot 402 + 0.17 \\cdot 611 \\approx 330 \\text{ ms}.
$$

The observed overall p95 of 351 ms on March 13 is close to that estimate, and the gap is expected because the weighted sum of percentiles understates the percentile of a mixture with a heavy upper tail.

The query I used for the split, run against the log warehouse:

\`\`\`sql
SELECT
  LEAST(array_length(string_to_array(trim(q), ' '), 1), 5) AS terms,
  COUNT(*) AS misses,
  percentile_disc(0.86) WITHIN GROUP (ORDER BY latency_ms) AS p86
FROM search_requests
WHERE ts >= '2025-03-12' AND ts < '2025-03-15'
  AND cache_status = 'miss'
GROUP BY 1
ORDER BY 1;
\`\`\`

And the small script that reproduces the mixture percentile from the component samples, which is how I confirmed that the p95 increase is fully explained without any regression in the search backend:

\`\`\`python
import numpy as np

def mixture_percentile(hits, misses, hit_rate, p):
    rng = np.random.default_rng(7)
    n = 1_000_000
    from_hits = rng.random(n) < hit_rate
    sample = np.where(
        from_hits,
        rng.choice(hits, n),
        rng.choice(misses, n),
    )
    return np.percentile(sample, p * 100, method="inverted_cdf")

print(mixture_percentile(hits_mar13, misses_mar13, 0.64, 0.95))
\`\`\`

With the March 13 samples this prints 349 ms, within 2 ms of the observed value.

## How confident is this?

Two weeks is a short window, so I checked whether the before and after percentiles are distinguishable from ordinary day to day variation. I used a bootstrap over days rather than over requests, because requests on the same day share deploys, traffic mix, and index state, and treating them as independent would make the intervals far too narrow.

For $B$ bootstrap resamples of the seven days in each period, with $\\hat{\\theta}^{*}_{b}$ the p95 computed on resample $b$, the percentile interval at level $1 - \\alpha$ is

$$
\\left[\\, \\hat{\\theta}^{*}_{(\\lfloor B \\alpha / 2 \\rfloor)},\\ \\hat{\\theta}^{*}_{(\\lceil B (1 - \\alpha / 2) \\rceil)} \\,\\right].
$$

With $B = 10{,}000$ and $\\alpha = 0.05$ the intervals are:

| Period | p95 estimate (ms) | 95% interval (ms) | p50 estimate (ms) | 95% interval (ms) |
| :-- | --: | --: | --: | --: |
| Mar 1 to Mar 11 | 303 | 297 to 309 | 119 | 116 to 121 |
| Mar 12 to Mar 14 | 349 | 342 to 355 | 30 | 28 to 34 |

The intervals do not overlap for either statistic, so both the p95 increase and the median drop are real rather than noise. The after period has only three days, which is why its intervals are wider than the before period even though each day has a similar number of requests.

## Does the effect differ by region?

The cache is regional, and the hit rate depends on how concentrated the query mix is in each region. I repeated the split for the three regions that carry almost all of the traffic:

| Region | Share of traffic | Hit rate | p50 after (ms) | p95 before (ms) | p95 after (ms) |
| :-- | --: | --: | --: | --: | --: |
| us-east | 52% | 69% | 26 | 298 | 344 |
| eu-west | 31% | 62% | 31 | 307 | 358 |
| ap-southeast | 17% | 51% | 47 | 321 | 371 |

The pattern is the same everywhere. Every region got a much faster median and a somewhat slower p95. The region with the lowest hit rate shows the smallest median gain, which fits the mixture model: with a lower $h$ the median falls inside the miss component sooner.

There is one detail worth writing down. In ap-southeast the hit rate is close to one half, and for a mixture with $h \\approx 0.5$ the median sits right at the boundary between the two modes. Small daily changes in the hit rate move the median a lot there, so that region will look noisy on any dashboard that plots the median, even when nothing changed.

## Seasonality

The before period includes a weekend and the after period does not, so I checked whether weekday traffic alone explains any of the change. Weekday p95 before the change was 306 ms and weekend p95 was 297 ms. Removing the weekend from the before period moves its p95 up by 3 ms, which narrows the gap slightly but does not change the conclusion.

## Is anything actually worse for users?

For most users, no. The median user now waits 29 ms instead of 118 ms, and 64% of searches return from the cache. The users who are worse off are the ones whose queries were already slow, and they are not measurably slower than before: the p86 of three term misses was 291 ms in the week before the change and 297 ms after, which is within the day to day noise.

The one real regression I found is small. Cache misses now pay for a cache write, which adds about 4 ms at the median of misses. You can see it in the difference between $\\mu_M = 246$ ms after the change and 242 ms for comparable queries before it.

## What I would change

1. Stop alerting on the overall p95 for this endpoint and alert on the p95 of misses instead, since that is the population the backend actually serves.
2. Add the cache status as a dimension on the latency dashboard so the two modes are visible separately.
3. Look at the five or more term queries, which are 17% of misses and dominate the upper tail. Most of them come from the saved search feature, which sends every filter as a term, and moving those filters into structured parameters would let the index skip segments.
4. Make the cache write asynchronous, which removes the 4 ms regression on misses.

If you want a single number for the release notes, the fairest one is the median, which went from 118 ms to 29 ms. The p95 went up only because the cache changed which requests sit at the 95th percentile.
`;
