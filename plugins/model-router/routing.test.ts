import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { CatalogModel, ModelCatalog, ReasoningLevel } from "./catalog.js";
import {
  amendPermission,
  classifyPrompt,
  DEFAULT_LENGTH_THRESHOLD,
  matchesKeyword,
  parseKeywords,
  parseLengthThreshold,
  readAutoEntry,
  resolveSettings,
  resolveTrigger,
  routeDispatch,
  type RouteRequest,
  type ResolvedRouterSettings,
} from "./routing.js";

// --- fixtures ---------------------------------------------------------------

function model(
  name: string,
  levels: readonly ReasoningLevel[] = ["low", "medium", "high"],
): CatalogModel {
  return {
    model: name,
    displayName: name,
    supportedReasoningLevels: levels,
  };
}

/**
 * Two providers, so the "a locked thread cannot reach the other provider's
 * slot" rule has something real to fall back from.
 */
const CATALOG: ModelCatalog = {
  providers: new Map([
    [
      "codex",
      new Map([
        ["gpt-5-mini", model("gpt-5-mini")],
        ["gpt-5", model("gpt-5")],
      ]),
    ],
    ["claude-code", new Map([["opus", model("opus")]])],
  ]),
  fetchedAt: 1_000,
};

const SETTINGS: ResolvedRouterSettings = {
  fast: { providerId: "codex", model: "gpt-5-mini" },
  capable: { providerId: "claude-code", model: "opus" },
  lengthThreshold: 100,
  keywords: ["refactor", "code review"],
  routeDefaultedFields: false,
};

const AUTO: JsonValue = { entry: "default" };

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    stage: "thread.create",
    text: "hi",
    pluginInput: AUTO,
    sources: { providerId: null, model: null, reasoningLevel: null },
    currentProviderId: "codex",
    currentModel: null,
    lockedProviderId: null,
    settings: SETTINGS,
    catalog: CATALOG,
    catalogIsUsable: true,
    ...overrides,
  };
}

const LONG_PROMPT = "x".repeat(150);

// --- settings ---------------------------------------------------------------

