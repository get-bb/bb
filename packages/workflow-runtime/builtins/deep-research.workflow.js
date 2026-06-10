// Built-in `deep-research` workflow: fan out web searches, deep-read the best
// sources, adversarially verify every claim with a 3-vote panel, synthesize a
// cited report.
// Run with: bb workflow run deep-research --args '"<question>"'

export const meta = {
  name: "deep-research",
  description:
    "Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.",
  defaultSandbox: "read-only",
  phases: [
    {
      title: "Scope",
      detail: "break the question into distinct search directives",
    },
    { title: "Search", detail: "5 parallel web-search agents" },
    { title: "Fetch", detail: "dedup URLs, deep-read the top sources" },
    { title: "Verify", detail: "3-vote adversarial panel per claim" },
    { title: "Synthesize", detail: "cited report from surviving claims" },
  ],
};

const SEARCHERS = 5;
const VOTES_PER_CLAIM = 3;
const REFUTATIONS_REQUIRED = 2; // 2 of 3 refute votes kill a claim
const MAX_FETCH = 15;
const MAX_VERIFY_CLAIMS = 25;

const question =
  typeof args === "string" && args.trim()
    ? args.trim()
    : args &&
        typeof args === "object" &&
        typeof args.question === "string" &&
        args.question.trim()
      ? args.question.trim()
      : null;
if (!question) {
  throw new Error(
    `deep-research needs a question — pass --args '"<question>"' or --args '{"question": "..."}'`,
  );
}

// ---------------------------------------------------------------------------
// Scope — turn the question into SEARCHERS distinct search directives.
// ---------------------------------------------------------------------------
phase("Scope");
log(`scoping: ${question}`);

const scope = await agent(
  `You are scoping a deep web-research project for this question:\n\n${question}\n\n` +
    `Produce exactly ${SEARCHERS} distinct search directives. Each directive is a short instruction ` +
    `for an independent researcher with web search: what to search for and what kind of sources to ` +
    `prefer (primary data, official docs, expert analysis, recent news, contrarian takes, ...). ` +
    `The directives must not overlap — together they should cover the question from genuinely ` +
    `different angles (different sub-questions, source types, or time windows).`,
  {
    label: "scope directives",
    schema: {
      type: "object",
      required: ["directives"],
      properties: {
        directives: {
          type: "array",
          minItems: SEARCHERS,
          maxItems: SEARCHERS,
          items: { type: "string" },
        },
      },
    },
  },
);

// ---------------------------------------------------------------------------
// Search — one web-search agent per directive, in parallel. Barrier: the Fetch
// stage dedups URLs ACROSS all searchers before spending deep-read agents.
// ---------------------------------------------------------------------------
phase("Search");

const searches = await parallel(
  scope.directives.map(
    (directive, i) => () =>
      agent(
        `Research question: ${question}\n\nYour directive (#${i + 1} of ${SEARCHERS}):\n${directive}\n\n` +
          `Use your web search tool to find the most authoritative sources bearing on this directive. ` +
          `Return up to 6 sources. For each give the exact URL, its title, and a relevance score 1-5 ` +
          `(5 = directly answers the question with primary evidence). Only return URLs you actually ` +
          `found via search — never construct or guess a URL.`,
        {
          label: `search ${i + 1}: ${directive.slice(0, 40)}`,
          schema: {
            type: "object",
            required: ["sources"],
            properties: {
              sources: {
                type: "array",
                items: {
                  type: "object",
                  required: ["url", "title", "relevance"],
                  properties: {
                    url: { type: "string" },
                    title: { type: "string" },
                    relevance: { type: "number" },
                  },
                },
              },
            },
          },
        },
      ),
  ),
);

// Dedup by URL (highest relevance wins), rank, keep the top MAX_FETCH.
const byUrl = new Map();
for (const s of searches.filter(Boolean).flatMap((r) => r.sources || [])) {
  if (!s || !s.url) continue;
  const prev = byUrl.get(s.url);
  if (!prev || s.relevance > prev.relevance) byUrl.set(s.url, s);
}
const ranked = [...byUrl.values()].sort((a, b) => b.relevance - a.relevance);
const sources = ranked.slice(0, MAX_FETCH);
if (ranked.length > sources.length)
  log(
    `dropping ${ranked.length - sources.length} lower-relevance sources (cap ${MAX_FETCH})`,
  );
log(`${sources.length} unique sources to read`);

// ---------------------------------------------------------------------------
// Fetch — deep-read each source and extract concrete, checkable claims.
// ---------------------------------------------------------------------------
phase("Fetch");

