import {
  CASCADE_TIERS,
  HYPOTHESIS_CLASSES,
  type CascadeTier,
  type D3Handoff,
  type EscalationDecision,
  type Hypothesis,
  type HypothesisClass,
  type TierVerdict,
  VerdictValidationError,
} from "./types.js";

const ALL_CLASSES: readonly HypothesisClass[] = HYPOTHESIS_CLASSES;
const EMULATED_CONFIRM_CLASSES: readonly HypothesisClass[] = [
  "logic",
  "state",
  "environmental",
];

export const CONFIRM_CAPABILITY: Readonly<
  Record<CascadeTier, readonly HypothesisClass[]>
> = Object.freeze({
  d0: ALL_CLASSES,
  d1: EMULATED_CONFIRM_CLASSES,
  d2: EMULATED_CONFIRM_CLASSES,
  d3: ALL_CLASSES,
});

export const CASCADE_RULE_TABLE = Object.freeze(
  CASCADE_TIERS.flatMap((tier) =>
    HYPOTHESIS_CLASSES.flatMap((hypothesisClass) =>
      (["confirmed", "refuted", "inconclusive"] as const).map((outcome) => ({
        tier,
        hypothesisClass,
        outcome,
        confirmAllowed: CONFIRM_CAPABILITY[tier].includes(hypothesisClass),
        coerceToInconclusive:
          outcome === "confirmed" &&
          !CONFIRM_CAPABILITY[tier].includes(hypothesisClass),
        mandatoryPhysicalEscalation:
          outcome === "confirmed" &&
          !CONFIRM_CAPABILITY[tier].includes(hypothesisClass),
      })),
    ),
  ),
);

export function validateVerdict(
  verdict: TierVerdict,
  hypothesis: Hypothesis,
): TierVerdict {
  if (verdict.hypothesisId !== hypothesis.id) {
    throw new Error("CASCADE_HYPOTHESIS_MISMATCH");
  }
  const confirmAllowed = CONFIRM_CAPABILITY[verdict.tier].includes(
    hypothesis.class,
  );
  if (verdict.outcome !== "confirmed" || confirmAllowed) return verdict;

  const coercedVerdict: TierVerdict = {
    ...verdict,
    outcome: "inconclusive",
    forcedEscalation: true,
    annotations: [
      ...(verdict.annotations ?? []),
      {
        code: "CLASS_REQUIRES_PHYSICAL",
        message: `${hypothesis.class} hypotheses cannot be confirmed by ${verdict.tier}; a physical observation is mandatory.`,
      },
    ],
  };
  throw new VerdictValidationError(
    `${verdict.tier.toUpperCase()} may refute a ${hypothesis.class} hypothesis but cannot confirm it.`,
    coercedVerdict,
  );
}

function normalizedVerdict(
  verdict: TierVerdict,
  hypothesis: Hypothesis,
): TierVerdict {
  try {
    return validateVerdict(verdict, hypothesis);
  } catch (error) {
    if (error instanceof VerdictValidationError) return error.coercedVerdict;
    throw error;
  }
}

export function nextStep(
  hypothesis: Hypothesis,
  verdicts: readonly TierVerdict[],
): EscalationDecision {
  const latest = verdicts.at(-1);
  if (!latest)
    return { action: "stop", reason: "No tier verdict is available." };
  const verdict = normalizedVerdict(latest, hypothesis);
  if (verdict.outcome !== "inconclusive") {
    return { action: "answered", verdict };
  }
  if (verdict.tier === "d3") {
    return {
      action: "stop",
      reason:
        "The physical tier was inconclusive; refine the hypothesis or observation.",
    };
  }
  if (verdict.forcedEscalation) {
    return {
      action: "escalate",
      toTier: "d3",
      because: "class_requires_physical",
    };
  }
  const nextTier = CASCADE_TIERS[CASCADE_TIERS.indexOf(verdict.tier) + 1];
  if (!nextTier) return { action: "stop", reason: "No higher tier exists." };
  return { action: "escalate", toTier: nextTier, because: "inconclusive" };
}

export function createD3Handoff(
  hypothesis: Hypothesis,
  discriminatingObservation: string,
): D3Handoff {
  const suggestedInstrumentKind: D3Handoff["suggestedInstrumentKind"] =
    hypothesis.class === "power"
      ? "power"
      : hypothesis.class === "analog"
        ? "scope"
        : hypothesis.class === "timing"
          ? "logic"
          : hypothesis.class === "environmental"
            ? "serial"
            : "probe";
  return { hypothesis, discriminatingObservation, suggestedInstrumentKind };
}
