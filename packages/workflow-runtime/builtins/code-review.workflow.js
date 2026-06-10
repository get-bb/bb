// Built-in `code-review` workflow: one finder agent per review angle, an
// independent verifier per candidate finding (CONFIRMED / PLAUSIBLE / REFUTED),
// a gap-sweep at the higher levels, then a ranked, capped report.
// Run with: bb workflow run code-review [--args '{"target": "<ref|path|diff>", "level": "high|xhigh|max"}']

export const meta = {
  name: "code-review",
  description:
    "Multi-agent code review — one finder per angle, independent verification of every finding, gap-sweep at higher levels, ranked report.",
  defaultSandbox: "read-only",
  phases: [
    { title: "Review", detail: "one finder agent per review angle" },
    { title: "Verify", detail: "independent verifier per candidate finding" },
    {
      title: "Sweep",
      detail: "hunt for what the angle reviewers missed (xhigh/max)",
    },
    {
      title: "Report",
      detail: "rank, cap, and write up the confirmed findings",
    },
  ],
};

// Review angles in priority order; each level takes a prefix and scales the caps.
const ANGLES = [
  "correctness — logic errors, wrong conditions, off-by-ones, broken control flow",
  "security — injection, traversal, unsafe deserialization, secrets, authz gaps",
  "error-handling — swallowed errors, missing edge/null cases, bad failure modes",
  "resource-handling — leaks, missing cleanup, unbounded growth, races on shutdown",
  "concurrency — data races, missing awaits, ordering assumptions, deadlocks",
  "api-contracts — breaking changes, type mismatches, violated invariants between modules",
  "performance — accidental O(n²), needless I/O in loops, oversized payloads",
  "test-gaps — changed behavior with no covering test, tests asserting the wrong thing",
];

const LEVEL_PARAMS = {
  high: { angles: 4, maxPerAngle: 8, maxReport: 10, gapSweep: false },
  xhigh: { angles: 6, maxPerAngle: 10, maxReport: 20, gapSweep: true },
  max: { angles: 8, maxPerAngle: 12, maxReport: 30, gapSweep: true },
};

const level =
  args && typeof args === "object" && typeof args.level === "string"
    ? args.level
    : "high";
const params = LEVEL_PARAMS[level];
if (!params)
  throw new Error(
    `unknown level "${level}" — expected one of: ${Object.keys(LEVEL_PARAMS).join(", ")}`,
  );

const target =
  args &&
  typeof args === "object" &&
  typeof args.target === "string" &&
  args.target.trim()
    ? args.target.trim()
    : "the uncommitted changes in this repository (git diff HEAD; if empty, review the most recent commit)";

const angles = ANGLES.slice(0, params.angles);

const FINDING_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "title", "why", "severity"],
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          title: { type: "string" },
          why: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["verdict", "reason"],
  properties: {
    verdict: { type: "string", enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
    reason: { type: "string" },
  },
};

// Each candidate gets an independent verifier; CONFIRMED/PLAUSIBLE survive, REFUTED dies.
const verify = (finding) =>
  agent(
    `You are a skeptical senior reviewer double-checking one flagged issue in ${target}. ` +
      `Read the actual code before judging. Verdicts:\n` +
      `- CONFIRMED: you reproduced the reasoning against the real code and the issue is real.\n` +
      `- PLAUSIBLE: you could not refute it, but could not fully confirm it from the code either.\n` +
      `- REFUTED: false positive — mis-read code, already handled, intended behavior, or not present.\n` +
      `Default toward REFUTED when the finding is vague or you cannot locate the code it describes.\n\n` +
      `Finding (JSON):\n${JSON.stringify(finding, null, 2)}`,
    {
      label: `verify: ${finding.title.slice(0, 40)}`,
      phase: "Verify",
      schema: VERDICT_SCHEMA,
    },
  ).then((v) =>
    v.verdict === "REFUTED"
      ? null
      : { ...finding, verdict: v.verdict, verdictReason: v.reason },
  );