const fetched = await parallel(
  sources.map(
    (src) => () =>
      agent(
        `Research question: ${question}\n\nFetch and read this source:\n${src.title}\n${src.url}\n\n` +
          `Extract the concrete, checkable claims it makes that bear on the research question — facts, ` +
          `numbers, findings, dated events. For each claim include a short supporting quote from the ` +
          `source. Skip opinions, marketing, and anything the source merely speculates about. If the ` +
          `page is unreachable or irrelevant, return an empty list.`,
        {
          label: `fetch: ${src.title.slice(0, 40)}`,
          schema: {
            type: "object",
            required: ["claims"],
            properties: {
              claims: {
                type: "array",
                items: {
                  type: "object",
                  required: ["claim", "quote"],
                  properties: {
                    claim: { type: "string" },
                    quote: { type: "string" },
                  },
                },
              },
            },
          },
        },
      ).then((r) =>
        (r.claims || []).map((c) => ({ ...c, url: src.url, title: src.title })),
      ),
  ),
);

const allClaims = fetched.filter(Boolean).flat();
const claims = allClaims.slice(0, MAX_VERIFY_CLAIMS);
if (allClaims.length > claims.length)
  log(
    `verifying first ${MAX_VERIFY_CLAIMS} of ${allClaims.length} claims (cap)`,
  );
log(`${claims.length} claims to verify`);

// ---------------------------------------------------------------------------
// Verify — a 3-vote adversarial panel per claim; 2 of 3 refutes kill it. Each
// voter gets a different lens so the panel's failure modes are decorrelated.
// ---------------------------------------------------------------------------
phase("Verify");

const LENSES = [
  "Check the claim against the quoted text: does the source actually say this, or is it an overreach/misreading?",
  "Check the claim against your own knowledge and a quick independent web search: is it contradicted elsewhere?",
  "Check the claim's precision: are the numbers, dates, and attributions right, or materially misleading as stated?",
];

const verified = await pipeline(claims, (claim) =>
  parallel(
    LENSES.slice(0, VOTES_PER_CLAIM).map(
      (lens, v) => () =>
        agent(
          `You are a skeptical fact-checker. Your job is to try to REFUTE this claim.\n\n` +
            `Claim: ${claim.claim}\n` +
            `Source: ${claim.title} — ${claim.url}\n` +
            `Supporting quote: "${claim.quote}"\n\n` +
            `${lens}\n\n` +
            `Vote refuted=true if the claim is false, unsupported, or materially misleading; when ` +
            `genuinely uncertain, default to refuted=true.`,
          {
            label: `verify ${v + 1}/${VOTES_PER_CLAIM}: ${claim.claim.slice(0, 32)}`,
            schema: {
              type: "object",
              required: ["refuted", "reason"],
              properties: {
                refuted: { type: "boolean" },
                reason: { type: "string" },
              },
            },
          },
        ),
    ),
  ).then((votes) => {
    const cast = votes.filter(Boolean);
    const refutes = cast.filter((v) => v.refuted).length;
    // A skipped/errored vote counts as a refute: a claim must EARN its place in the report.
    const killed =
      refutes + (VOTES_PER_CLAIM - cast.length) >= REFUTATIONS_REQUIRED;
    return killed ? null : { ...claim, refutes, votes: VOTES_PER_CLAIM };
  }),
);

const survivors = verified.filter(Boolean);
log(`${survivors.length} of ${claims.length} claims survived the panel`);

// ---------------------------------------------------------------------------
// Synthesize — a cited report from the surviving claims only.
// ---------------------------------------------------------------------------
phase("Synthesize");

if (survivors.length === 0) {
  return (
    `# Research report: ${question}\n\n` +
    `No claims survived adversarial verification (${claims.length} candidates, ${VOTES_PER_CLAIM}-vote panel, ` +
    `${REFUTATIONS_REQUIRED} refutes to kill). The available sourcing was too weak to answer confidently.`
  );
}

return await agent(
  `Write a well-structured research report answering:\n\n${question}\n\n` +
    `Use ONLY the verified claims below — every factual statement must trace to one of them, cited ` +
    `inline as a markdown link to its source URL. Group related claims into sections, lead with a ` +
    `direct answer, and close with what remains uncertain (claims that were killed or angles that ` +
    `found nothing). Do not introduce facts that are not in the claims.\n\n` +
    `Verified claims (JSON):\n${JSON.stringify(survivors, null, 2)}`,
  { label: "synthesize report" },
);
