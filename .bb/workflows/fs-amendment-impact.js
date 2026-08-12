export const meta = {
  name: "fs-amendment-impact",
  description:
    "Draft-only impact analysis for a proposed Finite State frozen-contract amendment: artifact, consumers, in-flight work, migration effect, fixtures.",
  inputSchema: {
    type: "object",
    required: ["amendment"],
    additionalProperties: false,
    properties: { amendment: { type: "string", minLength: 1 } },
  },
  phases: [
    { title: "Analyse", detail: "Parallel read-only analysis across impact dimensions" },
    { title: "Draft", detail: "Consolidated amendment draft for human acceptance" },
  ],
};

const MAX_CONCURRENT_AGENTS = 4;
const EDITING_PHASES = [];

async function parallelWithinCap(thunks) {
  const results = [];
  for (let index = 0; index < thunks.length; index += MAX_CONCURRENT_AGENTS) {
    const batch = await parallel(thunks.slice(index, index + MAX_CONCURRENT_AGENTS));
    results.push(...batch);
  }
  return results;
}

function reviewAgent(prompt, options) {
  return agent(
    "READ-ONLY BOUNDARY: Do not edit any file, mutate Tasks, GitHub, gates, or approvals, or merge.\n\n" + prompt,
    {
      label: options.label,
      phase: options.phase,
      provider: "claude-code",
      model: "claude-opus-5[1m]",
      reasoningLevel: "high",
      schema: options.schema,
    },
  );
}

function criticalNonEditingAgent(prompt, options) {
  return agent("NON-EDITING SYNTHESIS BOUNDARY: Do not edit any repository file, mutate Tasks, GitHub, gates, or approvals, or merge.\n\n" + prompt, {
    label: options.label,
    phase: options.phase,
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningLevel: "xhigh",
  });
}

const FROZEN = [
  "plugins/bb-plugin-finite-state/server.ts",
  "plugins/bb-plugin-finite-state/app.tsx",
  "plugins/bb-plugin-finite-state/shared/contract.ts",
  "plugins/bb-plugin-finite-state/lib/store/schema.ts",
  "plugins/bb-plugin-finite-state/lib/sync/registry.ts",
  "plugins/bb-plugin-finite-state/lib/remote/types.ts",
].join("\n- ");

const IMPACT_SCHEMA = {
  type: "object",
  required: ["summary", "items"],
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 1200 },
    items: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        required: ["name", "effect"],
        additionalProperties: false,
        properties: {
          name: { type: "string", maxLength: 200 },
          effect: { type: "string", maxLength: 600 },
          blocking: { type: "boolean" },
        },
      },
    },
  },
};

if (!args || !args.amendment) {
  throw new Error(
    "fs-amendment-impact requires args.amendment, e.g. { amendment: 'FS-95' } or a description of the proposed change",
  );
}

const amendment = args.amendment;

phase("Analyse");
const dimensions = [
  {
    key: "artifact",
    prompt:
      "Identify precisely which frozen artifact changes and how its shape differs before and after. Quote the current declaration and the proposed one. State whether CONTRACT_VERSION must advance.",
  },
  {
    key: "consumers",
    prompt:
      "Enumerate every consumer of the changed shape: work package documents, lanes, panels, agent tools, CLI paths, and skills. For each, state what must change and whether it blocks that consumer from starting.",
  },
  {
    key: "inflight",
    prompt:
      "Enumerate in-flight work that collides with this amendment. Use `bb tasks list` and the open pull requests. For each, state whether it must rebase, pause, or be folded into the amendment.",
  },
  {
    key: "migration",
    prompt:
      "Analyse the persistence effect. bb.storage.migrate keys statements positionally and is append-only, so an edit to an applied statement is silently ignored on an existing database, and SQLite cannot alter a primary key. Determine whether any data.db exists anywhere; if none does, an in-place base rewrite is legitimate and must be documented as such. Otherwise specify the append or rebuild path exactly.",
  },
  {
    key: "fixtures",
    prompt:
      "Enumerate the fixture and test changes required: mock remote fixtures, contract tests, schema tests, and any recorded corpus that encodes the old shape. Flag tests that would still pass against the old shape and therefore hide the change.",
  },
];

const analyses = await parallelWithinCap(
  dimensions.map(
    (dimension) => () =>
      reviewAgent(
        "You are performing DRAFT-ONLY impact analysis for proposed Finite State amendment " +
          amendment +
          ". Do NOT edit any file. Do NOT accept, approve, or apply the amendment.\n\nFrozen artifacts:\n- " +
          FROZEN +
          "\n\n" +
          dimension.prompt +
          "\n\nGround every item in the actual repository. Do not infer consumers from prose alone.",
        {
          label: "impact:" + dimension.key,
          phase: "Analyse",
          schema: IMPACT_SCHEMA,
        },
      ).then((result) => ({ key: dimension.key, result: result })),
  ),
);

const sections = analyses.filter(Boolean);
const blocking = sections.reduce(function (total, section) {
  return total + (section.result.items || []).filter((item) => item.blocking).length;
}, 0);
log(amendment + ": " + sections.length + " dimensions analysed, " + blocking + " blocking impacts");

phase("Draft");
const draft = await criticalNonEditingAgent(
  "Draft the amendment record for " +
    amendment +
    ". This is a DRAFT ONLY: a human accepts or rejects it. Do not edit a frozen artifact, do not mark anything approved, and do not merge.\n\nAnalysis:\n" +
    sections
      .map(
        (section) =>
          "## " +
          section.key +
          "\n" +
          section.result.summary +
          "\n" +
          (section.result.items || [])
            .map((item) => "- " + item.name + (item.blocking ? " [BLOCKING] " : ": ") + item.effect)
            .join("\n"),
      )
      .join("\n\n") +
    "\n\nProduce the entry in the structure AMENDMENTS.md requires: identifier and status, old and new artifact hashes, reason and migration plan, affected work packages and gates, approver and reviewer identities left blank for the human, and broadcast and merge commits left pending. Add a short recommendation on whether this should be folded into an existing pending amendment rather than raised separately — serial amendment cycles on the critical path are expensive, and a non-semantic correction should not consume the full protocol.",
  { label: "draft:" + amendment, phase: "Draft" },
);

return { amendment: amendment, blocking: blocking, draft: draft };
