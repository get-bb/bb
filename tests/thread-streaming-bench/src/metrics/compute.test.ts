import { describe, expect, it } from "vitest";
import {
  apiPathTemplate,
  checkpointLatencies,
  diffPerformanceMetrics,
  nthOccurrence,
  percentile,
  selectCheckpoints,
  summarizeCpuProfile,
  summarizeFrames,
  summarizeLoafs,
  summarizeLongTasks,
  summarizeNetwork,
  type NetworkRequestInput,
} from "./compute.js";
import type { EmissionLogEvent } from "./emission-log.js";

describe("percentile", () => {
  it("interpolates between closest ranks without mutating the input", () => {
    const values = [40, 10, 30, 20];
    expect(percentile(values, 50)).toBe(25);
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(40);
    expect(percentile(values, 95)).toBeCloseTo(38.5);
    expect(values).toEqual([40, 10, 30, 20]);
  });

  it("returns null for an empty set and the value for a single sample", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
  });

  it("rejects percentiles outside 0..100", () => {
    expect(() => percentile([1], 101)).toThrow(RangeError);
    expect(() => percentile([1], -1)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});

describe("summarizeFrames", () => {
  it("summarizes rAF intervals and counts slow frames strictly over the thresholds", () => {
    const summary = summarizeFrames([0, 16, 33, 50, 100, 200]);
    expect(summary).toEqual({
      count: 6,
      durationMs: 200,
      p50IntervalMs: 17,
      p95IntervalMs: 90,
      maxIntervalMs: 100,
      framesOver25Ms: 2,
      framesOver50Ms: 1,
    });
  });

  it("reports absent intervals when fewer than two frames were observed", () => {
    expect(summarizeFrames([12])).toEqual({
      count: 1,
      durationMs: 0,
      p50IntervalMs: null,
      p95IntervalMs: null,
      maxIntervalMs: null,
      framesOver25Ms: 0,
      framesOver50Ms: 0,
    });
  });

  it("handles long runs without spreading every interval onto the stack", () => {
    const frames = Array.from({ length: 300_000 }, (_, index) => index * 16);
    const summary = summarizeFrames(frames);
    expect(summary.maxIntervalMs).toBe(16);
    expect(summary.count).toBe(300_000);
  });
});

describe("summarizeLoafs", () => {
  it("aggregates script attribution by source URL and function name", () => {
    const script = (
      sourceFunctionName: string,
      duration: number,
      invoker: string,
      sourceURL = "http://app/assets/index.js",
    ) => ({
      duration,
      invoker,
      sourceURL,
      sourceFunctionName,
      forcedStyleAndLayoutDuration: 2,
    });
    const summary = summarizeLoafs(
      [
        {
          duration: 120,
          blockingDuration: 70,
          scripts: [
            script("renderMarkdown", 60, "FrameRequestCallback"),
            script("", 10, "Response.json.then"),
          ],
        },
        {
          duration: 80,
          blockingDuration: 30,
          scripts: [
            script("renderMarkdown", 70, "MessagePort.onmessage"),
            script(
              "parse",
              5,
              "TimerHandler:setTimeout",
              "http://app/assets/vendor.js",
            ),
          ],
        },
      ],
      { top: 2 },
    );
    expect(summary.count).toBe(2);
    expect(summary.totalDurationMs).toBe(200);
    expect(summary.totalBlockingDurationMs).toBe(100);
    expect(summary.maxDurationMs).toBe(120);
    expect(summary.topScripts).toEqual([
      {
        sourceURL: "http://app/assets/index.js",
        functionName: "renderMarkdown",
        invoker: "MessagePort.onmessage",
        count: 2,
        totalDurationMs: 130,
        maxDurationMs: 70,
        forcedStyleAndLayoutMs: 4,
      },
      {
        sourceURL: "http://app/assets/index.js",
        functionName: "(anonymous)",
        invoker: "Response.json.then",
        count: 1,
        totalDurationMs: 10,
        maxDurationMs: 10,
        forcedStyleAndLayoutMs: 2,
      },
    ]);
  });

  it("returns an empty summary without long animation frames", () => {
    expect(summarizeLoafs([])).toEqual({
      count: 0,
      totalDurationMs: 0,
      totalBlockingDurationMs: 0,
      maxDurationMs: null,
      topScripts: [],
    });
  });
});

describe("summarizeLongTasks", () => {
  it("computes total blocking time from the portion over 50 ms", () => {
    expect(
      summarizeLongTasks([
        [0, 50],
        [100, 51],
        [300, 250],
      ]),
    ).toEqual({ count: 3, totalMs: 351, maxMs: 250, totalBlockingTimeMs: 201 });
    expect(summarizeLongTasks([])).toEqual({
      count: 0,
      totalMs: 0,
      maxMs: null,
      totalBlockingTimeMs: 0,
    });
  });
});

describe("diffPerformanceMetrics", () => {
  const before = {
    TaskDuration: 1.25,
    ScriptDuration: 0.5,
    LayoutDuration: 0.125,
    RecalcStyleDuration: 0.0625,
    LayoutCount: 10,
    RecalcStyleCount: 20,
    JSHeapUsedSize: 5_000_000,
    Nodes: 100,
  };

  it("converts duration deltas from seconds to milliseconds and keeps counts", () => {
    const after = {
      ...before,
      TaskDuration: 2.5,
      ScriptDuration: 1,
      LayoutDuration: 0.25,
      RecalcStyleDuration: 0.125,
      LayoutCount: 42,
      RecalcStyleCount: 25,
      JSHeapUsedSize: 4_500_000,
    };
    expect(diffPerformanceMetrics(before, after)).toEqual({
      taskDurationMs: 1250,
      scriptDurationMs: 500,
      layoutDurationMs: 125,
      recalcStyleDurationMs: 62.5,
      layoutCount: 32,
      recalcStyleCount: 5,
      jsHeapUsedSizeBytes: -500_000,
    });
  });

  it("names the missing metric and snapshot", () => {
    const { LayoutCount: _layoutCount, ...withoutLayoutCount } = before;
    expect(() => diffPerformanceMetrics(before, withoutLayoutCount)).toThrow(
      "Performance metric LayoutCount is missing from the after snapshot",
    );
  });
});

const MIXED_MARKDOWN = [
  "# Streaming render investigation",
  "",
  "The first paragraph explains how the renderer handles incoming deltas from the provider bridge.",
  "",
  "## Findings",
  "",
  "- The timeline cache keeps every completed row warm between polls.",
  "- Short item.",
  "1. Numbered steps also render their words verbatim inside list items.",
  "   - Nested bullets keep their plain words intact as well here.",
  "",
  "| Column | Value |",
  "| --- | --- |",
  "| rows | many words in a table cell that should never count |",
  "",
  "```ts",
  'const paragraph = "this code block text must never be selected as a checkpoint";',
  "",
  "the blank line above does not end the fence so this line is still code",
  "```",
  "",
  "Run `pnpm test` before you merge the branch into main today.",
  "",
  "This paragraph mentions **bold text** and only the plain words after it count.",
  "",
  "See [the docs](http://example.com/docs) now.",
  "",
  "> A quoted paragraph should be skipped because blockquote markers change text.",
  "",
  "A paragraph that wraps across",
  "two lines keeps only the final line of words for matching.",
  "",
  "Setext Heading Candidate With Many Words In It Here",
  "---------------------------------------------------",
  "",
  "    indented code block with enough words to look like a paragraph",
  "",
  "$$",
  "x equals y plus z and some other words in display math here",
  "$$",
  "",
  "The final paragraph closes the document with a clear ending sentence.",
  "",
].join("\n");

describe("selectCheckpoints", () => {
  it("selects verbatim plain-text tails of paragraphs and list items after the last inline syntax", () => {
    const checkpoints = selectCheckpoints(MIXED_MARKDOWN);
    expect(checkpoints).toEqual([
      "how the renderer handles incoming deltas from the provider bridge.",
      "The timeline cache keeps every completed row warm between polls.",
      "Numbered steps also render their words verbatim inside list items.",
      "Nested bullets keep their plain words intact as well here.",
      "before you merge the branch into main today.",
      "and only the plain words after it count.",
      "lines keeps only the final line of words for matching.",
      "final paragraph closes the document with a clear ending sentence.",
    ]);
    let previousOffset = -1;
    for (const phrase of checkpoints) {
      const offset = MIXED_MARKDOWN.indexOf(phrase);
      expect(offset).toBeGreaterThan(previousOffset);
      expect(MIXED_MARKDOWN.indexOf(phrase, offset + 1)).toBe(-1);
      const words = phrase.split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(6);
      expect(words.length).toBeLessThanOrEqual(10);
      previousOffset = offset;
    }
  });

  it("excludes tails from fenced code even when the fence contains blank lines", () => {
    const checkpoints = selectCheckpoints(MIXED_MARKDOWN);
    expect(checkpoints.some((phrase) => phrase.includes("still code"))).toBe(
      false,
    );
    expect(checkpoints.some((phrase) => phrase.includes("display math"))).toBe(
      false,
    );
    expect(checkpoints.some((phrase) => phrase.includes("Many Words"))).toBe(
      false,
    );
    expect(checkpoints.some((phrase) => phrase.includes("indented code"))).toBe(
      false,
    );
  });

  it("thins long documents to roughly 20-40 checkpoints and always keeps the final paragraph", () => {
    const paragraphs = Array.from(
      { length: 100 },
      (_, index) =>
        `Paragraph ${index + 1} walks through streaming detail number ${index + 1} for this benchmark.`,
    );
    const document = paragraphs.join("\n\n");
    const checkpoints = selectCheckpoints(document);
    expect(checkpoints.length).toBeGreaterThanOrEqual(20);
    expect(checkpoints.length).toBeLessThanOrEqual(40);
    expect(checkpoints.at(-1)).toBe(
      "100 walks through streaming detail number 100 for this benchmark.",
    );
    expect(selectCheckpoints(document, { every: 10 })).toHaveLength(10);
    expect(() => selectCheckpoints(document, { every: 0 })).toThrow(RangeError);
  });

  it("lists repeated phrases once per occurrence for repeated documents", () => {
    const single = selectCheckpoints(MIXED_MARKDOWN);
    const repeated = [MIXED_MARKDOWN, MIXED_MARKDOWN].join("\n\n");
    expect(selectCheckpoints(repeated)).toEqual([...single, ...single]);
  });

  it("skips a partial first word glued to inline syntax", () => {
    expect(
      selectCheckpoints(
        "Use `pnpm`s cache so every later install reuses the same store.",
      ),
    ).toEqual(["cache so every later install reuses the same store."]);
  });

  it("skips text that never renders in place: HTML blocks, comments, definitions and list fences", () => {
    const document = [
      "Opening paragraph with plain words to anchor the checkpoint list.",
      "",
      "<!--",
      "a hidden comment line with many plain words inside it",
      "",
      "-->",
      "",
      "<div>",
      "plain words that live inside an html block and are raw",
      "",
      "<pre>",
      "preformatted text that has plenty of plain words in it",
      "",
      "more preformatted text that continues after a blank line here",
      "</pre>",
      "",
      "[foo]: http://example.com/path",
      '  "a long title with many plain words to count here"',
      "",
      "[^1]: A footnote that begins here",
      "continued footnote paragraph with lots of plain words",
      "",
      "- ```bash",
      "  echo this code line has many plain words in it now",
      "",
      "  echo and the fence keeps going after a blank line too",
      "  ```",
      "",
      "Closing paragraph with plain words that should still be reachable.",
    ].join("\n");
    expect(selectCheckpoints(document, { every: 1 })).toEqual([
      "Opening paragraph with plain words to anchor the checkpoint list.",
      "Closing paragraph with plain words that should still be reachable.",
    ]);
  });

  it("drops a phrase whose words render earlier through inline markup", () => {
    const document = [
      "alpha **beta** gamma delta epsilon zeta eta theta",
      "",
      "[one two](http://example.com/x) three four five six seven eight",
      "",
      "Some other plain paragraph that separates both of these lines.",
      "",
      "alpha beta gamma delta epsilon zeta eta theta",
      "",
      "one two three four five six seven eight",
    ].join("\n");
    expect(selectCheckpoints(document, { every: 1 })).toEqual([
      "gamma delta epsilon zeta eta theta",
      "three four five six seven eight",
      "Some other plain paragraph that separates both of these lines.",
    ]);
  });

  it("drops a tail whose earlier occurrence would be matched first", () => {
    const document = [
      "```text",
      "the same closing words appear inside this code block first",
      "```",
      "",
      "Here is a paragraph where the same closing words appear inside this code block first",
      "",
      "Another ordinary paragraph gives the selector something safe to keep.",
    ].join("\n");
    expect(selectCheckpoints(document)).toEqual([
      "Another ordinary paragraph gives the selector something safe to keep.",
    ]);
  });

  it("thins by unique phrase so a kept phrase keeps every occurrence", () => {
    const repeatedTail =
      "This sentence repeats verbatim in two different paragraphs.";
    const document = [
      "Opening paragraph that thinning drops before the repeated sentence.",
      repeatedTail,
      "Middle paragraph that thinning also drops between the repeats.",
      repeatedTail,
      "Closing paragraph that thinning keeps as the final checkpoint.",
    ].join("\n\n");
    expect(selectCheckpoints(document, { every: 1 })).toHaveLength(5);
    expect(selectCheckpoints(document, { every: 2 })).toEqual([
      repeatedTail,
      repeatedTail,
      "Closing paragraph that thinning keeps as the final checkpoint.",
    ]);
  });

  it("keeps repeated documents near the target count when the repeat does not align with thinning", () => {
    const paragraphs = Array.from(
      { length: 34 },
      (_, index) =>
        `Paragraph ${index + 1} walks through streaming detail number ${index + 1} for this benchmark.`,
    );
    const document = Array.from({ length: 4 }, () =>
      paragraphs.join("\n\n"),
    ).join("\n\n");
    const checkpoints = selectCheckpoints(document);
    expect(checkpoints).toHaveLength(36);
    expect(new Set(checkpoints).size).toBe(9);
    expect(checkpoints.at(-1)).toBe(
      "34 walks through streaming detail number 34 for this benchmark.",
    );
  });
});

describe("nthOccurrence", () => {
  it("finds non-overlapping occurrences in order", () => {
    expect(nthOccurrence("abc abc abc", "abc", 1)).toBe(0);
    expect(nthOccurrence("abc abc abc", "abc", 3)).toBe(8);
    expect(nthOccurrence("abc abc abc", "abc", 4)).toBe(-1);
    expect(nthOccurrence("aaaa", "aa", 2)).toBe(2);
  });
});

describe("checkpointLatencies", () => {
  const fixtureText =
    "Alpha beta gamma delta.\n\nEpsilon zeta eta theta.\n\nIota kappa lambda mu.";
  const emissionLog: EmissionLogEvent[] = [
    {
      event: "start",
      t: 1000,
      doc: "greek",
      docChars: 71,
      chunk: 20,
      interval: 30,
    },
    { event: "delta", t: 1030, chars: 20 },
    { event: "delta", t: 1060, chars: 40 },
    { event: "delta", t: 1090, chars: 60 },
    { event: "delta", t: 1120, chars: 71 },
    { event: "complete", t: 1125 },
  ];
  const checkpoints = ["gamma delta.", "eta theta.", "lambda mu."];

  it("joins each phrase's source end offset with the first delta that emitted it", () => {
    const summary = checkpointLatencies({
      fixtureText,
      checkpoints,
      emissionLog,
      hits: [1075, 1130],
    });
    expect(summary.checkpoints).toEqual([
      {
        index: 0,
        phrase: "gamma delta.",
        sourceEndOffset: 23,
        emissionOffset: 23,
        emittedAtEpochMs: 1060,
        hitAtEpochMs: 1075,
        latencyMs: 15,
      },
      {
        index: 1,
        phrase: "eta theta.",
        sourceEndOffset: 48,
        emissionOffset: 48,
        emittedAtEpochMs: 1090,
        hitAtEpochMs: 1130,
        latencyMs: 40,
      },
      {
        index: 2,
        phrase: "lambda mu.",
        sourceEndOffset: 71,
        emissionOffset: 71,
        emittedAtEpochMs: 1120,
        hitAtEpochMs: null,
        latencyMs: null,
      },
    ]);
    expect(summary.hitCount).toBe(2);
    expect(summary.missedCount).toBe(1);
    expect(summary.negativeLatencyCount).toBe(0);
    expect(summary.p50LatencyMs).toBe(27.5);
    expect(summary.p95LatencyMs).toBeCloseTo(38.75);
    expect(summary.maxLatencyMs).toBe(40);
  });

  it("gates emission on the newline that makes a line visible", () => {
    const summary = checkpointLatencies({
      fixtureText,
      checkpoints,
      emissionLog,
      gate: "newline",
      hits: [1100, 1130, 1140],
    });
    expect(
      summary.checkpoints.map((row) => [
        row.emissionOffset,
        row.emittedAtEpochMs,
        row.latencyMs,
      ]),
    ).toEqual([
      [24, 1060, 40],
      [49, 1090, 40],
      [71, 1125, 15],
    ]);
  });

  it("counts hits that precede their emission as anomalies and keeps them out of the aggregates", () => {
    const summary = checkpointLatencies({
      fixtureText,
      checkpoints,
      emissionLog,
      hits: [1050, 1130, 1150],
    });
    expect(summary.checkpoints.map((row) => row.latencyMs)).toEqual([
      -10, 40, 30,
    ]);
    expect(summary.negativeLatencyCount).toBe(1);
    expect(summary.hitCount).toBe(3);
    expect(summary.p50LatencyMs).toBe(35);
    expect(summary.maxLatencyMs).toBe(40);
  });

  it("uses the delta whose cumulative chars land exactly on the offset", () => {
    const summary = checkpointLatencies({
      fixtureText: "0123456789 exact end",
      checkpoints: ["exact end"],
      emissionLog: [
        { event: "delta", t: 10, chars: 19 },
        { event: "delta", t: 20, chars: 20 },
        { event: "delta", t: 30, chars: 20 },
      ],
      hits: [25],
    });
    expect(summary.checkpoints[0]?.emittedAtEpochMs).toBe(20);
    expect(summary.checkpoints[0]?.latencyMs).toBe(5);
  });

  it("leaves emission absent when the log never reached the phrase", () => {
    const truncated = emissionLog.filter(
      (event) => event.event !== "delta" || event.chars <= 60,
    );
    const summary = checkpointLatencies({
      fixtureText,
      checkpoints,
      emissionLog: truncated,
      hits: [1075, 1130, 1200],
    });
    expect(summary.checkpoints[2]).toMatchObject({
      emittedAtEpochMs: null,
      hitAtEpochMs: 1200,
      latencyMs: null,
    });
    expect(summary.hitCount).toBe(3);
    expect(summary.maxLatencyMs).toBe(40);
  });

  it("maps repeated phrases to successive occurrences of the repeated document", () => {
    const doc = "Alpha beta gamma delta.";
    const summary = checkpointLatencies({
      fixtureText: `${doc}\n\n${doc}`,
      checkpoints: ["gamma delta.", "gamma delta."],
      emissionLog: [
        { event: "delta", t: 100, chars: 30 },
        { event: "delta", t: 200, chars: 48 },
      ],
      hits: [150, 260],
    });
    expect(summary.checkpoints.map((row) => row.sourceEndOffset)).toEqual([
      23, 48,
    ]);
    expect(summary.checkpoints.map((row) => row.latencyMs)).toEqual([50, 60]);
  });

  it("rejects inputs that cannot be joined", () => {
    expect(() =>
      checkpointLatencies({
        fixtureText,
        checkpoints,
        emissionLog: [...emissionLog, ...emissionLog],
        hits: [],
      }),
    ).toThrow("expects one emission run, received 2 start events");
    expect(() =>
      checkpointLatencies({
        fixtureText,
        checkpoints: ["not in the text"],
        emissionLog,
        hits: [],
      }),
    ).toThrow("does not appear in the fixture text");
    expect(() =>
      checkpointLatencies({
        fixtureText,
        checkpoints: ["gamma delta."],
        emissionLog,
        hits: [1, 2],
      }),
    ).toThrow("Received 2 checkpoint hits for 1 checkpoints");
    expect(() =>
      checkpointLatencies({
        fixtureText,
        checkpoints,
        emissionLog: [
          { event: "delta", t: 1, chars: 40 },
          { event: "delta", t: 2, chars: 20 },
        ],
        hits: [],
      }),
    ).toThrow("has 20 cumulative chars after 40");
  });
});

describe("apiPathTemplate", () => {
  it("replaces the bench thread id and generated ids, keeping literal segments", () => {
    expect(
      apiPathTemplate(
        "/api/v1/threads/thr_d7746tynyd/timeline",
        "thr_d7746tynyd",
      ),
    ).toBe("/api/v1/threads/:threadId/timeline");
    expect(
      apiPathTemplate(
        "/api/v1/projects/proj_a2b3c4d5e6/threads",
        "thr_d7746tynyd",
      ),
    ).toBe("/api/v1/projects/:id/threads");
    expect(
      apiPathTemplate(
        "/api/v1/file-previews/0b4f5a4e-8a07-4c55-9d40-1f7f1f0b9c3e/readme.md",
        "thr_d7746tynyd",
      ),
    ).toBe("/api/v1/file-previews/:uuid/readme.md");
    expect(
      apiPathTemplate(
        "/api/v1/plugins/bench-stream/assets/app.js",
        "thr_d7746tynyd",
      ),
    ).toBe("/api/v1/plugins/bench-stream/assets/app.js");
    expect(apiPathTemplate("/api/v1/events/42", "thr_d7746tynyd")).toBe(
      "/api/v1/events/:n",
    );
  });
});

describe("summarizeNetwork", () => {
  const threadId = "thr_d7746tynyd";
  const base = "http://127.0.0.1:4100/api/v1";
  const finished = (
    url: string,
    bytes: number,
    durationMs: number,
    method = "GET",
  ): NetworkRequestInput => ({
    url,
    method,
    outcome: "finished",
    encodedDataLength: bytes,
    durationMs,
  });

  it("splits timeline GETs into delta, full and older-page requests", () => {
    const summary = summarizeNetwork(
      {
        requests: [
          finished(`${base}/threads/${threadId}/timeline`, 1200, 30),
          finished(
            `${base}/threads/${threadId}/timeline?afterSequence=10`,
            300,
            10,
          ),
          finished(
            `${base}/threads/${threadId}/timeline?afterSequence=12&segmentLimit=8`,
            200,
            20,
          ),
          finished(
            `${base}/threads/${threadId}/timeline?beforeAnchorId=evt_a2b3c4d5e6&beforeAnchorSeq=5`,
            5000,
            50,
          ),
          {
            url: `${base}/threads/${threadId}/timeline?afterSequence=13`,
            method: "GET",
            outcome: "pending",
            encodedDataLength: null,
            durationMs: null,
          },
          finished(`${base}/threads/thr_a2b3c4d5e6/timeline`, 900, 25),
          finished(
            `${base}/threads/${threadId}/timeline/turn-summary-details?turnId=t1`,
            80,
            4,
          ),
          finished(`${base}/threads/${threadId}/read`, 40, 3, "POST"),
          finished(`${base}/threads/${threadId}/read`, 40, 5, "POST"),
          {
            url: `${base}/threads/${threadId}/read`,
            method: "POST",
            outcome: "failed",
            encodedDataLength: null,
            durationMs: 7,
          },
        ],
        webSocketFramesReceived: 17,
        webSocketBytesReceived: 4096,
      },
      threadId,
    );
    expect(summary.timeline.afterSequence).toEqual({
      count: 3,
      finishedCount: 2,
      failedCount: 0,
      bytes: 500,
      p50Ms: 15,
      p95Ms: 19.5,
      maxMs: 20,
    });
    expect(summary.timeline.full).toMatchObject({
      count: 1,
      bytes: 1200,
      p50Ms: 30,
    });
    expect(summary.timeline.olderPage).toMatchObject({
      count: 1,
      bytes: 5000,
      maxMs: 50,
    });
    expect(summary.timeline.total).toMatchObject({
      count: 5,
      finishedCount: 4,
      bytes: 6700,
    });
    expect(summary.otherApi).toEqual([
      {
        method: "POST",
        pathTemplate: "/api/v1/threads/:threadId/read",
        count: 3,
        finishedCount: 2,
        failedCount: 1,
        bytes: 80,
        p50Ms: 4,
        p95Ms: 4.9,
        maxMs: 5,
      },
      {
        method: "GET",
        pathTemplate: "/api/v1/threads/:id/timeline",
        count: 1,
        finishedCount: 1,
        failedCount: 0,
        bytes: 900,
        p50Ms: 25,
        p95Ms: 25,
        maxMs: 25,
      },
      {
        method: "GET",
        pathTemplate: "/api/v1/threads/:threadId/timeline/turn-summary-details",
        count: 1,
        finishedCount: 1,
        failedCount: 0,
        bytes: 80,
        p50Ms: 4,
        p95Ms: 4,
        maxMs: 4,
      },
    ]);
    expect(summary.webSocket).toEqual({
      framesReceived: 17,
      bytesReceived: 4096,
    });
  });
});

describe("summarizeCpuProfile", () => {
  const callFrame = (functionName: string, url = "", lineNumber = 0) => ({
    functionName,
    url,
    lineNumber,
    columnNumber: 0,
  });
  const nodes = [
    { id: 1, callFrame: callFrame("(root)"), hitCount: 0 },
    { id: 2, callFrame: callFrame("(program)"), hitCount: 1 },
    { id: 3, callFrame: callFrame("(idle)"), hitCount: 1 },
    {
      id: 4,
      callFrame: callFrame("renderMarkdown", "http://app/a.js", 10),
      hitCount: 3,
    },
    {
      id: 5,
      callFrame: callFrame("parseDelta", "http://app/b.js", 20),
      hitCount: 1,
    },
    { id: 6, callFrame: callFrame("(garbage collector)"), hitCount: 1 },
    { id: 7, callFrame: callFrame("", "http://app/c.js", 30), hitCount: 1 },
  ];

  it("attributes sample durations as self time and separates idle, program and GC", () => {
    const summary = summarizeCpuProfile(
      {
        nodes,
        startTime: 0,
        endTime: 8100,
        samples: [4, 4, 5, 3, 2, 6, 4, 7],
        timeDeltas: [100, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
      },
      { top: 2 },
    );
    expect(summary).toEqual({
      durationMs: 8.1,
      sampleCount: 8,
      idleMs: 1,
      programMs: 1,
      garbageCollectorMs: 1,
      top: [
        {
          functionName: "renderMarkdown",
          url: "http://app/a.js",
          lineNumber: 10,
          columnNumber: 0,
          selfMs: 3,
        },
        {
          functionName: "parseDelta",
          url: "http://app/b.js",
          lineNumber: 20,
          columnNumber: 0,
          selfMs: 1,
        },
      ],
    });
  });

  it("falls back to hit counts when samples are absent", () => {
    const summary = summarizeCpuProfile({ nodes, startTime: 0, endTime: 8000 });
    expect(summary.sampleCount).toBe(8);
    expect(summary.top[0]).toMatchObject({
      functionName: "renderMarkdown",
      selfMs: 3,
    });
    expect(summary.top.map((entry) => entry.functionName)).toContain(
      "(anonymous)",
    );
  });
});
