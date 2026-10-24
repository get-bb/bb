import { describe, expect, it } from "vitest";
import { MEETUP_DECLINE, surveyAnswers, validateSurvey } from "./survey";

const contact = { email: ["ada@example.test"] };

describe("community survey submission rules", () => {
  it("allows all questions to be skipped but requires valid contact details", () => {
    expect(validateSurvey(contact)).toEqual({});
    expect(validateSurvey({})).toEqual({
      email: "Please enter your email.",
    });
    expect(
      validateSurvey({ ...contact, email: ["invalid"] }).email,
    ).toBeTruthy();
    expect(
      validateSurvey({
        ...contact,
        email: ["a@example.test", "b@example.test"],
      }).email,
    ).toBeTruthy();
  });
  it("allows any involvement combination except the exclusive decline", () => {
    expect(
      validateSurvey({
        ...contact,
        meetup: [
          "I'd come",
          "I'd help host",
          "I'd give a short talk or demo",
          "I could offer a space",
        ],
      }),
    ).toEqual({});
    expect(validateSurvey({ ...contact, meetup: [MEETUP_DECLINE] })).toEqual(
      {},
    );
    expect(
      validateSurvey({ ...contact, meetup: ["I'd come", MEETUP_DECLINE] })
        .meetup,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, meetup: ["I'd come", "I'd come"] }).meetup,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, role: ["Invented"] }).role,
    ).toBeTruthy();
    expect(
      validateSurvey({ ...contact, city: ["x".repeat(251)] }).city,
    ).toBeTruthy();
  });
  it("validates community choices and discards unchecked Other text", () => {
    expect(
      validateSurvey({
        ...contact,
        community: ["Merch", "Other"],
        community_other: ["Workshops"],
      }),
    ).toEqual({});
    for (const community of [["Invented"], ["Merch", "Merch"]]) {
      expect(validateSurvey({ ...contact, community }).community).toBeTruthy();
    }
    expect(
      validateSurvey({ ...contact, community_other: ["x".repeat(251)] })
        .community_other,
    ).toBeTruthy();
    expect(
      surveyAnswers({
        ...contact,
        community: ["Merch"],
        community_other: ["Ignored"],
      }),
    ).toEqual({ ...contact, community: ["Merch"] });
  });
  it("stores contact and selected Other detail with answers, excluding unrelated fields", () => {
    expect(
      surveyAnswers({
        ...contact,
        discovery: ["Other"],
        discovery_other: ["Example"],
        role: ["Student"],
        community: ["Merch", "Other"],
        community_other: ["Workshops"],
        role_other: ["Ignored"],
        submission_id: ["not-an-answer"],
        address: ["not-stored"],
        name: ["not-stored"],
      }),
    ).toEqual({
      ...contact,
      discovery: ["Other"],
      discovery_other: ["Example"],
      role: ["Student"],
      community: ["Merch", "Other"],
      community_other: ["Workshops"],
    });
  });
});
