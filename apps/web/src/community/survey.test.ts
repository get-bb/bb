import { describe, expect, it } from "vitest";
import { validateSurvey } from "./survey";

describe("community survey submission rules", () => {
  it("rejects a fourth merch pick even when client validation is bypassed", () => {
    expect(
      validateSurvey({ merch: ["T-shirt", "Hoodie", "Tote bag", "Mug"] }).merch,
    ).toBe("Pick up to 3");
    expect(
      validateSurvey({ merch: ["T-shirt", "Hoodie", "Tote bag"] }).merch,
    ).toBeUndefined();
  });

  it.each(["None currently", "Prefer not to say"])(
    "keeps %s exclusive from tool selections",
    (choice) => {
      expect(validateSurvey({ tools: [choice, "Codex"] }).tools).toBeTruthy();
      expect(validateSurvey({ tools: [choice] }).tools).toBeUndefined();
    },
  );

  it("requires a write-in for Other and rejects invented answer options", () => {
    expect(validateSurvey({ role: ["Other"] }).role).toBeTruthy();
    expect(
      validateSurvey({ role: ["Other"], role_other: ["Researcher"] }).role,
    ).toBeUndefined();
    expect(validateSurvey({ role: ["Not a listed option"] }).role).toBeTruthy();
  });

  it("allows the last three answers to be omitted while requiring the rest", () => {
    const errors = validateSurvey({});
    expect(errors.sticker).toBeUndefined();
    expect(errors.feedback).toBeUndefined();
    expect(errors.discord).toBeUndefined();
    expect(Object.keys(errors)).toHaveLength(12);
  });
});
