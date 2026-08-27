// The two halves of a routing decision, tested where they can actually be
// wrong: what the model is asked, and what is done with an answer that may
// name anything at all.

import { describe, expect, it } from "vitest";
import type { CatalogModel, ModelCatalog } from "./catalog.js";
import {
  buildRoutingPrompt,
  MAX_ROUTED_TEXT_CHARS,
  readFencedJsonObject,
  readRouteChoice,
  truncateRoutedText,
} from "./routing.js";

function model(
  name: string,
  levels: CatalogModel["supportedReasoningLevels"],
): CatalogModel {
  return { model: name, displayName: name, supportedReasoningLevels: levels };
}

const CATALOG: ModelCatalog = {
  providers: new Map([
    [
      "codex",
      new Map([
        ["gpt-5-mini", model("gpt-5-mini", ["none", "low"])],
        ["gpt-5", model("gpt-5", ["low", "medium", "xhigh"])],
      ]),
    ],
    ["claude", new Map([["opus", model("opus", ["medium"])]])],
  ]),
  fetchedAt: 1,
};

const EMPTY: ModelCatalog = { providers: new Map(), fetchedAt: 1 };

describe("truncateRoutedText", () => {
  it("keeps the head and marks that it cut", () => {
    // A 40KB paste in front of every send is the cost this exists to avoid;
    // an unmarked cut would let the model treat a severed sentence as the
    // whole request.
    const truncated = truncateRoutedText("x".repeat(MAX_ROUTED_TEXT_CHARS + 50));
    expect(truncated.startsWith("x".repeat(MAX_ROUTED_TEXT_CHARS))).toBe(true);
    expect(truncated).toContain("truncated");
    expect(truncated.length).toBeLessThan(MAX_ROUTED_TEXT_CHARS + 50);
  });

  it("leaves a prompt that fits completely alone", () => {
    expect(truncateRoutedText("  refactor the pipeline  ")).toBe(
      "refactor the pipeline",
    );
  });
});

describe("buildRoutingPrompt", () => {
  const base = {
    routingPrompt: "Cheap model for questions, capable for refactors.",
    text: "refactor the dispatch pipeline",
    catalog: CATALOG,
    lockedProviderId: null,
  };

  it("carries the rules, the request and every eligible row", () => {
    const prompt = buildRoutingPrompt(base);
    if (prompt === null) throw new Error("expected a prompt");
    expect(prompt).toContain(base.routingPrompt);
    expect(prompt).toContain("refactor the dispatch pipeline");
    expect(prompt).toContain('model "gpt-5-mini"');
    expect(prompt).toContain('model "opus"');
  });

  it("puts the user's rules last so nothing outranks them", () => {
    // The catalog listing is long; rules buried above it read as background.
    const prompt = buildRoutingPrompt(base);
    if (prompt === null) throw new Error("expected a prompt");
    expect(prompt.indexOf(base.routingPrompt)).toBeGreaterThan(
      prompt.indexOf('model "gpt-5-mini"'),
    );
  });

  it("hides other providers and says why when the thread has one", () => {
    const prompt = buildRoutingPrompt({ ...base, lockedProviderId: "codex" });
    if (prompt === null) throw new Error("expected a prompt");
    expect(prompt).not.toContain("opus");
    expect(prompt).toContain("cannot change provider");
  });

  it("declines to ask when there is nothing to choose or nothing to classify", () => {
    // Both are the "proceed on bb's answer" path; holding a send and spawning
    // a routing thread to be told so is pure latency on every send.
    expect(buildRoutingPrompt({ ...base, catalog: EMPTY })).toBeNull();
    expect(
      buildRoutingPrompt({ ...base, lockedProviderId: "gemini" }),
    ).toBeNull();
    expect(buildRoutingPrompt({ ...base, text: "   " })).toBeNull();
  });
});

