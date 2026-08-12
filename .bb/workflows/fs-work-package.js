export const meta = {
  name: "fs-work-package",
  description:
    "Implement one Finite State work package, review it on an independent provider, repair verified findings, verify, and report.",
  phases: [
    { title: "Implement", detail: "One editing agent in the task worktree" },
    { title: "Review", detail: "Parallel read-only reviewers on a different provider" },
    { title: "Repair", detail: "One editing agent, verified findings only" },
    { title: "Verify", detail: "Re-run the focused gate and the WP acceptance list" },
    { title: "Report", detail: "One substantive task comment; mark in_review" },
  ],
};

const GATE =
  "pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state";

const RULES = [
  "Read plugins/bb-plugin-finite-state/AGENTS.md first; it is binding.",
  "Run every check through turbo, never bare vitest. Turbo's test task repairs the better-sqlite3 ABI; bare vitest does not.",
  "Gate command: " + GATE,
  "Never edit a frozen artifact (server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/sync/registry.ts, lib/remote/types.ts) without an approved amendment. Stop and report instead.",
  "Obey the work package's owned-files and forbidden-files lists exactly.",
  "Verify every transport claim against the vendored authority in docs/Implementation/api-reference/. Do not restate prose from a WP document as fact.",
].join("\n- ");

const FINDINGS_SCHEMA = {
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        required: ["severity", "summary", "evidence"],
        additionalProperties: false,
        properties: {
          severity: { enum: ["blocker", "major", "minor"] },
          summary: { type: "string", maxLength: 400 },
          evidence: { type: "string", maxLength: 1200 },
          file: { type: "string", maxLength: 300 },
          selfCheckable: { type: "boolean" },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["gateGreen", "acceptanceMet", "detail"],
  additionalProperties: false,
  properties: {
    gateGreen: { type: "boolean" },
    acceptanceMet: { type: "boolean" },
    detail: { type: "string", maxLength: 2000 },
  },
};

if (!args || !args.taskKey) {
  throw new Error("fs-work-package requires args.taskKey, e.g. { taskKey: 'FS-24' }");
}

const taskKey = args.taskKey;
const scope = args.scope ? "\n\nExtra scope notes from the coordinator:\n" + args.scope : "";

phase("Implement");
const implemented = await agent(
  "You are the sole editing agent for Finite State work package " +
    taskKey +
    ". Read it with `bb tasks show " +
    taskKey +
    "`, then implement it.\n\nRules:\n- " +
    RULES +
    "\n\nWhen done, run the gate and report what you changed, what you ran, and the exact output of the gate. Do not open a pull request yet." +
    scope,
  { label: "implement:" + taskKey, phase: "Implement" },
);

phase("Review");
const lenses = [
  {
    key: "correctness",
    prompt:
      "Review for correctness and security: logic errors, edge cases, error propagation, unsafe input handling, and anything that would fail in production. Construct concrete failure scenarios rather than listing style preferences.",
  },
  {
    key: "contract",
    prompt:
      "Review for contract and scope compliance: does the change respect the work package's owned/forbidden files, the frozen artifact set, the safety boundary (no agent-reachable upstream push, conflict resolution, HBOM acceptance, lifecycle approval, or manual attestation), and the vendored API authority in docs/Implementation/api-reference/? Check every transport claim against the vendored OpenAPI, not against WP prose.",
  },
  {
    key: "tests",
    prompt:
      "Review the tests: do they assert behavior rather than implementation, cover the work package's acceptance criteria, and avoid mocking the plugin database? Flag weak assertions and missing edge cases. Confirm the gate was actually run and its output is real.",
  },
];

const reviews = await parallel(
  lenses.map(
    (lens) => () =>
      agent(
        "You are an INDEPENDENT READ-ONLY reviewer of Finite State work package " +
          taskKey +
          ". You did not write this code. Do not edit any file.\n\nThe implementer reported:\n" +
          implemented +
          "\n\n" +
          lens.prompt +
          "\n\nInspect the actual working tree and the work package with `bb tasks show " +
          taskKey +
          "`. Before blaming the implementation, check whether the defect originates in the work package document or the specs — if so, say that explicitly, because the repair must then target the document. Mark a finding selfCheckable when the implementer could have caught it before opening a review. Return only defects you can evidence with a file and line or a command output.",
        {
          label: "review:" + lens.key,
          phase: "Review",
          provider: "claude-code",
          model: "claude-sonnet-5",
          reasoningLevel: "high",
          schema: FINDINGS_SCHEMA,
        },
      ),
  ),
);

const findings = reviews
  .filter(Boolean)
  .flatMap((review) => review.findings || [])
  .filter((finding) => finding.severity !== "minor");

log(taskKey + ": " + findings.length + " blocking/major findings after independent review");

let repaired = "No repair needed; independent review returned no blocking or major findings.";
if (findings.length > 0) {
  phase("Repair");
  const brief = findings
    .map(
      (finding, index) =>
        index + 1 + ". [" + finding.severity + "] " + finding.summary + "\n   evidence: " + finding.evidence,
    )
    .join("\n");
  repaired = await agent(
    "You are the sole editing agent repairing Finite State work package " +
      taskKey +
      ". Fix ONLY the verified findings below. Do not refactor anything else.\n\n" +
      brief +
      "\n\nRules:\n- " +
      RULES +
      "\n\nIf a finding's real cause is the work package document or a spec rather than the code, fix the document and say so. If a finding would require editing a frozen artifact, STOP and report that an amendment is required instead of editing it.",
    { label: "repair:" + taskKey, phase: "Repair" },
  );
}

phase("Verify");
const verdict = await agent(
  "You are the final verifier for Finite State work package " +
    taskKey +
    ". Do not edit anything.\n\nRun the gate yourself and paste real output:\n" +
    GATE +
    "\n\nThen check every acceptance criterion in `bb tasks show " +
    taskKey +
    "` against the actual working tree. Report gateGreen strictly from the command's exit status you observed, not from what any earlier agent claimed.",
  {
    label: "verify:" + taskKey,
    phase: "Verify",
    provider: "claude-code",
    model: "claude-sonnet-5",
    reasoningLevel: "high",
    schema: VERDICT_SCHEMA,
  },
);

phase("Report");
const selfCheckable = findings.filter((finding) => finding.selfCheckable).length;
const report = await agent(
  "Post exactly one substantive comment on Finite State task " +
    taskKey +
    " with `bb tasks comment`, summarising this run, then set its status.\n\nImplementation:\n" +
    implemented +
    "\n\nIndependent review found " +
    findings.length +
    " blocking/major findings, of which " +
    selfCheckable +
    " were self-checkable before review.\n\nRepair:\n" +
    repaired +
    "\n\nVerification: gateGreen=" +
    verdict.gateGreen +
    " acceptanceMet=" +
    verdict.acceptanceMet +
    "\n" +
    verdict.detail +
    "\n\nIf gateGreen and acceptanceMet are both true, push the branch, open a pull request whose body ends with an agent-generation marker, and set the task to in_review. Otherwise set the task to blocked and state the exact failing command and output. Never merge. Never approve a frozen artifact.\n\nIf any self-checkable findings occurred, add one line naming the check that should move into the gate or the WP acceptance criteria so this class cannot recur.",
  { label: "report:" + taskKey, phase: "Report" },
);

return {
  taskKey: taskKey,
  findings: findings.length,
  selfCheckable: selfCheckable,
  gateGreen: verdict.gateGreen,
  acceptanceMet: verdict.acceptanceMet,
  report: report,
};