describe("settings", () => {
  it("defaults an empty threshold and rejects a non-numeric one", () => {
    expect(parseLengthThreshold("")).toEqual({
      kind: "ok",
      value: DEFAULT_LENGTH_THRESHOLD,
    });
    expect(parseLengthThreshold("600")).toEqual({ kind: "ok", value: 600 });
    expect(parseLengthThreshold("6oo").kind).toBe("invalid");
    // 0 would promote every prompt; leaving the fast slot empty says that
    // properly, so 0 here is a keystroke, not an intent.
    expect(parseLengthThreshold("0").kind).toBe("invalid");
  });

  it("lowercases, trims and de-duplicates the keyword list", () => {
    expect(parseKeywords(" Refactor , plan,, PLAN ,code review ")).toEqual([
      "refactor",
      "plan",
      "code review",
    ]);
  });

  it("reports a problem when neither slot is configured", () => {
    const result = resolveSettings({
      fastModel: "",
      capableModel: "",
      lengthThreshold: "",
      capableKeywords: "",
      routeDefaultedFields: false,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.settings.fast).toBeNull();
    expect(result.settings.capable).toBeNull();
  });

  it("keeps the good slot when the other one is unparseable", () => {
    const result = resolveSettings({
      fastModel: "codex/gpt-5-mini",
      capableModel: "opus",
      lengthThreshold: "",
      capableKeywords: "plan",
      routeDefaultedFields: true,
    });
    expect(result.settings.fast).toEqual({
      providerId: "codex",
      model: "gpt-5-mini",
    });
    expect(result.settings.capable).toBeNull();
    expect(result.problems).toHaveLength(1);
    expect(result.settings.routeDefaultedFields).toBe(true);
  });
});

// --- trigger detection ------------------------------------------------------

describe("Auto trigger detection", () => {
  it("reads the entry id the picker and the CLI both send", () => {
    expect(readAutoEntry({ entry: "default" })).toBe("default");
    expect(readAutoEntry({ entry: "fast" })).toBe("fast");
  });

  it("ignores plugin input that is not an entry selection", () => {
    for (const input of [
      null,
      "default",
      42,
      true,
      [{ entry: "default" }],
      {},
      { entry: "" },
      { entry: 7 },
      { route: "auto" },
    ] as (JsonValue | null)[]) {
      expect(readAutoEntry(input), JSON.stringify(input)).toBeNull();
    }
  });

  it("is off without Auto unless defaulted routing is enabled", () => {
    expect(
      resolveTrigger({ pluginInput: null, routeDefaultedFields: false }).kind,
    ).toBe("off");
    expect(
      resolveTrigger({ pluginInput: null, routeDefaultedFields: true }).kind,
    ).toBe("defaulted");
    // Auto wins even when defaulted routing is off — it is the explicit ask.
    expect(
      resolveTrigger({ pluginInput: AUTO, routeDefaultedFields: false }).kind,
    ).toBe("auto");
  });
});

describe("amendPermission", () => {
  const auto = { kind: "auto", entry: "default" } as const;
  const defaulted = { kind: "defaulted" } as const;

  it("gives Auto both fields even when everything was explicit", () => {
    expect(
      amendPermission({
        trigger: auto,
        stage: "thread.create",
        sources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
        },
      }),
    ).toEqual({ execution: true, reasoningLevel: true });
  });

  it("protects an explicit provider at create but not at submit", () => {
    const sources = {
      providerId: "explicit",
      model: null,
      reasoningLevel: null,
    } as const;
    // At create, moving the model means moving the provider too.
    expect(
      amendPermission({ trigger: defaulted, stage: "thread.create", sources })
        .execution,
    ).toBe(false);
    // At submit the provider is fixed and never amended, so routing the model
    // inside the provider they picked overrides nothing.
    expect(
      amendPermission({ trigger: defaulted, stage: "turn.submit", sources })
        .execution,
    ).toBe(true);
  });

  it("protects an explicit model and reasoning level independently", () => {
    expect(
      amendPermission({
        trigger: defaulted,
        stage: "turn.submit",
        sources: {
          providerId: null,
          model: "explicit",
          reasoningLevel: null,
        },
      }),
    ).toEqual({ execution: false, reasoningLevel: true });
    expect(
      amendPermission({
        trigger: defaulted,
        stage: "turn.submit",
        sources: {
          providerId: null,
          model: null,
          reasoningLevel: "explicit",
        },
      }),
    ).toEqual({ execution: true, reasoningLevel: false });
  });

  it("treats a remembered client preference as routable, not explicit", () => {
    // `client-preference` is a sticky default, not a decision about this
    // prompt — routing it is the whole point of the defaulted mode.
    expect(
      amendPermission({
        trigger: defaulted,
        stage: "thread.create",
        sources: {
          providerId: "client-preference",
          model: "client-preference",
          reasoningLevel: "client-preference",
        },
      }),
    ).toEqual({ execution: true, reasoningLevel: true });
  });
});

// --- classification ---------------------------------------------------------

describe("classifyPrompt", () => {
  it("promotes on a keyword before it looks at length", () => {
    expect(classifyPrompt({ text: "refactor this", settings: SETTINGS })).toEqual(
      { tier: "capable", because: "keyword", keyword: "refactor" },
    );
  });

  it("promotes on length at the threshold, not one short of it", () => {
    expect(
      classifyPrompt({ text: "x".repeat(100), settings: SETTINGS }).tier,
    ).toBe("capable");
    expect(
      classifyPrompt({ text: "x".repeat(99), settings: SETTINGS }).tier,
    ).toBe("fast");
  });

  it("measures the trimmed prompt so padding cannot promote it", () => {
    expect(
      classifyPrompt({
        text: `${" ".repeat(200)}fix typo${" ".repeat(200)}`,
        settings: SETTINGS,
      }).tier,
    ).toBe("fast");
  });

  it("falls to fast for a short prompt with no keyword", () => {
    expect(classifyPrompt({ text: "fix the typo", settings: SETTINGS })).toEqual(
      { tier: "fast", because: "short" },
    );
  });
});

