export const meta = {
  name: "fs-contract-freeze",
  description:
    "Read-only adversarial review of a proposed Finite State frozen-contract change, producing a decision brief for human approval.",
  phases: [
    { title: "Review", detail: "Four independent reviewers on a different provider" },
    { title: "Refute", detail: "Adversarial verification of each blocking finding" },
    { title: "Brief", detail: "Decision brief and consumer-impact list for the human gate" },
  ],
};

const AUTHORITY = [
  "docs/Implementation/api-reference/ is the vendored authority for every remote claim. Handler-backed audit evidence beats spec prose.",
  "The accepted direct-API ADR supersedes RECON on transport ownership: direct Platform REST plus direct Assurance Studio REST, Forge optional compute only.",
  "The scope key is (project_id, project_version_id) NOT NULL on every scoped table, with the project-level sentinel in storage and null at the RPC edge.",
  "bb.storage.migrate keys statements positionally and is append-only. An in-place base rewrite is legitimate only while no data.db exists anywhere.",
].join("\n- ");

const FINDINGS_SCHEMA = {
  type: "object",
  required: ["findings"],
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["severity", "claim", "evidence"],
        additionalProperties: false,
        properties: {
          severity: { enum: ["blocker", "major", "minor"] },
          claim: { type: "string", maxLength: 400 },
          evidence: { type: "string", maxLength: 1500 },
          artifact: { type: "string", maxLength: 300 },
          consumers: { type: "string", maxLength: 800 },
        },
      },
    },
  },
};

const REFUTE_SCHEMA = {
  type: "object",
  required: ["refuted", "reason"],
  additionalProperties: false,
  properties: {
    refuted: { type: "boolean" },
    reason: { type: "string", maxLength: 1200 },
  },
};

if (!args || !args.target) {
  throw new Error(
    "fs-contract-freeze requires args.target, e.g. { target: 'PR #6' } or { target: 'branch bb/...' }",
  );
}

const target = args.target;

phase("Review");
const lenses = [
  {
    key: "rpc",
    prompt:
      "Review shared/contract.ts: every RPC method's input and output schema, the scope arguments, CONTRACT_VERSION handling, and whether the declared method inventory matches the count and names the handoff asserts. Flag any method whose shape cannot be satisfied by the vendored API authority.",
  },
  {
    key: "schema",
    prompt:
      "Review lib/store/schema.ts: table and index inventory against the documented counts, primary keys and uniqueness under the scope key, the project-level sentinel's participation in every constraint it appears in, and whether the base migration rewrite is done in place rather than appended. Prove that a real upstream project_version_id equal to the sentinel is rejected at ingest, and that the null-to-sentinel mapping is total in both directions.",
  },
  {
    key: "registry",
    prompt:
      "Review lib/sync/registry.ts and identity: every entity's class, directory, table, and key function; stable-key derivation; and whether two entities can collide on one key under the scope rules. Check the registry agrees with the schema and the contract on scope.",
  },
  {
    key: "remote",
    prompt:
      "Review lib/remote/types.ts independently for Platform REST, Assurance Studio REST, and optional Forge compute. Check each method against the vendored OpenAPI and handler audit: status codes and empty bodies, paging shape consistency, closed route sets, open job metadata versus the closed compute invocation allowlist, and any field with no authoritative upstream source.",
  },
];

const reviews = await parallel(
  lenses.map(
    (lens) => () =>
      agent(
        "You are an INDEPENDENT READ-ONLY reviewer of a proposed Finite State frozen-contract change: " +
          target +
          ". You did not write it. Do NOT edit any file.\n\nAuthority:\n- " +
          AUTHORITY +
          "\n\n" +
          lens.prompt +
          "\n\nFor every finding, name the consumers it affects (work packages, lanes, fixtures, tests). Distinguish defects that originate in the specs or work package documents from defects in the implementation, and say which. Evidence must be a file and line or real command output.",
        {
          label: "freeze:" + lens.key,
          phase: "Review",
          provider: "claude-code",
          model: "claude-sonnet-5",
          reasoningLevel: "high",
          schema: FINDINGS_SCHEMA,
        },
      ),
  ),
);

const blocking = reviews
  .filter(Boolean)
  .flatMap((review) => review.findings || [])
  .filter((finding) => finding.severity === "blocker" || finding.severity === "major");

log(target + ": " + blocking.length + " blocking/major findings before refutation");

phase("Refute");
const judged = await parallel(
  blocking.map(
    (finding, index) => () =>
      agent(
        "Try to REFUTE this claim about " +
          target +
          ". Default to refuted=true if you cannot substantiate it against the working tree and the vendored authority. Do not edit anything.\n\nClaim: " +
          finding.claim +
          "\nEvidence offered: " +
          finding.evidence +
          "\n\nAuthority:\n- " +
          AUTHORITY,
        {
          label: "refute:" + index,
          phase: "Refute",
          provider: "claude-code",
          model: "claude-sonnet-5",
          reasoningLevel: "high",
          schema: REFUTE_SCHEMA,
        },
      ).then((verdict) => ({ finding: finding, verdict: verdict })),
  ),
);

const survived = judged.filter(Boolean).filter((entry) => !entry.verdict.refuted);
log(target + ": " + survived.length + " findings survived adversarial refutation");

phase("Brief");
const brief = await agent(
  "Write a DECISION BRIEF for the human who owns the frozen-contract gate on " +
    target +
    ". Do not edit anything. Do not approve anything.\n\nSurviving findings after adversarial refutation (" +
    survived.length +
    "):\n" +
    survived
      .map(
        (entry, index) =>
          index +
          1 +
          ". [" +
          entry.finding.severity +
          "] " +
          entry.finding.claim +
          "\n   artifact: " +
          (entry.finding.artifact || "unstated") +
          "\n   consumers: " +
          (entry.finding.consumers || "unstated") +
          "\n   evidence: " +
          entry.finding.evidence,
      )
      .join("\n") +
    "\n\nThe brief must be one page and must state, for each decision the human is being asked to ratify: what the decision is, whether it was independently verified, and a recommended approve or reject with the reason. Enumerate the decisions, not the diff. Include the consumer-impact list: which work packages, lanes, fixtures, and tests must change if this lands. End with an explicit statement that approval is the human's and that no agent may merge a frozen artifact.",
  { label: "decision-brief", phase: "Brief" },
);

return { target: target, raised: blocking.length, survived: survived.length, brief: brief };
