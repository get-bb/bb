export const meta = {
  name: "fs-gate-review",
  description:
    "Run a Finite State phase gate (G0-G6) on the integration branch with independent verification, returning pass/fail/inconclusive with evidence.",
  phases: [
    { title: "Execute", detail: "Run the exact gate checks and capture real output" },
    { title: "Verify", detail: "Independent reviewers confirm the evidence" },
    { title: "Rule", detail: "Consolidated verdict; never self-approves a human checkpoint" },
  ],
};

const GATE =
  "pnpm exec turbo run typecheck test lint build --filter=bb-plugin-finite-state";

const VERDICT_SCHEMA = {
  type: "object",
  required: ["verdict", "evidence"],
  additionalProperties: false,
  properties: {
    verdict: { enum: ["pass", "fail", "inconclusive"] },
    evidence: { type: "string", maxLength: 2500 },
    unmet: { type: "string", maxLength: 1500 },
  },
};

if (!args || !args.gate) {
  throw new Error("fs-gate-review requires args.gate, e.g. { gate: 'G1' }");
}

const gate = args.gate;
const criteria = args.criteria
  ? "\n\nGate criteria supplied by the coordinator:\n" + args.criteria
  : "\n\nRead the gate's criteria from the implementation plan and the matching gate task.";

phase("Execute");
const executed = await agent(
  "Run the Finite State " +
    gate +
    " gate on the integration branch. Do not edit any source file.\n\nRun and paste real output for:\n" +
    GATE +
    "\n\nAlso confirm: no undocumented file outside plugins/bb-plugin-finite-state/, no unapproved frozen-artifact or composition-root diff, and no unresolved acceptance criterion." +
    criteria +
    "\n\nReport exactly what you ran and what it returned. Never claim a check passed that you did not execute.",
  { label: "execute:" + gate, phase: "Execute" },
);

phase("Verify");
const verifications = await parallel([
  () =>
    agent(
      "Independently verify the " +
        gate +
        " gate evidence below. Re-run the checks yourself; do not trust the report. Do not edit anything.\n\n" +
        executed +
        "\n\nReturn fail if any claimed-green check is actually red, and inconclusive if a check could not be executed.",
      {
        label: "verify:commands",
        phase: "Verify",
        provider: "claude-code",
        model: "claude-sonnet-5",
        reasoningLevel: "high",
        schema: VERDICT_SCHEMA,
      },
    ),
  () =>
    agent(
      "Independently verify that the " +
        gate +
        " gate's ACCEPTANCE CRITERIA are actually met by the working tree, not merely that commands exited zero. Do not edit anything.\n\nReported evidence:\n" +
        executed +
        criteria +
        "\n\nList any criterion that is unmet or unverifiable. A green command set with an unmet criterion is a fail, not a pass.",
      {
        label: "verify:criteria",
        phase: "Verify",
        provider: "claude-code",
        model: "claude-sonnet-5",
        reasoningLevel: "high",
        schema: VERDICT_SCHEMA,
      },
    ),
]);

const results = verifications.filter(Boolean);
const failed = results.filter((result) => result.verdict === "fail");
const unclear = results.filter((result) => result.verdict === "inconclusive");
let ruling = "pass";
if (failed.length > 0) {
  ruling = "fail";
} else if (unclear.length > 0 || results.length < 2) {
  ruling = "inconclusive";
}
log(gate + " independent ruling: " + ruling);

phase("Rule");
const summary = await agent(
  "Record the " +
    gate +
    " gate outcome. The independent ruling is " +
    ruling +
    ".\n\nEvidence:\n" +
    results.map((result, index) => index + 1 + ". " + result.verdict + " — " + result.evidence).join("\n") +
    "\n\nPost one comment on the matching gate task with the verdict and the exact failing commands if any. If the ruling is pass, move the gate task to in_review ONLY — a gate is a human checkpoint and you must not approve or promote it. If the ruling is fail or inconclusive, set the gate task to blocked and name the precise blocking check. Never merge and never promote an integration commit.",
  { label: "rule:" + gate, phase: "Rule" },
);

return { gate: gate, ruling: ruling, summary: summary };