describe("matchesKeyword", () => {
  it("matches whole words only", () => {
    expect(matchesKeyword("please plan this", "plan")).toBe(true);
    expect(matchesKeyword("PLAN IT", "plan")).toBe(true);
    expect(matchesKeyword("a plan.", "plan")).toBe(true);
    // The whole reason for boundary checking: substring matching would route
    // every apology about an "explanation" to the expensive model.
    expect(matchesKeyword("an explanation", "plan")).toBe(false);
    expect(matchesKeyword("the airplane", "plan")).toBe(false);
    expect(matchesKeyword("replanning", "plan")).toBe(false);
  });

  it("finds a later whole-word occurrence past an embedded one", () => {
    expect(matchesKeyword("explanation, then plan it", "plan")).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(matchesKeyword("do a code review", "code review")).toBe(true);
    expect(matchesKeyword("do a codereview", "code review")).toBe(false);
  });
});

// --- the decision table -----------------------------------------------------

describe("routeDispatch", () => {
  it("routes a short prompt to the fast slot at low effort", () => {
    const decision = routeDispatch(request({ text: "fix typo" }));
    expect(decision).toMatchObject({
      kind: "route",
      tier: "fast",
      amend: {
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "low",
      },
    });
  });

  it("routes a keyword prompt to the capable slot at high effort", () => {
    const decision = routeDispatch(request({ text: "refactor this" }));
    expect(decision).toMatchObject({
      kind: "route",
      tier: "capable",
      amend: {
        providerId: "claude-code",
        model: "opus",
        reasoningLevel: "high",
      },
    });
  });

  it("routes a long prompt to the capable slot", () => {
    expect(routeDispatch(request({ text: LONG_PROMPT }))).toMatchObject({
      kind: "route",
      tier: "capable",
      amend: { model: "opus" },
    });
  });

  it("falls back to the only configured slot", () => {
    const fastOnly = routeDispatch(
      request({
        text: "refactor this",
        settings: { ...SETTINGS, capable: null },
      }),
    );
    // The tier still says capable, so the fast model gets the higher effort —
    // a hard prompt is hard whichever model has to run it.
    expect(fastOnly).toMatchObject({
      kind: "route",
      tier: "capable",
      amend: { model: "gpt-5-mini", reasoningLevel: "high" },
    });

    const capableOnly = routeDispatch(
      request({ text: "fix typo", settings: { ...SETTINGS, fast: null } }),
    );
    expect(capableOnly).toMatchObject({
      kind: "route",
      tier: "fast",
      amend: { model: "opus", reasoningLevel: "low" },
    });
  });

  it("falls back when the preferred slot is missing from the catalog", () => {
    const decision = routeDispatch(
      request({
        text: "refactor this",
        settings: {
          ...SETTINGS,
          capable: { providerId: "codex", model: "gpt-6" },
        },
      }),
    );
    expect(decision).toMatchObject({
      kind: "route",
      amend: { model: "gpt-5-mini" },
    });
  });

  it("skips when no configured slot is in the catalog", () => {
    expect(
      routeDispatch(
        request({
          settings: {
            ...SETTINGS,
            fast: { providerId: "codex", model: "gpt-6" },
            capable: { providerId: "codex", model: "gpt-7" },
          },
        }),
      ),
    ).toMatchObject({ kind: "skip" });
  });

  it("never amends the provider once it is locked", () => {
    const decision = routeDispatch(
      request({
        stage: "turn.submit",
        text: "fix typo",
        lockedProviderId: "codex",
        currentProviderId: "codex",
      }),
    );
    expect(decision.kind === "route" && decision.amend.providerId).toBe(
      undefined,
    );
    expect(decision).toMatchObject({ amend: { model: "gpt-5-mini" } });
  });

  it("uses the other slot when the preferred one is on the wrong provider", () => {
    // Capable lives on claude-code; a codex thread cannot go there, so the
    // codex fast model runs the prompt — still at capable effort.
    const decision = routeDispatch(
      request({
        stage: "turn.submit",
        text: "refactor this",
        lockedProviderId: "codex",
      }),
    );
    expect(decision).toMatchObject({
      kind: "route",
      tier: "capable",
      amend: { model: "gpt-5-mini", reasoningLevel: "high" },
    });
  });

  it("skips when no slot belongs to the locked provider", () => {
    const decision = routeDispatch(
      request({
        stage: "turn.submit",
        text: "refactor this",
        lockedProviderId: "some-other-provider",
        currentProviderId: "some-other-provider",
      }),
    );
    expect(decision).toMatchObject({ kind: "skip" });
    expect(decision.kind === "skip" && decision.reason).toContain(
      "some-other-provider",
    );
  });

  it("skips entirely when Auto was not selected and defaulted routing is off", () => {
    expect(routeDispatch(request({ pluginInput: null }))).toMatchObject({
      kind: "skip",
    });
  });

  it("routes without Auto once defaulted routing is on", () => {
    expect(
      routeDispatch(
        request({
          pluginInput: null,
          settings: { ...SETTINGS, routeDefaultedFields: true },
        }),
      ),
    ).toMatchObject({ kind: "route", amend: { model: "gpt-5-mini" } });
  });

  it("leaves an explicit choice alone in defaulted mode", () => {
    const decision = routeDispatch(
      request({
        pluginInput: null,
        settings: { ...SETTINGS, routeDefaultedFields: true },
        sources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
        },
      }),
    );
    expect(decision).toMatchObject({ kind: "skip" });
  });

  it("overrides an explicit choice under Auto, because Auto is the choice", () => {
    const decision = routeDispatch(
      request({
        text: "fix typo",
        sources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
        },
      }),
    );
    expect(decision).toMatchObject({
      kind: "route",
      amend: { providerId: "codex", model: "gpt-5-mini" },
    });
  });

  it("still sets the reasoning level when only the model is protected", () => {
    const decision = routeDispatch(
      request({
        stage: "turn.submit",
        text: "refactor this",
        pluginInput: null,
        lockedProviderId: "codex",
        currentModel: "gpt-5",
        settings: { ...SETTINGS, routeDefaultedFields: true },
        sources: {
          providerId: null,
          model: "explicit",
          reasoningLevel: null,
        },
      }),
    );
    // The level is clamped against the model that will actually run — the
    // user's `gpt-5`, not the one routing would have picked.
    expect(decision).toMatchObject({
      kind: "route",
      amend: { reasoningLevel: "high" },
    });
    expect(decision.kind === "route" && decision.amend.model).toBe(undefined);
  });

  it("proceeds unamended when the catalog has not loaded", () => {
    // Explicitly the documented behaviour for an Auto send: fall through to
    // the project default rather than hold or reject.
    const decision = routeDispatch(request({ catalogIsUsable: false }));
    expect(decision).toMatchObject({ kind: "skip" });
    expect(decision.kind === "skip" && decision.reason).toContain("catalog");
  });

  it("omits the reasoning level a model does not advertise", () => {
    const decision = routeDispatch(
      request({
        text: "fix typo",
        catalog: {
          providers: new Map([["codex", new Map([["gpt-5-mini", model("gpt-5-mini", [])]])]]),
          fetchedAt: 1_000,
        },
        settings: { ...SETTINGS, capable: null },
      }),
    );
    expect(decision).toMatchObject({ kind: "route", amend: { model: "gpt-5-mini" } });
    expect(decision.kind === "route" && decision.amend.reasoningLevel).toBe(
      undefined,
    );
  });
});
