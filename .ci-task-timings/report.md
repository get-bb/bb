## Turbo task cache and timing

1 run summaries; 0 cache hits, 7 misses, 0 unknown statuses.
0 repeated executions of the same task/hash after a cache miss.
Skipped 0 duplicate summaries, 0 invalid summaries and 0 invalid tasks.

Durations sum task intervals, including cache replay, and are not job wall time. Missing intervals are excluded. Repeated misses are candidates for investigation; intentionally uncached tasks also appear. Only explicit Turbo HIT/MISS statuses count. Repeated invocations in distinct runs remain counted; copied summaries and duplicate entries within a run do not.

Top 30 task/hash groups by cache-miss duration:

| Task | Hash | Hits | Misses | Unknown | Timed / total | Miss seconds | Repeated misses |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| @bb/scripts#test | cce1e24906872eea | 0 | 1 | 0 | 1 / 1 | 1.26 | 0 |
| @bb/plugin-build#generate | 39e3b1ac63842101 | 0 | 1 | 0 | 1 / 1 | 0.83 | 0 |
| //#ensure-native-modules | ebe02aa1947f1bb0 | 0 | 1 | 0 | 1 / 1 | 0.70 | 0 |
| @bb/process-utils#generate:profile-worker | 471d88fe0fecd694 | 0 | 1 | 0 | 1 / 1 | 0.58 | 0 |
| @bb/cli#build | 394a5324433a1e32 | 0 | 1 | 0 | 1 / 1 | 0.30 | 0 |
| @bb/templates#generate:templates | 3a297566667c70e4 | 0 | 1 | 0 | 1 / 1 | 0.18 | 0 |
| @bb/templates#generate:plugin-scaffold | 27f008377f954a48 | 0 | 1 | 0 | 1 / 1 | 0.14 | 0 |