describe("readFencedJsonObject", () => {
  const answer = { providerId: "codex", model: "gpt-5" };

  it("reads the object out of the shapes an agent actually replies with", () => {
    // Nothing constrains a thread's final message, so each of these is a real
    // reply shape rather than a hypothetical one.
    expect(
      readFencedJsonObject('```json\n{"providerId":"codex","model":"gpt-5"}\n```'),
    ).toEqual(answer);
    expect(
      readFencedJsonObject('```\n{"providerId":"codex","model":"gpt-5"}\n```'),
    ).toEqual(answer);
    expect(readFencedJsonObject('{"providerId":"codex","model":"gpt-5"}')).toEqual(
      answer,
    );
    expect(
      readFencedJsonObject(
        'This one is a refactor, so:\n{"providerId":"codex","model":"gpt-5"} — done.',
      ),
    ).toEqual(answer);
  });

  it("takes the LAST candidate, so working shown before an answer never wins", () => {
    // A model that rules a row out first would otherwise be read as choosing
    // the row it rejected — the exact opposite of what it said.
    expect(
      readFencedJsonObject(
        'Not ```json\n{"providerId":"claude","model":"opus"}\n``` because it is slow.\n' +
          '```json\n{"providerId":"codex","model":"gpt-5"}\n```',
      ),
    ).toEqual(answer);
  });

  it("is not fooled by a brace inside a string value", () => {
    // A naive last-`}` slice would cut this in the middle of the string and
    // then fail to parse, losing a perfectly good answer.
    expect(
      readFencedJsonObject('{"providerId":"codex","model":"gpt-5","why":"a } brace"}'),
    ).toEqual({ ...answer, why: "a } brace" });
  });

  it("answers null for everything that is not an object", () => {
    // Each of these is a routing failure that must degrade to an unamended
    // release rather than throw somewhere further in.
    expect(readFencedJsonObject(null)).toBeNull();
    expect(readFencedJsonObject("")).toBeNull();
    expect(readFencedJsonObject("I could not decide.")).toBeNull();
    expect(readFencedJsonObject('```json\n{"providerId": \n```')).toBeNull();
    expect(readFencedJsonObject('["codex","gpt-5"]')).toBeNull();
    expect(readFencedJsonObject('"gpt-5"')).toBeNull();
  });
});

describe("readRouteChoice", () => {
  const read = (
    value: Record<string, import("@get-bb/plugin-sdk").JsonValue>,
    lockedProviderId: string | null = null,
  ) => readRouteChoice({ value, catalog: CATALOG, lockedProviderId });

  it("accepts a real row and passes a supported level through", () => {
    expect(
      read({ providerId: "codex", model: "gpt-5", reasoningLevel: "medium" }),
    ).toEqual({
      kind: "route",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
    });
  });

  it("leaves bb's level alone when the answer named none", () => {
    expect(read({ providerId: "claude", model: "opus" })).toEqual({
      kind: "route",
      providerId: "claude",
      model: "opus",
      reasoningLevel: null,
    });
  });

  it("clamps a level the chosen model does not advertise", () => {
    // Sending `high` to a model that lists only none/low is an amendment core
    // refuses, which fails the dispatch — the whole reason this clamps.
    expect(
      read({
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "high",
      }),
    ).toEqual({
      kind: "route",
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "low",
    });
  });

  it("refuses a model no provider offers", () => {
    const outcome = read({ providerId: "codex", model: "gpt-9" });
    expect(outcome.kind).toBe("unroutable");
    expect(outcome.kind === "unroutable" && outcome.reason).toContain("gpt-9");
  });

  it("refuses a provider switch once the thread has a provider", () => {
    // The dangerous case: `claude/opus` is a perfectly real row, and amending
    // providerId on an existing thread fails the dispatch outright.
    const outcome = read({ providerId: "claude", model: "opus" }, "codex");
    expect(outcome.kind).toBe("unroutable");
    expect(outcome.kind === "unroutable" && outcome.reason).toContain("codex");
  });

  it("refuses a level bb does not have at all", () => {
    const outcome = read({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "turbo",
    });
    expect(outcome.kind).toBe("unroutable");
  });

  it("refuses an answer whose fields are not strings", () => {
    expect(read({ providerId: "codex", model: 5 }).kind).toBe("unroutable");
  });
});
