import { describe, expect, it } from "vitest";
import {
  CASCADE_RULE_TABLE,
  CONFIRM_CAPABILITY,
  createD3Handoff,
  nextStep,
  validateVerdict,
} from "./escalation.js";
import {
  CASCADE_TIERS,
  HYPOTHESIS_CLASSES,
  VERDICT_OUTCOMES,
  type Hypothesis,
  type TierVerdict,
  VerdictValidationError,
} from "./types.js";

function hypothesis(className: Hypothesis["class"]): Hypothesis {
  return {
    id: `hyp-${className}`,
    text: `${className} hypothesis`,
    class: className,
    likelihood: 0.5,
    easeOfVerification: 0.5,
  };
}

function verdict(
  hypothesisId: string,
  tier: TierVerdict["tier"],
  outcome: TierVerdict["outcome"],
): TierVerdict {
  return {
    tier,
    hypothesisId,
    outcome,
    forcedEscalation: false,
    evidence: [{ kind: "log", path: `.fs-bench/${tier}.log` }],
    producedBy: { command: [tier], inputs: {} },
  };
}

describe("cascade escalation", () => {
  it("keeps an exhaustive tier x class x outcome table in capability lockstep", () => {
    expect(CASCADE_RULE_TABLE).toHaveLength(
      CASCADE_TIERS.length *
        HYPOTHESIS_CLASSES.length *
        VERDICT_OUTCOMES.length,
    );
    for (const tier of CASCADE_TIERS) {
      for (const className of HYPOTHESIS_CLASSES) {
        for (const outcome of VERDICT_OUTCOMES) {
          const row = CASCADE_RULE_TABLE.find(
            (candidate) =>
              candidate.tier === tier &&
              candidate.hypothesisClass === className &&
              candidate.outcome === outcome,
          );
          expect(row).toEqual({
            tier,
            hypothesisClass: className,
            outcome,
            confirmAllowed: CONFIRM_CAPABILITY[tier].includes(className),
            coerceToInconclusive:
              outcome === "confirmed" &&
              !CONFIRM_CAPABILITY[tier].includes(className),
            mandatoryPhysicalEscalation:
              outcome === "confirmed" &&
              !CONFIRM_CAPABILITY[tier].includes(className),
          });
        }
      }
    }
  });

  it.each(["d1", "d2"] as const)(
    "coerces every forbidden %s confirm and returns it on a typed error",
    (tier) => {
      for (const className of ["timing", "power", "analog"] as const) {
        const h = hypothesis(className);
        try {
          validateVerdict(verdict(h.id, tier, "confirmed"), h);
          throw new Error("expected validation failure");
        } catch (error) {
          expect(error).toBeInstanceOf(VerdictValidationError);
          if (!(error instanceof VerdictValidationError)) throw error;
          expect(error.code).toBe("CASCADE_CONFIRM_REQUIRES_PHYSICAL");
          expect(error.coercedVerdict).toMatchObject({
            outcome: "inconclusive",
            forcedEscalation: true,
            annotations: [
              expect.objectContaining({ code: "CLASS_REQUIRES_PHYSICAL" }),
            ],
          });
          expect(nextStep(h, [verdict(h.id, tier, "confirmed")])).toEqual({
            action: "escalate",
            toTier: "d3",
            because: "class_requires_physical",
          });
        }
      }
    },
  );

  it("answers conclusive verdicts and escalates only an inconclusive verdict", () => {
    const h = hypothesis("logic");
    expect(nextStep(h, [verdict(h.id, "d0", "confirmed")]).action).toBe(
      "answered",
    );
    expect(nextStep(h, [verdict(h.id, "d0", "refuted")]).action).toBe(
      "answered",
    );
    expect(nextStep(h, [verdict(h.id, "d0", "inconclusive")])).toEqual({
      action: "escalate",
      toTier: "d1",
      because: "inconclusive",
    });
    expect(nextStep(h, [])).toEqual({
      action: "stop",
      reason: "No tier verdict is available.",
    });
    expect(nextStep.length).toBe(2);
  });

  it("produces a typed D3 handoff without implementing D3", () => {
    expect(createD3Handoff(hypothesis("power"), "measure rail droop")).toEqual(
      expect.objectContaining({
        discriminatingObservation: "measure rail droop",
        suggestedInstrumentKind: "power",
      }),
    );
  });
});