// ---------------------------------------------------------------------------
// Review + Verify — pipeline: each angle's findings go to verification as soon
// as that finder returns, while slower finders are still reading.
// ---------------------------------------------------------------------------
phase("Review");
log(`reviewing ${target} at level ${level}: ${angles.length} angles`);

const verifiedByAngle = await pipeline(
  angles,
  (angle) =>
    agent(
      `Review ${target} strictly through this lens:\n${angle}\n\n` +
        `Read the relevant code (and surrounding context) rather than judging from the diff text ` +
        `alone. Report up to ${params.maxPerAngle} concrete findings: file, line when you can ` +
        `pinpoint it, a short title, why it is a real problem through this lens, and a severity ` +
        `(critical|high|medium|low). Only report issues you can point to in the code — no ` +
        `speculation, no style nits.`,
      {
        label: `find: ${angle.split(" — ")[0]}`,
        phase: "Review",
        schema: FINDING_SCHEMA,
      },
    ),
  (review, angle) =>
    parallel(
      (review.findings || [])
        .slice(0, params.maxPerAngle)
        .map((f) => () => verify({ ...f, angle: angle.split(" — ")[0] })),
    ),
);

let confirmed = verifiedByAngle.filter(Boolean).flat().filter(Boolean);
log(`${confirmed.length} findings survived verification`);

// ---------------------------------------------------------------------------
// Sweep (xhigh/max) — one agent hunts for what the per-angle reviewers missed;
// its candidates go through the same verifier.
// ---------------------------------------------------------------------------
if (params.gapSweep) {
  phase("Sweep");
  const sweep = await agent(
    `You are the final gap-sweep on a multi-agent review of ${target}. The angles already ` +
      `covered: ${angles.map((a) => a.split(" — ")[0]).join(", ")}. Findings already confirmed ` +
      `(do NOT re-report these):\n${JSON.stringify(
        confirmed.map((f) => ({ file: f.file, title: f.title })),
        null,
        2,
      )}\n\n` +
      `Look for what they missed: cross-cutting issues, interactions between changes, anything in ` +
      `the changed code that no single angle would catch. Up to ${params.maxPerAngle} findings, ` +
      `same bar: concrete, code-anchored, no nits.`,
    { label: "gap-sweep", phase: "Sweep", schema: FINDING_SCHEMA },
  );
  const sweepVerified = await parallel(
    (sweep.findings || [])
      .slice(0, params.maxPerAngle)
      .map((f) => () => verify({ ...f, angle: "gap-sweep" })),
  );
  confirmed = confirmed.concat(sweepVerified.filter(Boolean));
  log(`${confirmed.length} findings after gap-sweep`);
}

// ---------------------------------------------------------------------------
// Report — rank (CONFIRMED before PLAUSIBLE, then severity), cap, write up.
// ---------------------------------------------------------------------------
phase("Report");

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const ranked = confirmed
  .slice()
  .sort(
    (a, b) =>
      (a.verdict === b.verdict ? 0 : a.verdict === "CONFIRMED" ? -1 : 1) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.file.localeCompare(b.file),
  );
const findings = ranked.slice(0, params.maxReport);
if (ranked.length > findings.length)
  log(`reporting top ${params.maxReport} of ${ranked.length} findings (cap)`);

if (findings.length === 0) {
  return {
    findings: [],
    report: `Reviewed ${target} across ${angles.length} angles at level ${level}: no findings survived independent verification.`,
  };
}

const report = await agent(
  `Write a concise code-review report for ${target}. The findings below are already independently ` +
    `verified and ranked — keep that order. For each: severity, verdict (CONFIRMED/PLAUSIBLE), ` +
    `file:line, what is wrong, and a suggested fix direction in a sentence. Open with a 2-3 ` +
    `sentence summary of the overall state of the change.\n\n` +
    `Findings (JSON):\n${JSON.stringify(findings, null, 2)}`,
  { label: "write report", phase: "Report" },
);

return { findings, report };
